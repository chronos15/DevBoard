begin;

-- TaskBoard V183
-- Logs relacionados a uma subatividade passam a carregar o UUID exato.
-- O cliente não deve mais inferir vínculo por título/descrição.

alter table public.project_logs
  add column if not exists subactivity_id uuid references public.subactivities(id) on delete set null;

create index if not exists project_logs_subactivity_idx
  on public.project_logs(project_id, subactivity_id, created_at desc)
  where subactivity_id is not null;

comment on column public.project_logs.subactivity_id is
  'Subatividade exata que originou o log. NULL identifica log de projeto/atividade ou log legado sem vínculo seguro.';

-- Mantém o helper antigo de 5 parâmetros para logs de projeto/atividade.
-- Este overload de 6 parâmetros é usado somente quando existe subatividade exata.
create or replace function public.add_project_log(
  p_project_id uuid,
  p_type text,
  p_title text,
  p_description text,
  p_actor_id uuid,
  p_subactivity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_subactivity_id is not null
     and public.subactivity_project_id(p_subactivity_id) is distinct from p_project_id then
    raise exception 'Subatividade não pertence ao projeto informado';
  end if;

  insert into public.project_logs(
    project_id,
    actor_id,
    type,
    title,
    description,
    subactivity_id
  ) values (
    p_project_id,
    p_actor_id,
    p_type,
    p_title,
    p_description,
    p_subactivity_id
  );
end;
$$;

revoke execute on function public.add_project_log(uuid,text,text,text,uuid,uuid)
  from public, anon, authenticated;

-- Backfill somente quando já existe UUID exato no próprio log (reuniões antigas).
-- Nenhum log histórico é associado por texto/título.
with meeting_ids as (
  select
    l.id,
    l.project_id,
    substring(
      l.description
      from '\[\[meeting-subactivity:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]\]'
    )::uuid as subactivity_id
  from public.project_logs l
  where l.subactivity_id is null
    and l.type in ('meeting-started','meeting-ended')
    and l.description ~ '\[\[meeting-subactivity:[0-9a-fA-F-]{36}\]\]'
)
update public.project_logs l
   set subactivity_id = m.subactivity_id
  from meeting_ids m
 where l.id = m.id
   and m.subactivity_id is not null
   and public.subactivity_project_id(m.subactivity_id) = m.project_id;


-- Vínculo exato por UUID: start_subactivity (definição ativa originada em 005_devboard_roles_aqs_topics.sql)
create or replace function public.start_subactivity(p_subactivity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub public.subactivities%rowtype; v_project uuid; v_workspace uuid; v_is_admin boolean; v_other record; v_now timestamptz:=now();
begin
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_project:=public.subactivity_project_id(p_subactivity_id); v_workspace:=public.project_workspace_id(v_project); v_is_admin:=public.is_workspace_admin(v_workspace);
  if not v_is_admin and public.current_workspace_role()<>'developer' then raise exception 'Somente Administrador ou Desenvolvedor pode executar subatividades'; end if;
  if not v_is_admin and v_sub.assignee_id<>auth.uid() then raise exception 'Desenvolvedor só pode executar a própria subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_is_admin then raise exception 'Somente um administrador pode reabrir uma subatividade finalizada'; end if;
  if v_sub.status='waiting-aqs' and not v_is_admin then raise exception 'A subatividade está em análise AQS'; end if;
  if v_sub.status='in-progress' then return; end if;

  perform 1 from public.profiles where id=v_sub.assignee_id for update;
  for v_other in select s.*,a.project_id from public.subactivities s join public.activities a on a.id=s.activity_id
    where s.assignee_id=v_sub.assignee_id and s.status='in-progress' and s.id<>p_subactivity_id for update of s
  loop
    update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
      where user_id=v_sub.assignee_id and subactivity_id=v_other.id and ended_at is null;
    update public.subactivities set tracked_seconds=tracked_seconds+greatest(0,floor(extract(epoch from(v_now-timer_started_at)))::bigint),status='paused',timer_started_at=null where id=v_other.id;
    perform public.add_project_log(v_other.project_id,'subactivity-status','Subatividade pausada automaticamente',format('“%s” foi pausada porque o responsável iniciou outra subatividade.',v_other.title),auth.uid(),
    v_other.id);
  end loop;
  update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint) where user_id=v_sub.assignee_id and ended_at is null;
  update public.subactivities set status='in-progress',timer_started_at=v_now,completed_at=null,cancelled_at=null,needs_attention=false,attention_message=null where id=p_subactivity_id;
  insert into public.work_sessions(subactivity_id,user_id,started_at) values(p_subactivity_id,v_sub.assignee_id,v_now);
  perform public.add_project_log(v_project,'subactivity-status','Subatividade iniciada',format('“%s” está em execução.',v_sub.title),auth.uid(),
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: pause_subactivity (definição ativa originada em 005_devboard_roles_aqs_topics.sql)
create or replace function public.pause_subactivity(p_subactivity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub public.subactivities%rowtype; v_project uuid; v_workspace uuid; v_now timestamptz:=now();
begin
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_project:=public.subactivity_project_id(p_subactivity_id); v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_admin(v_workspace) and (public.current_workspace_role()<>'developer' or v_sub.assignee_id<>auth.uid()) then
    raise exception 'Desenvolvedor só pode pausar a própria subatividade';
  end if;
  if v_sub.status<>'in-progress' then return; end if;
  update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
    where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  update public.subactivities set tracked_seconds=tracked_seconds+greatest(0,floor(extract(epoch from(v_now-timer_started_at)))::bigint),status='paused',timer_started_at=null where id=p_subactivity_id;
  perform public.add_project_log(v_project,'subactivity-status','Subatividade pausada',format('“%s” foi pausada.',v_sub.title),auth.uid(),
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: set_subactivity_status (definição ativa originada em 093_taskboard_subactivity_approval_flow.sql)
create or replace function public.set_subactivity_status(p_subactivity_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_admin boolean;
  v_role public.workspace_role;
  v_now timestamptz:=now();
  v_request_id uuid;
  v_order_number text;
begin
  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then raise exception 'Status inválido'; end if;
  if p_status='in-progress' then perform public.start_subactivity(p_subactivity_id); return; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  if v_sub.status::text=p_status then return; end if;

  if p_status in ('waiting-aqs','done') and exists(
    select 1 from public.subactivity_checklist_items ci
     where ci.subactivity_id=p_subactivity_id and ci.completed_at is null
  ) then raise exception 'Finalize todos os itens do checklist antes de concluir ou enviar para AQS'; end if;

  v_request_id:=public.service_request_for_activity(v_sub.activity_id);
  if v_request_id is not null and p_status in ('done','cancelled') then
    select order_number into v_order_number from public.service_requests where id=v_request_id;
    raise exception 'A subatividade pertence à OS %. Para finalizar, envie para Aguardando AQS; somente a aprovação do AQS pode concluir o trabalho.',v_order_number;
  end if;

  v_project:=public.subactivity_project_id(p_subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);
  v_admin:=public.is_workspace_admin(v_workspace);
  v_role:=public.current_workspace_role();

  if not v_admin and (v_role<>'developer' or v_sub.assignee_id<>auth.uid()) then raise exception 'Desenvolvedor só pode alterar a própria subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_admin then raise exception 'Somente um administrador pode alterar uma subatividade finalizada'; end if;
  if v_sub.status='waiting-aqs' and not v_admin then raise exception 'Aguardando decisão do AQS'; end if;

  if v_sub.status='in-progress' then
    update public.work_sessions
       set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
     where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  end if;

  update public.subactivities
     set tracked_seconds=tracked_seconds+case when v_sub.status='in-progress' and v_sub.timer_started_at is not null then greatest(0,floor(extract(epoch from(v_now-v_sub.timer_started_at)))::bigint) else 0 end,
         status=p_status::public.subactivity_status,
         timer_started_at=null,
         completed_at=case when p_status='done' then v_now else null end,
         cancelled_at=case when p_status='cancelled' then v_now else null end,
         needs_attention=case when p_status='waiting' then needs_attention else false end,
         attention_message=case when p_status='waiting' then attention_message else null end,
         approval_user_id=case when p_status='waiting' then approval_user_id else null end,
         approval_requested_by=case when p_status='waiting' then approval_requested_by else null end,
         approval_requested_at=case when p_status='waiting' then approval_requested_at else null end
   where id=p_subactivity_id;

  if p_status='waiting-aqs' then
    perform public.enqueue_aqs_review(p_subactivity_id,auth.uid());
  else
    perform public.add_project_log(
      v_project,
      'subactivity-status',
      'Status da subatividade alterado',
      format('“%s”: %s → %s.',v_sub.title,public.taskboard_subactivity_status_label(v_sub.status::text),public.taskboard_subactivity_status_label(p_status)),
      auth.uid()
    ,
    p_subactivity_id);
  end if;
end;
$$;

-- Vínculo exato por UUID: add_subactivity (definição ativa originada em 078_taskboard_action_permissions_project_context.sql)
create or replace function public.add_subactivity(
  p_project_id uuid,p_activity_id uuid,p_title text,p_estimated_hours numeric,p_assignee_id uuid,p_status text default 'backlog'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_id uuid;
  v_activity_title text;
  v_project_name text;
  v_role text;
  v_request_id uuid;
  v_order_number text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then
    raise exception 'Atividade não pertence ao projeto';
  end if;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar subatividades';
  end if;

  if not public.taskboard_can_perform_action('createSubactivities', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite adicionar subatividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role not in ('admin','developer') and not exists(
    select 1 from public.project_members pm
     where pm.project_id=p_project_id and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para criar subatividades';
  end if;

  if length(btrim(coalesce(p_title,'')))=0 then
    raise exception 'Título da subatividade é obrigatório';
  end if;

  if public.workspace_role_of(v_workspace,p_assignee_id) not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then
    raise exception 'Status inválido';
  end if;

  v_request_id:=public.service_request_for_activity(p_activity_id);
  if v_request_id is not null and p_status in ('done','cancelled') then
    select order_number into v_order_number from public.service_requests where id=v_request_id;
    raise exception 'A atividade pertence à OS %. A nova subatividade não pode nascer concluída/cancelada; envie-a para Aguardando AQS ao finalizar.',v_order_number;
  end if;

  if p_status='in-progress' and p_assignee_id<>auth.uid() and v_role<>'admin' then
    raise exception 'Você só pode iniciar uma subatividade atribuída a você';
  end if;

  insert into public.subactivities(
    activity_id,title,status,estimated_hours,tracked_seconds,timer_started_at,
    assignee_id,created_by,completed_at,cancelled_at
  ) values(
    p_activity_id,btrim(p_title),'backlog',greatest(coalesce(p_estimated_hours,0),0),0,null,
    p_assignee_id,auth.uid(),null,null
  ) returning id into v_id;

  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values
    (v_id,p_assignee_id,auth.uid()),
    (v_id,auth.uid(),auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

  select title into v_activity_title from public.activities where id=p_activity_id;
  select name into v_project_name from public.projects where id=p_project_id;

  perform public.add_project_log(
    p_project_id,'subactivity-added','Subatividade adicionada',
    format('“%s” adicionada em “%s”.',btrim(p_title),v_activity_title),auth.uid()
  ,
    v_id);

  perform public.push_notification(
    p_assignee_id,auth.uid(),'subactivity-assigned','Você recebeu uma nova subatividade',
    format('“%s” · %s · %s',btrim(p_title),v_activity_title,v_project_name),
    p_project_id,p_activity_id,v_id
  );

  if p_status<>'backlog' then
    perform public.set_subactivity_status(v_id,p_status);
  end if;

  return v_id;
end;
$$;

-- Vínculo exato por UUID: add_subactivity_comment (definição ativa originada em 001_devboard_full_backend.sql)
create or replace function public.add_subactivity_comment(p_subactivity_id uuid,p_content text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_project uuid:=public.subactivity_project_id(p_subactivity_id); v_workspace uuid; v_sub public.subactivities%rowtype; v_activity uuid; v_preview text;
begin
  v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Comentário vazio'; end if;
  select * into v_sub from public.subactivities where id=p_subactivity_id;
  select activity_id into v_activity from public.subactivities where id=p_subactivity_id;
  insert into public.subactivity_comments(subactivity_id,author_id,content) values(p_subactivity_id,auth.uid(),btrim(p_content)) returning id into v_id;
  v_preview:=left(regexp_replace(btrim(p_content),'\s+',' ','g'),140);
  perform public.add_project_log(v_project,'comment-added','Comentário adicionado à subatividade',format('“%s” · “%s”',v_sub.title,v_preview),auth.uid(),
    p_subactivity_id);
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'subactivity-comment','Novo comentário em sua subatividade',format('“%s” · “%s”',v_sub.title,v_preview),v_project,v_activity,p_subactivity_id);
  return v_id;
end;
$$;

-- Vínculo exato por UUID: enqueue_aqs_review (definição ativa originada em 006_devboard_notify_all_aqs.sql)
create or replace function public.enqueue_aqs_review(
  p_subactivity_id uuid,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_activity uuid;
  v_workspace uuid;
  v_review uuid;
  v_sub_title text;
  v_recipient uuid;
begin
  select s.activity_id, s.title
    into v_activity, v_sub_title
  from public.subactivities s
  where s.id = p_subactivity_id;

  if v_activity is null then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.activity_project_id(v_activity);
  v_workspace := public.project_workspace_id(v_project);

  select id
    into v_review
  from public.aqs_reviews
  where subactivity_id = p_subactivity_id
    and status in ('awaiting', 'evaluating')
  order by created_at desc
  limit 1;

  if v_review is null then
    insert into public.aqs_reviews(
      workspace_id,
      project_id,
      activity_id,
      subactivity_id,
      status,
      created_by
    )
    values(
      v_workspace,
      v_project,
      v_activity,
      p_subactivity_id,
      'awaiting',
      p_actor_id
    )
    returning id into v_review;
  end if;

  perform public.add_project_log(
    v_project,
    'aqs-submitted',
    'Subatividade enviada para AQS',
    format('“%s” entrou na fila de análise.', v_sub_title),
    p_actor_id
  ,
    p_subactivity_id);

  -- Uma notificação por usuário AQS ativo do workspace.
  for v_recipient in
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id = v_workspace
      and wm.active
      and wm.role = 'aqs'::public.workspace_role
      and wm.user_id <> p_actor_id
  loop
    perform public.push_notification(
      v_recipient,
      p_actor_id,
      'aqs-awaiting',
      'Nova tarefa aguardando AQS',
      v_sub_title,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end loop;

  return v_review;
end;
$$;

-- Vínculo exato por UUID: start_aqs_review (definição ativa originada em 005_devboard_roles_aqs_topics.sql)
create or replace function public.start_aqs_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.aqs_reviews%rowtype; v_sub_title text;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Apenas AQS ou Administrador pode avaliar'; end if;
  select * into v from public.aqs_reviews where id=p_review_id for update;
  if not found then raise exception 'Revisão AQS não encontrada'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Revisão fora do seu workspace'; end if;
  if v.status='completed' or v.status='revoked' then raise exception 'Esta análise já foi finalizada'; end if;
  if v.status='evaluating' and v.assigned_aqs_id is distinct from auth.uid() and public.current_workspace_role()<>'admin' then raise exception 'Esta análise já está com outro AQS'; end if;
  update public.aqs_reviews set status='evaluating',assigned_aqs_id=auth.uid(),started_at=coalesce(started_at,now()) where id=p_review_id;
  select title into v_sub_title from public.subactivities where id=v.subactivity_id;
  perform public.add_project_log(v.project_id,'aqs-started','Análise AQS iniciada',format('“%s” está sendo avaliada.',v_sub_title),auth.uid(),
    v.subactivity_id);
end;
$$;

-- Vínculo exato por UUID: complete_aqs_review (definição ativa originada em 005_devboard_roles_aqs_topics.sql)
create or replace function public.complete_aqs_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.aqs_reviews%rowtype; v_sub public.subactivities%rowtype;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Apenas AQS ou Administrador pode concluir a análise'; end if;
  select * into v from public.aqs_reviews where id=p_review_id for update;
  if not found then raise exception 'Revisão AQS não encontrada'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Revisão fora do seu workspace'; end if;
  if v.status not in ('awaiting','evaluating') then raise exception 'Esta análise já foi finalizada'; end if;
  if v.assigned_aqs_id is not null and v.assigned_aqs_id<>auth.uid() and public.current_workspace_role()<>'admin' then raise exception 'Esta análise pertence a outro AQS'; end if;
  select * into v_sub from public.subactivities where id=v.subactivity_id for update;
  update public.aqs_reviews set status='completed',assigned_aqs_id=coalesce(assigned_aqs_id,auth.uid()),started_at=coalesce(started_at,now()),completed_at=now() where id=p_review_id;
  update public.subactivities set status='done',timer_started_at=null,completed_at=now(),cancelled_at=null,needs_attention=false,attention_message=null where id=v.subactivity_id;
  perform public.add_project_log(v.project_id,'aqs-completed','AQS aprovou a subatividade',format('“%s” foi aprovada e concluída.',v_sub.title),auth.uid(),
    v.subactivity_id);
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'aqs-approved','AQS aprovou sua subatividade',format('“%s” foi concluída após a análise.',v_sub.title),v.project_id,v.activity_id,v.subactivity_id);
end;
$$;

-- Vínculo exato por UUID: revoke_aqs_review (definição ativa originada em 093_taskboard_subactivity_approval_flow.sql)
create or replace function public.revoke_aqs_review(p_review_id uuid,p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.aqs_reviews%rowtype;
  v_sub public.subactivities%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_request_id uuid;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Apenas AQS ou Administrador pode revogar a análise'; end if;
  if length(v_reason)<3 then raise exception 'Informe o motivo da revogação'; end if;
  select * into v from public.aqs_reviews where id=p_review_id for update;
  if not found then raise exception 'Revisão AQS não encontrada'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Revisão fora do seu workspace'; end if;
  if v.status not in ('awaiting','evaluating') then raise exception 'Esta análise já foi finalizada'; end if;
  if v.assigned_aqs_id is not null and v.assigned_aqs_id<>auth.uid() and public.current_workspace_role()<>'admin' then raise exception 'Esta análise pertence a outro AQS'; end if;

  select * into v_sub from public.subactivities where id=v.subactivity_id for update;
  update public.aqs_reviews
     set status='revoked',assigned_aqs_id=coalesce(assigned_aqs_id,auth.uid()),started_at=coalesce(started_at,now()),revoked_at=now(),revoked_reason=v_reason
   where id=p_review_id;

  update public.subactivities
     set status='backlog',timer_started_at=null,completed_at=null,cancelled_at=null,needs_attention=true,attention_message=v_reason,
         approval_user_id=null,approval_requested_by=null,approval_requested_at=null
   where id=v.subactivity_id;

  v_request_id:=public.service_request_for_activity(v.activity_id);
  if v_request_id is not null then
    update public.service_requests set status='rework' where id=v_request_id and status not in ('completed','rejected','cancelled');
    perform public.service_request_add_event(
      v_request_id,'technical-subactivity-revoked','AQS solicitou ajustes',
      format('“%s” voltou para o DEV · %s',v_sub.title,v_reason),
      null,'rework'
    );
  end if;

  perform public.add_project_log(v.project_id,'aqs-revoked','AQS solicitou ajustes',format('“%s” voltou para Backlog. Motivo: %s',v_sub.title,v_reason),auth.uid(),
    v.subactivity_id);
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'aqs-revoked','AQS revogou sua subatividade',format('“%s” precisa de ajustes: %s',v_sub.title,left(v_reason,180)),v.project_id,v.activity_id,v.subactivity_id);
end;
$$;

-- Vínculo exato por UUID: developer_adjust_active_session (definição ativa originada em 022_devboard_developer_idle_adjustment.sql)
create or replace function public.developer_adjust_active_session(
  p_subactivity_id uuid,
  p_idle_seconds integer,
  p_pause boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_session public.work_sessions%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_now timestamptz := now();
  v_elapsed integer;
  v_idle integer;
  v_billable integer;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  select * into v_sub
  from public.subactivities
  where id = p_subactivity_id
  for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;
  if v_sub.assignee_id <> auth.uid() then
    raise exception 'Apenas o responsável pode ajustar a própria sessão';
  end if;
  if v_sub.status <> 'in-progress' or v_sub.timer_started_at is null then
    return;
  end if;

  select * into v_session
  from public.work_sessions
  where subactivity_id = p_subactivity_id
    and user_id = auth.uid()
    and ended_at is null
  order by started_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Sessão ativa não encontrada';
  end if;

  v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_session.started_at)))::integer);
  -- Nunca desconta toda a sessão: preserva ao menos 1 segundo quando houver tempo registrado.
  v_idle := least(greatest(0, coalesce(p_idle_seconds, 0)), greatest(0, v_elapsed - 1));
  v_billable := greatest(0, v_elapsed - v_idle);

  if p_pause then
    update public.work_sessions
       set ended_at = v_now,
           duration_seconds = v_billable
     where id = v_session.id;

    update public.subactivities
       set tracked_seconds = tracked_seconds + v_billable,
           status = 'paused',
           timer_started_at = null
     where id = p_subactivity_id;

    perform public.add_project_log(
      v_project,
      'subactivity-status',
      'Subatividade pausada após ausência',
      format('“%s” foi pausada; %s min de ausência foram desconsiderados.', v_sub.title, round(v_idle / 60.0)),
      auth.uid()
    ,
    p_subactivity_id);
  elsif v_idle > 0 then
    -- Mantém a sessão rodando, mas desloca o início para retirar somente o período ausente.
    update public.work_sessions
       set started_at = started_at + make_interval(secs => v_idle)
     where id = v_session.id;

    update public.subactivities
       set timer_started_at = timer_started_at + make_interval(secs => v_idle)
     where id = p_subactivity_id;
  end if;
end;
$$;

-- Vínculo exato por UUID: developer_agent_pause_for_idle (definição ativa originada em 071_taskboard_brainstorm_mode_and_quick_project.sql)
create or replace function public.developer_agent_pause_for_idle(
  p_agent_id uuid,
  p_agent_secret text,
  p_subactivity_id uuid,
  p_idle_seconds bigint default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_sub public.subactivities%rowtype;
  v_session public.work_sessions%rowtype;
  v_project_id uuid;
  v_activity_type_id uuid;
  v_sub_intermittent boolean := false;
  v_activity_intermittent boolean := false;
  v_elapsed bigint := 0;
  v_now timestamptz := now();
begin
  if p_agent_id is null
     or p_subactivity_id is null
     or coalesce(length(p_agent_secret), 0) < 32
     or coalesce(p_idle_seconds, 0) < 300 then
    return false;
  end if;

  select a.user_id
    into v_user_id
    from public.developer_agents a
   where a.id = p_agent_id
     and a.revoked_at is null
     and a.secret_hash = encode(digest(p_agent_secret, 'sha256'), 'hex')
   limit 1;

  if v_user_id is null then
    return false;
  end if;

  select *
    into v_sub
    from public.subactivities s
   where s.id = p_subactivity_id
     and s.assignee_id = v_user_id
   for update;

  if not found
     or v_sub.status::text <> 'in-progress'
     or v_sub.timer_started_at is null
     or coalesce(v_sub.brainstorm_mode, false) then
    return false;
  end if;

  select *
    into v_session
    from public.work_sessions ws
   where ws.subactivity_id = p_subactivity_id
     and ws.user_id = v_user_id
     and ws.ended_at is null
   order by ws.started_at desc
   limit 1
   for update;

  if not found then
    return false;
  end if;

  select ac.project_id, ac.type_id
    into v_project_id, v_activity_type_id
    from public.activities ac
   where ac.id = v_sub.activity_id;

  if v_sub.type_id is not null then
    select coalesce(wit.intermittent, false)
      into v_sub_intermittent
      from public.work_item_types wit
     where wit.id = v_sub.type_id;
  end if;

  if v_activity_type_id is not null then
    select coalesce(wit.intermittent, false)
      into v_activity_intermittent
      from public.work_item_types wit
     where wit.id = v_activity_type_id;
  end if;

  if coalesce(v_sub_intermittent, false) or coalesce(v_activity_intermittent, false) then
    return false;
  end if;

  v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_sub.timer_started_at)))::bigint);

  update public.work_sessions
     set ended_at = v_now,
         duration_seconds = greatest(0, floor(extract(epoch from (v_now - started_at)))::bigint)
   where id = v_session.id
     and ended_at is null;

  update public.subactivities
     set tracked_seconds = tracked_seconds + v_elapsed,
         status = 'paused',
         timer_started_at = null,
         updated_at = v_now
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project_id,
    'subactivity-status',
    'Subatividade pausada por inatividade',
    format(
      '“%s” foi pausada automaticamente pelo Devboard Agent após %s min sem atividade no Windows.',
      v_sub.title,
      greatest(5, ceil(coalesce(p_idle_seconds, 300)::numeric / 60.0)::int)
    ),
    v_user_id
  ,
    p_subactivity_id);

  return true;
end;
$$;

-- Vínculo exato por UUID: pause_subactivity_with_reason (definição ativa originada em 059_taskboard_pause_reason.sql)
create or replace function public.pause_subactivity_with_reason(
  p_subactivity_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_now timestamptz := now();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'Informe o motivo da pausa';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'O motivo da pausa deve ter no máximo 300 caracteres';
  end if;

  select * into v_sub
  from public.subactivities
  where id = p_subactivity_id
  for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if not public.is_workspace_admin(v_workspace)
     and (public.current_workspace_role() <> 'developer' or v_sub.assignee_id <> auth.uid()) then
    raise exception 'Desenvolvedor só pode pausar a própria subatividade';
  end if;

  if v_sub.status <> 'in-progress' then
    return;
  end if;

  update public.work_sessions
     set ended_at = v_now,
         duration_seconds = greatest(0, floor(extract(epoch from (v_now - started_at)))::bigint)
   where subactivity_id = p_subactivity_id
     and user_id = v_sub.assignee_id
     and ended_at is null;

  update public.subactivities
     set tracked_seconds = tracked_seconds + greatest(0, floor(extract(epoch from (v_now - timer_started_at)))::bigint),
         status = 'paused',
         timer_started_at = null
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project,
    'subactivity-status',
    'Subatividade pausada',
    format('“%s” foi pausada. Motivo: %s', v_sub.title, v_reason),
    auth.uid()
  ,
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: add_subactivity_checklist_item (definição ativa originada em 073_taskboard_activity_notes_and_realtime_presence.sql)
create or replace function public.add_subactivity_checklist_item(
  p_subactivity_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_status text;
  v_content text := btrim(coalesce(p_content, ''));
  v_project uuid;
  v_sub_title text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;
  if char_length(v_content) < 1 then raise exception 'Digite uma anotação'; end if;
  if char_length(v_content) > 2000 then raise exception 'A anotação deve ter no máximo 2000 caracteres'; end if;

  select s.status::text,s.title into v_status,v_sub_title
    from public.subactivities s
   where s.id=p_subactivity_id;
  if v_status is null then raise exception 'Subatividade não encontrada'; end if;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'As anotações ficam bloqueadas enquanto a subatividade está em análise ou finalizada';
  end if;

  insert into public.subactivity_checklist_items(subactivity_id,content,created_by)
  values(p_subactivity_id,v_content,auth.uid())
  returning id into v_id;

  v_project:=public.subactivity_project_id(p_subactivity_id);
  perform public.add_project_log(
    v_project,'checklist-added','Anotação adicionada',
    format('Anotação de “%s”: “%s” foi adicionada.',v_sub_title,v_content),auth.uid()
  ,
    p_subactivity_id);

  return v_id;
end;
$$;

-- Vínculo exato por UUID: set_subactivity_checklist_item_completed (definição ativa originada em 073_taskboard_activity_notes_and_realtime_presence.sql)
create or replace function public.set_subactivity_checklist_item_completed(
  p_item_id uuid,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.subactivity_checklist_items%rowtype;
  v_status text;
  v_project uuid;
  v_sub_title text;
begin
  select * into v_item
    from public.subactivity_checklist_items
   where id=p_item_id
   for update;
  if not found then raise exception 'Anotação não encontrada'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.status::text,s.title into v_status,v_sub_title
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'As anotações ficam bloqueadas enquanto a subatividade está em análise ou finalizada';
  end if;

  update public.subactivity_checklist_items
     set completed_at=case when coalesce(p_completed,false) then now() else null end,
         completed_by=case when coalesce(p_completed,false) then auth.uid() else null end,
         updated_at=now()
   where id=p_item_id;

  v_project:=public.subactivity_project_id(v_item.subactivity_id);
  perform public.add_project_log(
    v_project,
    case when coalesce(p_completed,false) then 'checklist-completed' else 'checklist-reopened' end,
    case when coalesce(p_completed,false) then 'Anotação finalizada' else 'Anotação reaberta' end,
    format('Anotação de “%s”: “%s” foi %s.',v_sub_title,v_item.content,case when coalesce(p_completed,false) then 'finalizada' else 'reaberta' end),
    auth.uid()
  ,
    v_item.subactivity_id);
end;
$$;

-- Vínculo exato por UUID: delete_subactivity_checklist_item (definição ativa originada em 073_taskboard_activity_notes_and_realtime_presence.sql)
create or replace function public.delete_subactivity_checklist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.subactivity_checklist_items%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_assignee uuid;
  v_status text;
  v_sub_title text;
begin
  select * into v_item
    from public.subactivity_checklist_items
   where id=p_item_id
   for update;
  if not found then raise exception 'Anotação não encontrada'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.assignee_id,s.status::text,s.title into v_assignee,v_status,v_sub_title
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  v_project:=public.subactivity_project_id(v_item.subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);

  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'As anotações ficam bloqueadas enquanto a subatividade está em análise ou finalizada';
  end if;

  if auth.uid()<>v_item.created_by
     and auth.uid()<>v_assignee
     and public.workspace_role_of(v_workspace,auth.uid())::text<>'admin' then
    raise exception 'Somente o autor, responsável ou administrador pode excluir esta anotação';
  end if;

  delete from public.subactivity_checklist_items where id=p_item_id;

  perform public.add_project_log(
    v_project,'checklist-removed','Anotação removida',
    format('Anotação de “%s”: “%s” foi removida.',v_sub_title,v_item.content),auth.uid()
  ,
    v_item.subactivity_id);
end;
$$;

-- Vínculo exato por UUID: set_subactivity_status_with_release_info (definição ativa originada em 068_taskboard_release_handoff_and_typing.sql)
create or replace function public.set_subactivity_status_with_release_info(
  p_subactivity_id uuid,
  p_status text,
  p_folder_path text default null,
  p_version text default null,
  p_build text default null,
  p_zip_name text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_sub_title text;
  v_folder_path text := nullif(btrim(coalesce(p_folder_path, '')), '');
  v_version text := nullif(btrim(coalesce(p_version, '')), '');
  v_build text := nullif(btrim(coalesce(p_build, '')), '');
  v_zip_name text := nullif(btrim(coalesce(p_zip_name, '')), '');
  v_details text := '';
  v_title text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_status not in ('waiting-aqs', 'done') then
    raise exception 'As informações de entrega só podem ser registradas ao concluir ou enviar para AQS';
  end if;

  if length(coalesce(v_folder_path, '')) > 1000 then
    raise exception 'O caminho da pasta é muito longo';
  end if;
  if length(coalesce(v_version, '')) > 120 then
    raise exception 'O número da versão é muito longo';
  end if;
  if length(coalesce(v_build, '')) > 120 then
    raise exception 'O número da build é muito longo';
  end if;
  if length(coalesce(v_zip_name, '')) > 255 then
    raise exception 'O nome do arquivo ZIP é muito longo';
  end if;

  select a.project_id, s.title
    into v_project_id, v_sub_title
    from public.subactivities s
    join public.activities a on a.id = s.activity_id
   where s.id = p_subactivity_id;

  if v_project_id is null then
    raise exception 'Subatividade não encontrada';
  end if;

  -- Mantém todas as validações já consolidadas no fluxo oficial de status:
  -- responsável/admin, checklist, OS vinculada, AQS e estados terminais.
  perform public.set_subactivity_status(p_subactivity_id, p_status);

  if v_folder_path is not null then
    v_details := v_details || format(E'\nPasta da versão: %s', v_folder_path);
  end if;
  if v_version is not null then
    v_details := v_details || format(E'\nVersão: %s', v_version);
  end if;
  if v_build is not null then
    v_details := v_details || format(E'\nBuild: %s', v_build);
  end if;
  if v_zip_name is not null then
    v_details := v_details || format(E'\nArquivo ZIP: %s', v_zip_name);
  end if;

  if btrim(v_details) = '' then
    v_details := E'\nNenhuma informação de versão/build, caminho de pasta ou arquivo ZIP foi informada nesta etapa.';
  end if;

  v_title := case
    when p_status = 'waiting-aqs' then 'Informações da entrega para AQS'
    else 'Informações da conclusão da subatividade'
  end;

  perform public.add_project_log(
    v_project_id,
    'subactivity-status',
    v_title,
    format('“%s”%s', v_sub_title, v_details),
    auth.uid()
  ,
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: add_subactivity_comment_v2 (definição ativa originada em 070_taskboard_todos_scope_existing_participants.sql)
create or replace function public.add_subactivity_comment_v2(
  p_subactivity_id uuid,
  p_content text,
  p_mentions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_project uuid := public.subactivity_project_id(p_subactivity_id);
  v_workspace uuid;
  v_sub public.subactivities%rowtype;
  v_activity uuid;
  v_preview text;
  v_actor_name text;
  v_project_name text;
  v_mentions jsonb := public.taskboard_filter_subactivity_broadcast_mentions(p_subactivity_id,coalesce(p_mentions,'[]'::jsonb));
  v_recipient uuid;
  v_broadcast_only boolean;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_workspace:=public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Comentário vazio'; end if;
  if length(p_content)>8000 then raise exception 'Comentário muito longo'; end if;
  if jsonb_typeof(v_mentions)<>'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(v_mentions)>250 then raise exception 'Muitas menções em um único comentário'; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_activity:=v_sub.activity_id;

  insert into public.subactivity_comments(subactivity_id,author_id,content,mentions)
  values(p_subactivity_id,auth.uid(),btrim(p_content),v_mentions)
  returning id into v_id;

  select name into v_actor_name from public.profiles where id=auth.uid();
  select name into v_project_name from public.projects where id=v_project;
  v_preview:=left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  perform public.add_project_log(
    v_project,'comment-added','Comentário adicionado à subatividade',
    format('“%s” · “%s”',v_sub.title,v_preview),auth.uid()
  ,
    p_subactivity_id);

  for v_recipient, v_broadcast_only in
    select wm.user_id,
           bool_and(lower(btrim(coalesce(value->>'label',''))) in ('todos','here')) as broadcast_only
    from jsonb_array_elements(v_mentions) value
    join public.workspace_members wm
      on wm.workspace_id=v_workspace
     and wm.active=true
     and wm.user_id=case
       when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then (value->>'id')::uuid else null end
    where value->>'kind'='user'
      and wm.user_id<>auth.uid()
    group by wm.user_id
  loop
    if not v_broadcast_only then
      insert into public.project_members(project_id,user_id,added_by)
      values(v_project,v_recipient,auth.uid())
      on conflict(project_id,user_id) do nothing;

      insert into public.subactivity_members(subactivity_id,user_id,added_by)
      values(p_subactivity_id,v_recipient,auth.uid())
      on conflict(subactivity_id,user_id) do nothing;

      insert into public.aqs_review_participants(review_id,user_id,added_by)
      select ar.id,v_recipient,auth.uid()
      from public.aqs_reviews ar
      where ar.subactivity_id=p_subactivity_id
        and ar.status in ('awaiting','evaluating')
      on conflict(review_id,user_id) do nothing;
    end if;

    perform public.push_notification(
      v_recipient,auth.uid(),'followup-mention',
      format('%s mencionou você em uma subatividade',coalesce(nullif(v_actor_name,''),'Alguém')),
      format('%s · %s · %s',coalesce(nullif(v_project_name,''),'Projeto'),v_sub.title,v_preview),
      v_project,v_activity,p_subactivity_id
    );
  end loop;

  if v_sub.assignee_id is not null
     and v_sub.assignee_id<>auth.uid()
     and not exists(
       select 1 from jsonb_array_elements(v_mentions) value
       where value->>'kind'='user' and value->>'id'=v_sub.assignee_id::text
     ) then
    perform public.push_notification(
      v_sub.assignee_id,auth.uid(),'subactivity-comment','Novo comentário em sua subatividade',
      format('“%s” · “%s”',v_sub.title,v_preview),v_project,v_activity,p_subactivity_id
    );
  end if;

  return v_id;
end;
$$;

-- Vínculo exato por UUID: taskboard_log_brainstorm_auto_end (definição ativa originada em 071_taskboard_brainstorm_mode_and_quick_project.sql)
create or replace function public.taskboard_log_brainstorm_auto_end()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_actor uuid;
begin
  if old.brainstorm_mode = true
     and new.brainstorm_mode = false
     and old.status::text = 'in-progress'
     and new.status::text <> 'in-progress' then
    select a.project_id into v_project_id
      from public.activities a
     where a.id = new.activity_id;

    v_actor := coalesce(auth.uid(), new.assignee_id);
    if v_project_id is not null then
      perform public.add_project_log(
        v_project_id,
        'subactivity-status',
        'Brainstorm encerrado',
        format('O modo Brainstorm de “%s” foi encerrado automaticamente ao sair de Em execução.', new.title),
        v_actor
      ,
    new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Vínculo exato por UUID: set_subactivity_brainstorm (definição ativa originada em 071_taskboard_brainstorm_mode_and_quick_project.sql)
create or replace function public.set_subactivity_brainstorm(
  p_subactivity_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project_id uuid;
  v_workspace_id uuid;
  v_role text;
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;
  if p_subactivity_id is null then
    raise exception 'Subatividade não informada';
  end if;

  select s.* into v_sub
    from public.subactivities s
   where s.id = p_subactivity_id
   for update;
  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  select a.project_id, p.workspace_id
    into v_project_id, v_workspace_id
    from public.activities a
    join public.projects p on p.id = a.project_id
   where a.id = v_sub.activity_id;

  if v_workspace_id is null then
    raise exception 'Projeto da subatividade não encontrado';
  end if;

  select wm.role::text into v_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = auth.uid()
     and wm.active = true
   limit 1;

  if v_role is null then
    raise exception 'Você não pertence a este workspace';
  end if;

  -- Admin pode operar qualquer subatividade. DEV somente a própria execução.
  if v_role <> 'admin' and not (v_role = 'developer' and v_sub.assignee_id = auth.uid()) then
    raise exception 'Somente o Desenvolvedor responsável ou um Administrador pode alterar o modo Brainstorm';
  end if;

  if v_enabled and v_sub.status::text <> 'in-progress' then
    raise exception 'Inicie a subatividade antes de ativar o modo Brainstorm';
  end if;

  if coalesce(v_sub.brainstorm_mode, false) = v_enabled then
    return true;
  end if;

  update public.subactivities
     set brainstorm_mode = v_enabled,
         updated_at = now()
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project_id,
    'subactivity-status',
    case when v_enabled then 'Brainstorm ativado' else 'Brainstorm encerrado' end,
    case
      when v_enabled then format('“%s” entrou em modo Brainstorm. A pausa automática por inatividade fica suspensa enquanto este modo estiver ativo.', v_sub.title)
      else format('“%s” saiu do modo Brainstorm e voltou à regra normal de inatividade.', v_sub.title)
    end,
    auth.uid()
  ,
    p_subactivity_id);

  return true;
end;
$$;

-- Vínculo exato por UUID: promote_activity_note_to_subactivity (definição ativa originada em 079_taskboard_activity_notes_history.sql)
create or replace function public.promote_activity_note_to_subactivity(
  p_note_id uuid,
  p_title text,
  p_estimated_hours numeric,
  p_assignee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.activity_notes%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_activity_title text;
  v_subactivity_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;

  select * into v_note
    from public.activity_notes
   where id = p_note_id
   for update;
  if not found then raise exception 'Anotação não encontrada'; end if;

  if v_note.deleted_at is not null then
    raise exception 'Uma anotação excluída não pode ser transformada em subatividade';
  end if;
  if v_note.converted_subactivity_id is not null then
    raise exception 'Esta anotação já foi transformada em subatividade';
  end if;
  if not public.can_manage_activity_notes(v_note.activity_id) then
    raise exception 'Sem permissão para criar subatividade nesta atividade';
  end if;
  if char_length(v_title) < 1 then raise exception 'Título da subatividade é obrigatório'; end if;

  v_project := public.activity_project_id(v_note.activity_id);
  v_workspace := public.project_workspace_id(v_project);
  if public.workspace_role_of(v_workspace, p_assignee_id)::text not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  v_subactivity_id := public.add_subactivity(
    v_project,
    v_note.activity_id,
    v_title,
    greatest(coalesce(p_estimated_hours, 0), 0),
    p_assignee_id,
    'backlog'
  );

  update public.activity_notes
     set converted_subactivity_id = v_subactivity_id,
         converted_at = now(),
         converted_by = auth.uid(),
         updated_at = now()
   where id = p_note_id;

  select title into v_activity_title from public.activities where id = v_note.activity_id;
  perform public.add_project_log(
    v_project,
    'activity-note-promoted',
    'Anotação transformada em subatividade',
    format('Em “%s”, a anotação “%s” originou a subatividade “%s”.', v_activity_title, v_note.content, v_title),
    auth.uid()
  ,
    v_subactivity_id);

  return v_subactivity_id;
end;
$$;

-- Vínculo exato por UUID: update_subactivity_admin (definição ativa originada em 074_taskboard_admin_subactivity_edit_and_team_expand.sql)
create or replace function public.update_subactivity_admin(
  p_subactivity_id uuid,
  p_title text,
  p_estimated_hours numeric,
  p_assignee_id uuid,
  p_type_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_new_title text := btrim(coalesce(p_title, ''));
  v_old_assignee_name text;
  v_new_assignee_name text;
  v_old_type_name text;
  v_new_type_name text;
  v_changes text[] := array[]::text[];
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  select * into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem editar os dados da subatividade';
  end if;

  if char_length(v_new_title) < 1 then
    raise exception 'Descrição da subatividade é obrigatória';
  end if;

  if char_length(v_new_title) > 4000 then
    raise exception 'A descrição da subatividade deve ter no máximo 4000 caracteres';
  end if;

  if coalesce(p_estimated_hours, 0) < 0 then
    raise exception 'A estimativa não pode ser negativa';
  end if;

  if p_assignee_id is null or public.workspace_role_of(v_workspace, p_assignee_id) not in ('admin', 'developer') then
    raise exception 'O responsável precisa ser um Administrador ou Desenvolvedor deste workspace';
  end if;

  if p_type_id is not null and not exists (
    select 1
      from public.work_item_types wit
     where wit.id = p_type_id
       and wit.workspace_id = v_workspace
       and (wit.active = true or wit.id = v_sub.type_id)
  ) then
    raise exception 'Tipo inválido ou inativo para este workspace';
  end if;

  if v_sub.status = 'in-progress' and p_assignee_id is distinct from v_sub.assignee_id then
    raise exception 'Pause a subatividade antes de trocar o responsável';
  end if;

  if v_sub.title is not distinct from v_new_title
     and v_sub.estimated_hours is not distinct from greatest(coalesce(p_estimated_hours, 0), 0)
     and v_sub.assignee_id is not distinct from p_assignee_id
     and v_sub.type_id is not distinct from p_type_id then
    return;
  end if;

  if v_sub.title is distinct from v_new_title then
    v_changes := array_append(v_changes, format('descrição: “%s” → “%s”', v_sub.title, v_new_title));
  end if;

  if v_sub.estimated_hours is distinct from greatest(coalesce(p_estimated_hours, 0), 0) then
    v_changes := array_append(
      v_changes,
      format('estimativa: %sh → %sh', trim(to_char(v_sub.estimated_hours, 'FM999999990.##')), trim(to_char(greatest(coalesce(p_estimated_hours, 0), 0), 'FM999999990.##')))
    );
  end if;

  if v_sub.assignee_id is distinct from p_assignee_id then
    select name into v_old_assignee_name from public.profiles where id = v_sub.assignee_id;
    select name into v_new_assignee_name from public.profiles where id = p_assignee_id;
    v_changes := array_append(v_changes, format('responsável: %s → %s', coalesce(v_old_assignee_name, 'Usuário anterior'), coalesce(v_new_assignee_name, 'Novo usuário')));
  end if;

  if v_sub.type_id is distinct from p_type_id then
    if v_sub.type_id is not null then
      select name into v_old_type_name from public.work_item_types where id = v_sub.type_id;
    end if;
    if p_type_id is not null then
      select name into v_new_type_name from public.work_item_types where id = p_type_id;
    end if;
    v_changes := array_append(v_changes, format('tipo: %s → %s', coalesce(v_old_type_name, 'Sem tipo'), coalesce(v_new_type_name, 'Sem tipo')));
  end if;

  update public.subactivities
     set title = v_new_title,
         estimated_hours = greatest(coalesce(p_estimated_hours, 0), 0),
         assignee_id = p_assignee_id,
         type_id = p_type_id,
         updated_at = now()
   where id = p_subactivity_id;

  insert into public.subactivity_members(subactivity_id, user_id, added_by)
  values (p_subactivity_id, p_assignee_id, auth.uid())
  on conflict (subactivity_id, user_id) do nothing;

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    'Subatividade atualizada',
    format('“%s” · %s.', v_new_title, array_to_string(v_changes, ' · ')),
    auth.uid()
  ,
    p_subactivity_id);

  if v_sub.assignee_id is distinct from p_assignee_id then
    perform public.push_notification(
      p_assignee_id,
      auth.uid(),
      'subactivity-assigned',
      'Você recebeu uma subatividade',
      format('“%s” foi atribuída a você por um Administrador.', v_new_title),
      v_project,
      v_sub.activity_id,
      p_subactivity_id
    );
  end if;
end;
$$;

-- Vínculo exato por UUID: set_subactivity_focus_admin (definição ativa originada em 084_taskboard_admin_focus_subactivities.sql)
create or replace function public.set_subactivity_focus_admin(
  p_subactivity_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  select *
    into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if v_workspace is null or public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem definir o Foco de hoje';
  end if;

  if coalesce(v_sub.is_focus, false) = v_enabled then
    return;
  end if;

  update public.subactivities
     set is_focus = v_enabled,
         focus_marked_at = case when v_enabled then now() else null end,
         focus_marked_by = case when v_enabled then auth.uid() else null end,
         updated_at = now()
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    case when v_enabled then 'Subatividade marcada como foco' else 'Subatividade removida do foco' end,
    format(
      '“%s” %s no bloco Foco de hoje pela administração.',
      v_sub.title,
      case when v_enabled then 'foi incluída' else 'foi removida' end
    ),
    auth.uid()
  ,
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: update_subactivity_estimate_admin (definição ativa originada em 085_taskboard_admin_subactivity_estimate_maintenance.sql)
create or replace function public.update_subactivity_estimate_admin(
  p_subactivity_id uuid,
  p_estimated_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_new_estimate numeric := greatest(coalesce(p_estimated_hours, 0), 0);
  v_old_label text;
  v_new_label text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  select *
    into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem ajustar a estimativa de horas';
  end if;

  if p_estimated_hours is null or p_estimated_hours < 0 then
    raise exception 'A estimativa precisa ser igual ou maior que zero';
  end if;

  if p_estimated_hours > 100000 then
    raise exception 'A estimativa informada é muito alta';
  end if;

  if coalesce(v_sub.estimated_hours, 0) is not distinct from v_new_estimate then
    return;
  end if;

  v_old_label := trim(to_char(coalesce(v_sub.estimated_hours, 0), 'FM999999990.##'));
  v_new_label := trim(to_char(v_new_estimate, 'FM999999990.##'));

  update public.subactivities
     set estimated_hours = v_new_estimate,
         updated_at = now()
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    'Estimativa da subatividade ajustada',
    format('“%s” · estimativa: %sh → %sh.', v_sub.title, v_old_label, v_new_label),
    auth.uid()
  ,
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: update_subactivity_time_maintenance_admin (definição ativa originada em 086_taskboard_admin_worked_hours_maintenance.sql)
create or replace function public.update_subactivity_time_maintenance_admin(
  p_subactivity_id uuid,
  p_estimated_hours numeric,
  p_tracked_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_now timestamptz := now();
  v_elapsed bigint := 0;
  v_old_total bigint := 0;
  v_new_total bigint := 0;
  v_delta bigint := 0;
  v_new_estimate numeric := 0;
  v_estimate_changed boolean := false;
  v_tracked_changed boolean := false;
  v_old_estimate_label text;
  v_new_estimate_label text;
  v_old_tracked_label text;
  v_new_tracked_label text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_estimated_hours is null or p_estimated_hours < 0 or p_estimated_hours > 100000 then
    raise exception 'A estimativa precisa ser um valor válido igual ou maior que zero';
  end if;

  if p_tracked_hours is not null and (p_tracked_hours < 0 or p_tracked_hours > 1000000) then
    raise exception 'As horas trabalhadas precisam ser um valor válido igual ou maior que zero';
  end if;

  select *
    into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem fazer manutenção das horas';
  end if;

  if v_sub.status = 'in-progress' and v_sub.timer_started_at is not null then
    v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_sub.timer_started_at)))::bigint);
  end if;

  v_old_total := greatest(0, coalesce(v_sub.tracked_seconds, 0) + coalesce(v_sub.manual_adjustment_seconds, 0) + v_elapsed);
  v_new_total := v_old_total;
  if p_tracked_hours is not null then
    v_new_total := greatest(0, round(p_tracked_hours * 3600)::bigint);
  end if;
  v_delta := v_new_total - v_old_total;
  v_new_estimate := round(p_estimated_hours, 2);

  v_estimate_changed := coalesce(v_sub.estimated_hours, 0) is distinct from v_new_estimate;
  v_tracked_changed := p_tracked_hours is not null and v_delta <> 0;

  if not v_estimate_changed and not v_tracked_changed then
    return;
  end if;

  update public.subactivities
     set estimated_hours = case when v_estimate_changed then v_new_estimate else estimated_hours end,
         manual_adjustment_seconds = case
           when v_tracked_changed then coalesce(manual_adjustment_seconds, 0) + v_delta
           else manual_adjustment_seconds
         end,
         updated_at = v_now
   where id = p_subactivity_id;

  if v_tracked_changed then
    insert into public.subactivity_time_adjustments(
      subactivity_id,
      user_id,
      adjustment_seconds,
      previous_total_seconds,
      new_total_seconds,
      adjusted_by,
      created_at
    ) values (
      p_subactivity_id,
      v_sub.assignee_id,
      v_delta,
      v_old_total,
      v_new_total,
      auth.uid(),
      v_now
    );
  end if;

  v_old_estimate_label := trim(to_char(coalesce(v_sub.estimated_hours, 0), 'FM999999990.##'));
  v_new_estimate_label := trim(to_char(v_new_estimate, 'FM999999990.##'));
  v_old_tracked_label := trim(to_char(v_old_total::numeric / 3600, 'FM999999990.##'));
  v_new_tracked_label := trim(to_char(v_new_total::numeric / 3600, 'FM999999990.##'));

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    'Manutenção de horas da subatividade',
    format(
      '“%s” · estimativa: %sh → %sh · trabalhado: %sh → %sh.',
      v_sub.title,
      v_old_estimate_label,
      v_new_estimate_label,
      v_old_tracked_label,
      v_new_tracked_label
    ),
    auth.uid()
  ,
    p_subactivity_id);
end;
$$;

-- Vínculo exato por UUID: request_subactivity_approval (definição ativa originada em 093_taskboard_subactivity_approval_flow.sql)
create or replace function public.request_subactivity_approval(
  p_subactivity_id uuid,
  p_approver_id uuid
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_activity uuid;
  v_workspace uuid;
  v_admin boolean;
  v_role public.workspace_role;
  v_now timestamptz:=now();
  v_old_label text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_approver_id is null then raise exception 'Selecione um usuário para aprovar'; end if;
  if p_approver_id=auth.uid() then raise exception 'Selecione outro usuário para realizar a aprovação'; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;

  select a.project_id,a.id into v_project,v_activity
    from public.activities a where a.id=v_sub.activity_id;
  v_workspace:=public.project_workspace_id(v_project);
  v_admin:=public.is_workspace_admin(v_workspace);
  v_role:=public.current_workspace_role();

  if not public.is_workspace_member(v_workspace,p_approver_id) then
    raise exception 'O usuário selecionado não pertence a este workspace';
  end if;

  if not v_admin and (v_role<>'developer' or v_sub.assignee_id<>auth.uid()) then
    raise exception 'Desenvolvedor só pode alterar a própria subatividade';
  end if;
  if v_sub.status in ('done','cancelled') and not v_admin then
    raise exception 'Somente um administrador pode alterar uma subatividade finalizada';
  end if;
  if v_sub.status='waiting-aqs' and not v_admin then
    raise exception 'Aguardando decisão do AQS';
  end if;

  if v_sub.status='in-progress' then
    update public.work_sessions
       set ended_at=v_now,
           duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
     where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  end if;

  update public.subactivities
     set tracked_seconds=tracked_seconds+case when v_sub.status='in-progress' and v_sub.timer_started_at is not null
       then greatest(0,floor(extract(epoch from(v_now-v_sub.timer_started_at)))::bigint) else 0 end,
         status='waiting'::public.subactivity_status,
         timer_started_at=null,
         completed_at=null,
         cancelled_at=null,
         needs_attention=false,
         attention_message=null,
         approval_user_id=p_approver_id,
         approval_requested_by=auth.uid(),
         approval_requested_at=v_now
   where id=p_subactivity_id;

  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values(p_subactivity_id,p_approver_id,auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

  v_old_label:=public.taskboard_subactivity_status_label(v_sub.status::text);
  if v_sub.status::text<>'waiting' or v_sub.approval_user_id is distinct from p_approver_id then
    perform public.add_project_log(
      v_project,
      'subactivity-status',
      'Aprovação solicitada',
      format('“%s”: %s → Aguard. Aprovação.',v_sub.title,v_old_label),
      auth.uid()
    ,
    p_subactivity_id);
  end if;

  perform public.push_notification(
    p_approver_id,
    auth.uid(),
    'subactivity-approval-request',
    'Sua aprovação foi solicitada',
    format('“%s” está aguardando sua aprovação.',v_sub.title),
    v_project,
    v_activity,
    p_subactivity_id
  );
end;
$$;

-- Vínculo exato por UUID: decide_subactivity_approval (definição ativa originada em 093_taskboard_subactivity_approval_flow.sql)
create or replace function public.decide_subactivity_approval(
  p_subactivity_id uuid,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_activity uuid;
  v_requester uuid;
  v_new_status text;
  v_new_label text;
  v_now timestamptz:=now();
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  if v_sub.status::text<>'waiting' or v_sub.approval_user_id is null then
    raise exception 'Esta subatividade não está aguardando aprovação';
  end if;
  if v_sub.approval_user_id<>auth.uid() then
    raise exception 'Somente o usuário citado pode responder esta aprovação';
  end if;

  select a.project_id,a.id into v_project,v_activity
    from public.activities a where a.id=v_sub.activity_id;

  v_requester:=v_sub.approval_requested_by;
  v_new_status:=case when p_approved then 'done' else 'backlog' end;
  v_new_label:=case when p_approved then 'Concluído' else 'Backlog' end;

  update public.subactivities
     set status=v_new_status::public.subactivity_status,
         timer_started_at=null,
         completed_at=case when p_approved then v_now else null end,
         cancelled_at=null,
         needs_attention=false,
         attention_message=null,
         approval_user_id=null,
         approval_requested_by=null,
         approval_requested_at=null
   where id=p_subactivity_id;

  perform public.add_project_log(
    v_project,
    'subactivity-status',
    case when p_approved then 'Subatividade aprovada' else 'Aprovação recusada' end,
    format('“%s”: Aguard. Aprovação → %s.',v_sub.title,v_new_label),
    auth.uid()
  ,
    p_subactivity_id);

  perform public.push_notification(
    v_requester,
    auth.uid(),
    case when p_approved then 'subactivity-approval-approved' else 'subactivity-approval-rejected' end,
    case when p_approved then 'Subatividade aprovada' else 'Aprovação recusada' end,
    case when p_approved
      then format('“%s” foi aprovada e concluída.',v_sub.title)
      else format('“%s” foi recusada e voltou para Backlog.',v_sub.title)
    end,
    v_project,
    v_activity,
    p_subactivity_id
  );

  if v_sub.assignee_id is distinct from v_requester then
    perform public.push_notification(
      v_sub.assignee_id,
      auth.uid(),
      case when p_approved then 'subactivity-approval-approved' else 'subactivity-approval-rejected' end,
      case when p_approved then 'Subatividade aprovada' else 'Aprovação recusada' end,
      case when p_approved
        then format('“%s” foi aprovada e concluída.',v_sub.title)
        else format('“%s” foi recusada e voltou para Backlog.',v_sub.title)
      end,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end if;
end;
$$;

-- Vínculo exato por UUID: log_activity_meeting_end (definição ativa originada em 069_taskboard_context_meeting_logs_and_group_mentions.sql)
create or replace function public.log_activity_meeting_end()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_context public.activity_meeting_runs%rowtype;
  v_names text;
  v_count integer:=0;
  v_seconds bigint;
  v_duration text;
  v_description text;
  v_sub_marker text := '';
begin
  if old.ended_at is not null or new.ended_at is null then return new; end if;

  select * into v_context
  from public.activity_meeting_runs
  where meeting_id=new.id;
  if not found then return new; end if;

  select count(*),string_agg(p.name,', ' order by p.name)
    into v_count,v_names
  from public.meeting_members mm
  join public.profiles p on p.id=mm.user_id
  where mm.meeting_id=new.id
    and mm.joined_at is not null;

  v_seconds:=greatest(0,extract(epoch from (new.ended_at-new.created_at))::bigint);
  v_duration:=public.format_meeting_duration(v_seconds);
  if v_context.subactivity_id is not null then
    v_sub_marker:=format('[[meeting-subactivity:%s]]',v_context.subactivity_id);
  end if;
  v_description:=format(
    '[[meeting-id:%s]][[meeting-activity:%s]]%sDuração %s · %s participante%s: %s.',
    new.id,
    v_context.activity_id,
    v_sub_marker,
    v_duration,
    v_count,
    case when v_count=1 then '' else 's' end,
    coalesce(v_names,'—')
  );

  perform public.add_project_log(
    v_context.project_id,
    'meeting-ended',
    'Ligação de reunião encerrada',
    v_description,
    new.created_by
  ,
    v_context.subactivity_id);

  if v_context.request_id is not null then
    perform public.service_request_add_event(
      v_context.request_id,
      'technical-meeting-ended',
      'Ligação de reunião encerrada',
      format('Duração %s · %s participante%s: %s.',v_duration,v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      new.created_by
    );
  end if;

  return new;
end;
$$;

-- Reunião contextual: persiste o UUID canônico no log de início.
create or replace function public.start_context_meeting(
  p_activity_id uuid,
  p_mode text default 'video',
  p_subactivity_id uuid default null,
  p_request_id uuid default null,
  p_aqs_review_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_launch jsonb;
  v_meeting_id uuid;
  v_review_subactivity uuid;
  v_effective_subactivity uuid:=p_subactivity_id;
  v_context_assigned boolean:=false;
  v_names text;
  v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  if p_subactivity_id is not null and not exists(
    select 1 from public.subactivities s
    where s.id=p_subactivity_id and s.activity_id=p_activity_id
  ) then
    raise exception 'A subatividade não pertence a esta atividade';
  end if;

  if p_request_id is not null and not exists(
    select 1 from public.service_requests r
    where r.id=p_request_id and r.activity_id=p_activity_id
  ) then
    raise exception 'A solicitação não pertence a esta atividade';
  end if;

  if p_aqs_review_id is not null then
    select ar.subactivity_id into v_review_subactivity
    from public.aqs_reviews ar
    where ar.id=p_aqs_review_id and ar.activity_id=p_activity_id;
    if v_review_subactivity is null then
      raise exception 'A análise AQS não pertence a esta atividade';
    end if;
    if v_effective_subactivity is null then v_effective_subactivity:=v_review_subactivity; end if;
    if v_effective_subactivity is distinct from v_review_subactivity then
      raise exception 'A análise AQS não pertence à subatividade informada';
    end if;
  end if;

  v_launch:=public.start_activity_meeting(p_activity_id,p_mode);
  begin
    v_meeting_id:=(v_launch->>'meetingId')::uuid;
  exception when others then
    raise exception 'A reunião foi criada sem identificador válido';
  end;

  -- Uma reunião ativa é reutilizada por atividade. O primeiro contexto específico
  -- que a originou permanece como contexto canônico; abrir a mesma sala por outro
  -- ponto do sistema não troca silenciosamente suas permissões.
  update public.activity_meeting_runs
  set subactivity_id=v_effective_subactivity,
      request_id=p_request_id,
      aqs_review_id=p_aqs_review_id
  where meeting_id=v_meeting_id
    and subactivity_id is null
    and request_id is null
    and aqs_review_id is null;
  get diagnostics v_count = row_count;
  v_context_assigned:=v_count>0;

  -- register_activity_meeting_start roda dentro de start_activity_meeting antes
  -- de o wrapper conhecer a subatividade. Depois de fixar o contexto, completa
  -- o log de início com a subatividade exata.
  if v_context_assigned and v_effective_subactivity is not null then
    update public.project_logs l
       set subactivity_id = v_effective_subactivity,
           description = case
             when coalesce(l.description,'') like '%[[meeting-subactivity:%' then l.description
             else coalesce(l.description,'') || format('[[meeting-subactivity:%s]]',v_effective_subactivity)
           end
     where l.project_id = (select a.project_id from public.activities a where a.id=p_activity_id)
       and l.type='meeting-started'
       and l.description like ('%[[meeting-id:' || v_meeting_id::text || ']]%');
  end if;

  if v_context_assigned and p_request_id is not null then
    select count(*),string_agg(p.name,', ' order by p.name)
      into v_count,v_names
    from public.meeting_members mm
    join public.profiles p on p.id=mm.user_id
    where mm.meeting_id=v_meeting_id;

    perform public.service_request_add_event(
      p_request_id,
      'technical-meeting-started',
      'Ligação de reunião iniciada',
      format('%s convidado%s: %s.',v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      auth.uid()
    );
  end if;

  return v_launch || jsonb_build_object(
    'subactivityId',v_effective_subactivity,
    'requestId',p_request_id,
    'aqsReviewId',p_aqs_review_id
  );
end;
$$;

commit;
