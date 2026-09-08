-- =============================================================================
-- Devboard - Solicitações: numeração de OS independente por Unidade
-- =============================================================================
-- A OS deixa de ser única no workspace inteiro e passa a ser única somente dentro
-- da Unidade selecionada. Ex.: a OS 123 pode existir na Unidade A e na Unidade B,
-- mas não pode ser cadastrada duas vezes na mesma Unidade.

begin;

-- Remove a regra antiga (workspace + OS) e cria a regra correta
-- (workspace + unidade + OS). Registros históricos sem unit_id ficam fora do índice
-- para não impedir a migração de dados legados/unidades removidas.
drop index if exists public.service_requests_workspace_order_uidx;

create unique index if not exists service_requests_workspace_unit_order_uidx
  on public.service_requests(workspace_id, unit_id, lower(btrim(order_number)))
  where unit_id is not null;

-- Fluxo principal atual: recebe unit_id e grava o vínculo antes da checagem de
-- unicidade, de forma atômica. Isso também cobre duas pessoas protocolando a mesma
-- OS simultaneamente na mesma Unidade.
create or replace function public.create_service_request_v2(
  p_order_number text,
  p_request_type text,
  p_unit_id uuid,
  p_module text,
  p_subject text,
  p_title text,
  p_description text,
  p_priority_requested boolean default false,
  p_priority_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_unit_name text;
  v_id uuid;
  v_rec record;
  v_order_number text := btrim(coalesce(p_order_number,''));
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não foi possível identificar o ambiente atual. Entre novamente e tente de novo.';
  end if;

  select u.name into v_unit_name
  from public.service_request_units u
  where u.id=p_unit_id
    and u.workspace_id=v_workspace
    and u.active;

  if v_unit_name is null then
    raise exception 'Selecione uma unidade ativa.';
  end if;

  if p_request_type not in ('internal','failure','development','adjustment','improvement','structured-triage') then
    raise exception 'Selecione um tipo de solicitação válido.';
  end if;

  -- Solicitações internas podem ser protocoladas sem OS. A referência INT é apenas
  -- técnica e continua protegida dentro da própria Unidade.
  if p_request_type='internal' and length(v_order_number)=0 then
    loop
      v_order_number := 'INT-' || to_char(clock_timestamp(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
      exit when not exists(
        select 1
        from public.service_requests r
        where r.workspace_id=v_workspace
          and r.unit_id=p_unit_id
          and lower(btrim(r.order_number))=lower(v_order_number)
      );
    end loop;
  elsif length(v_order_number)<2 then
    raise exception 'Informe o número da OS.';
  end if;

  if length(v_order_number)>40 then raise exception 'O número da OS deve ter no máximo 40 caracteres.'; end if;
  if length(btrim(coalesce(p_module,'')))<2 then raise exception 'Informe o módulo.'; end if;
  if length(btrim(coalesce(p_module,'')))>120 then raise exception 'O módulo deve ter no máximo 120 caracteres.'; end if;
  if length(btrim(coalesce(p_subject,'')))<2 then raise exception 'Informe o assunto.'; end if;
  if length(btrim(coalesce(p_subject,'')))>180 then raise exception 'O assunto deve ter no máximo 180 caracteres.'; end if;
  if length(btrim(coalesce(p_title,'')))<3 then raise exception 'Informe um título mais descritivo.'; end if;
  if length(btrim(coalesce(p_title,'')))>180 then raise exception 'O título deve ter no máximo 180 caracteres.'; end if;
  if length(btrim(coalesce(p_description,'')))<10 then raise exception 'Detalhe melhor a solicitação.'; end if;
  if length(btrim(coalesce(p_description,'')))>12000 then raise exception 'A descrição deve ter no máximo 12.000 caracteres.'; end if;
  if length(btrim(coalesce(p_priority_reason,'')))>2000 then raise exception 'A justificativa de prioridade deve ter no máximo 2.000 caracteres.'; end if;
  if coalesce(p_priority_requested,false) and length(btrim(coalesce(p_priority_reason,'')))<5 then
    raise exception 'Justifique a prioridade solicitada.';
  end if;

  insert into public.service_requests(
    workspace_id,order_number,request_type,unit,unit_id,module,subject,title,description,
    priority_requested,priority_reason,created_by
  )
  values(
    v_workspace,v_order_number,p_request_type,btrim(v_unit_name),p_unit_id,btrim(p_module),btrim(p_subject),
    btrim(p_title),btrim(p_description),coalesce(p_priority_requested,false),
    nullif(btrim(coalesce(p_priority_reason,'')),''),auth.uid()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'Já existe uma solicitação com esse número de OS na unidade selecionada. Abra o protocolo existente ou informe outro número.';
  end if;

  insert into public.service_request_participants(request_id,user_id,source,added_by)
  values(v_id,auth.uid(),'creator',auth.uid())
  on conflict(request_id,user_id) do nothing;

  perform public.service_request_add_event(
    v_id,
    'created',
    case when p_request_type='internal' then 'Solicitação interna protocolada' else 'Solicitação protocolada' end,
    case
      when p_request_type='internal' then 'A solicitação interna foi recebida e entrou na caixa de entrada AQS.'
      else 'A solicitação foi recebida e entrou na caixa de entrada AQS.'
    end,
    null,
    'received'
  );

  for v_rec in
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id=v_workspace
      and wm.active
      and wm.role::text in ('admin','aqs')
      and wm.user_id<>auth.uid()
  loop
    perform public.service_request_notify(
      v_id,
      v_rec.user_id,
      'request-created',
      case when p_request_type='internal' then 'Nova solicitação interna recebida' else 'Nova solicitação recebida' end,
      v_order_number || ' · ' || btrim(p_title)
    );
  end loop;

  return v_id;
end;
$$;

-- Mantém compatibilidade com chamadas antigas que ainda enviem o nome da Unidade,
-- mas encaminha tudo para o fluxo atual com unit_id e a mesma regra de unicidade.
create or replace function public.create_service_request(
  p_order_number text,
  p_request_type text,
  p_unit text,
  p_module text,
  p_subject text,
  p_title text,
  p_description text,
  p_priority_requested boolean default false,
  p_priority_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_unit_id uuid;
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não foi possível identificar o ambiente atual. Entre novamente e tente de novo.';
  end if;

  select u.id into v_unit_id
  from public.service_request_units u
  where u.workspace_id=v_workspace
    and u.active
    and lower(btrim(u.name))=lower(btrim(coalesce(p_unit,'')))
  limit 1;

  if v_unit_id is null then
    raise exception 'Selecione uma unidade ativa.';
  end if;

  return public.create_service_request_v2(
    p_order_number,
    p_request_type,
    v_unit_id,
    p_module,
    p_subject,
    p_title,
    p_description,
    p_priority_requested,
    p_priority_reason
  );
end;
$$;

revoke execute on function public.create_service_request_v2(text,text,uuid,text,text,text,text,boolean,text) from public,anon;
revoke execute on function public.create_service_request(text,text,text,text,text,text,text,boolean,text) from public,anon;
grant execute on function public.create_service_request_v2(text,text,uuid,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.create_service_request(text,text,text,text,text,text,text,boolean,text) to authenticated;

commit;
