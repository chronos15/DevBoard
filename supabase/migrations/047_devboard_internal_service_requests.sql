-- =============================================================================
-- Devboard - Solicitações internas sem OS/anexos obrigatórios
-- =============================================================================

alter table public.service_requests
  drop constraint if exists service_requests_request_type_check;

alter table public.service_requests
  add constraint service_requests_request_type_check
  check (request_type in ('internal','failure','development','adjustment','improvement','structured-triage'));

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
  if v_workspace is null then raise exception 'Workspace não encontrado'; end if;

  if p_request_type not in ('internal','failure','development','adjustment','improvement','structured-triage') then
    raise exception 'Tipo de solicitação inválido';
  end if;

  -- Solicitações internas não exigem uma OS informada pelo usuário. Para manter o
  -- protocolo único e todas as integrações existentes, o banco gera uma referência
  -- interna somente quando o campo vier vazio.
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
    raise exception 'Informe o número da ordem';
  end if;

  if length(v_order_number)>40 then raise exception 'O número da OS deve ter no máximo 40 caracteres'; end if;
  if length(btrim(coalesce(p_unit,'')))<2 then raise exception 'Informe a unidade'; end if;
  if length(btrim(coalesce(p_module,'')))<2 then raise exception 'Informe o módulo'; end if;
  if length(btrim(coalesce(p_subject,'')))<2 then raise exception 'Informe o assunto'; end if;
  if length(btrim(coalesce(p_title,'')))<3 then raise exception 'Informe um título'; end if;
  if length(btrim(coalesce(p_description,'')))<10 then raise exception 'Detalhe melhor a solicitação'; end if;
  if coalesce(p_priority_requested,false) and length(btrim(coalesce(p_priority_reason,'')))<5 then raise exception 'Justifique a prioridade solicitada'; end if;

  insert into public.service_requests(
    workspace_id,order_number,request_type,unit,module,subject,title,description,
    priority_requested,priority_reason,created_by
  )
  values(
    v_workspace,v_order_number,p_request_type,btrim(p_unit),btrim(p_module),btrim(p_subject),
    btrim(p_title),btrim(p_description),coalesce(p_priority_requested,false),
    nullif(btrim(coalesce(p_priority_reason,'')),''),auth.uid()
  )
  returning id into v_id;

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

