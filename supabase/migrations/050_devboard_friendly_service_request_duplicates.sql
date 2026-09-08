-- =============================================================================
-- Devboard - Solicitações: duplicidade de OS com mensagem amigável
-- =============================================================================
-- Mantém a regra existente de uma OS por workspace, mas impede que o erro técnico
-- da constraint seja devolvido à interface. O INSERT com ON CONFLICT também cobre
-- duas criações simultâneas da mesma OS sem depender apenas de uma consulta prévia.

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
  v_workspace uuid;
  v_id uuid;
  v_rec record;
  v_order_number text := btrim(coalesce(p_order_number,''));
begin
  v_workspace:=public.current_workspace_id();
  if v_workspace is null then raise exception 'Não foi possível identificar o ambiente atual. Entre novamente e tente de novo.'; end if;

  if p_request_type not in ('internal','failure','development','adjustment','improvement','structured-triage') then
    raise exception 'Selecione um tipo de solicitação válido.';
  end if;

  -- Solicitações internas podem ser protocoladas sem OS. A referência INT é apenas
  -- técnica/interna e continua única no workspace.
  if p_request_type='internal' and length(v_order_number)=0 then
    loop
      v_order_number := 'INT-' || to_char(clock_timestamp(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
      exit when not exists(
        select 1
        from public.service_requests r
        where r.workspace_id=v_workspace
          and lower(btrim(r.order_number))=lower(v_order_number)
      );
    end loop;
  elsif length(v_order_number)<2 then
    raise exception 'Informe o número da OS.';
  end if;

  if length(v_order_number)>40 then raise exception 'O número da OS deve ter no máximo 40 caracteres.'; end if;
  if length(btrim(coalesce(p_unit,'')))<2 then raise exception 'Selecione uma unidade válida.'; end if;
  if length(btrim(coalesce(p_module,'')))<2 then raise exception 'Informe o módulo.'; end if;
  if length(btrim(coalesce(p_subject,'')))<2 then raise exception 'Informe o assunto.'; end if;
  if length(btrim(coalesce(p_title,'')))<3 then raise exception 'Informe um título mais descritivo.'; end if;
  if length(btrim(coalesce(p_description,'')))<10 then raise exception 'Detalhe melhor a solicitação.'; end if;
  if coalesce(p_priority_requested,false) and length(btrim(coalesce(p_priority_reason,'')))<5 then
    raise exception 'Justifique a prioridade solicitada.';
  end if;

  insert into public.service_requests(
    workspace_id,order_number,request_type,unit,module,subject,title,description,
    priority_requested,priority_reason,created_by
  )
  values(
    v_workspace,v_order_number,p_request_type,btrim(p_unit),btrim(p_module),btrim(p_subject),
    btrim(p_title),btrim(p_description),coalesce(p_priority_requested,false),
    nullif(btrim(coalesce(p_priority_reason,'')),''),auth.uid()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'Já existe uma solicitação com esse número de OS. Abra o protocolo existente ou informe outro número.';
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