-- Mantém o padrão inteligente ao criar a atividade técnica: solicitações internas
-- recebem [INT-...] em vez de [OS INT-...]. Se uma OS opcional foi informada,
-- ela continua aparecendo como [OS ...].
create or replace function public.send_service_request_to_dev(
  p_request_id uuid,
  p_responsible_dev_id uuid,
  p_project_id uuid default null,
  p_activity_id uuid default null,
  p_aqs_summary text default null,
  p_priority_approved boolean default false
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text;
  v_req public.service_requests%rowtype;
  v_activity_id uuid;
  v_activity_title text;
  v_type_id uuid;
  v_project_name text;
  v_type_names text[];
  v_reference text;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then
    raise exception 'Apenas AQS ou Administrador podem encaminhar ao DEV';
  end if;

  select * into v_req
  from public.service_requests
  where id=p_request_id
  for update;

  if not found then raise exception 'Solicitação não encontrada'; end if;
  if v_req.status<>'aqs-analysis' then raise exception 'Finalize a análise AQS antes de encaminhar'; end if;
  if p_project_id is null then raise exception 'Selecione o projeto que receberá a atividade técnica'; end if;

  if not exists(
    select 1
    from public.workspace_members wm
    where wm.workspace_id=v_req.workspace_id
      and wm.user_id=p_responsible_dev_id
      and wm.active
      and wm.role::text in ('developer','admin')
  ) then
    raise exception 'Responsável DEV inválido';
  end if;

  select p.name into v_project_name
  from public.projects p
  where p.id=p_project_id and p.workspace_id=v_req.workspace_id;
  if v_project_name is null then raise exception 'Projeto inválido'; end if;

  v_reference:=case
    when v_req.request_type='internal' and upper(btrim(v_req.order_number)) like 'INT-%'
      then btrim(v_req.order_number)
    when upper(btrim(v_req.order_number)) like 'OS %'
      then btrim(v_req.order_number)
    else 'OS ' || btrim(v_req.order_number)
  end;

  if p_activity_id is not null then
    if not exists(select 1 from public.activities a where a.id=p_activity_id and a.project_id=p_project_id) then
      raise exception 'Atividade não pertence ao projeto selecionado';
    end if;
    v_activity_id:=p_activity_id;
  elsif v_req.activity_id is not null then
    if not exists(select 1 from public.activities a where a.id=v_req.activity_id and a.project_id=p_project_id) then
      raise exception 'A atividade já vinculada não pertence ao projeto selecionado';
    end if;
    v_activity_id:=v_req.activity_id;
  else
    v_activity_title:=left(
      '[' || v_reference || '] ' || coalesce(nullif(btrim(v_req.title),''),nullif(btrim(v_req.subject),''),'Solicitação'),
      240
    );

    v_type_names:=case v_req.request_type
      when 'failure' then array['Erro','Correção']
      when 'adjustment' then array['Ajuste']
      when 'development' then array['Desenvolvimento','Implementação']
      when 'improvement' then array['Implementação','Desenvolvimento']
      when 'internal' then array['Desenvolvimento','Implementação','Ajuste']
      else array['Desenvolvimento']
    end;

    select wit.id into v_type_id
    from public.work_item_types wit
    where wit.workspace_id=v_req.workspace_id
      and wit.active
      and wit.name=any(v_type_names)
    order by array_position(v_type_names,wit.name)
    limit 1;

    insert into public.project_members(project_id,user_id,added_by)
    values(p_project_id,p_responsible_dev_id,auth.uid())
    on conflict(project_id,user_id) do nothing;

    insert into public.activities(project_id,title,created_by,type_id)
    values(p_project_id,v_activity_title,auth.uid(),v_type_id)
    returning id into v_activity_id;

    insert into public.activity_assignees(activity_id,user_id)
    values(v_activity_id,p_responsible_dev_id)
    on conflict(activity_id,user_id) do nothing;

    perform public.add_project_log(
      p_project_id,
      'activity-added',
      'Atividade criada a partir de solicitação',
      format('“%s” criada e vinculada ao protocolo %s.',v_activity_title,v_reference),
      auth.uid()
    );
  end if;

  update public.service_requests
     set status='waiting-dev',
         responsible_dev_id=p_responsible_dev_id,
         project_id=p_project_id,
         activity_id=v_activity_id,
         aqs_summary=nullif(btrim(coalesce(p_aqs_summary,'')),''),
         priority_approved=coalesce(p_priority_approved,false)
   where id=p_request_id;

  insert into public.service_request_participants(request_id,user_id,source,added_by)
  values(p_request_id,p_responsible_dev_id,'dev',auth.uid())
  on conflict(request_id,user_id) do update set source='dev';

  perform public.service_request_add_event(
    p_request_id,
    'technical-activity-created',
    'Atividade técnica criada e encaminhada ao DEV',
    format(
      '%s · %s%s',
      v_project_name,
      (select a.title from public.activities a where a.id=v_activity_id),
      case when nullif(btrim(coalesce(p_aqs_summary,'')),'') is not null then E'\n\nAnálise AQS: '||btrim(p_aqs_summary) else '' end
    ),
    v_req.status,
    'waiting-dev'
  );

  perform public.service_request_notify(
    p_request_id,
    p_responsible_dev_id,
    'request-assigned',
    'Nova atividade vinculada à solicitação',
    format('%s · %s',v_reference,(select a.title from public.activities a where a.id=v_activity_id))
  );
end;
$$;
