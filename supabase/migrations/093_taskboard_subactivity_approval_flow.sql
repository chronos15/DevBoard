begin;

-- TaskBoard V177
-- Aprovação simples por usuário usando o status técnico "waiting".
-- O enum não é alterado para preservar compatibilidade com todo o projeto.

alter table public.subactivities
  add column if not exists approval_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists approval_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists approval_requested_at timestamptz;

create index if not exists subactivities_approval_user_idx
  on public.subactivities(approval_user_id,status)
  where approval_user_id is not null;

comment on column public.subactivities.approval_user_id is 'Usuário responsável pela aprovação quando status=waiting (Aguard. Aprovação).';
comment on column public.subactivities.approval_requested_by is 'Usuário que solicitou a aprovação.';
comment on column public.subactivities.approval_requested_at is 'Momento em que a aprovação foi solicitada.';

create or replace function public.taskboard_subactivity_status_label(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'backlog' then 'Backlog'
    when 'waiting' then 'Aguard. Aprovação'
    when 'waiting-aqs' then 'Aguardando AQS'
    when 'in-progress' then 'Executando'
    when 'paused' then 'Pausada'
    when 'done' then 'Concluído'
    when 'cancelled' then 'Cancelado'
    else coalesce(p_status,'Status')
  end
$$;

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
    );
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
  );

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

revoke execute on function public.request_subactivity_approval(uuid,uuid) from public,anon;
revoke execute on function public.decide_subactivity_approval(uuid,boolean) from public,anon;
grant execute on function public.request_subactivity_approval(uuid,uuid) to authenticated;
grant execute on function public.decide_subactivity_approval(uuid,boolean) to authenticated;

-- "waiting" agora é reservado para aprovação simples. Quando o AQS devolve
-- uma análise, a subatividade retorna ao Backlog para não criar uma aprovação sem destinatário.
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

  perform public.add_project_log(v.project_id,'aqs-revoked','AQS solicitou ajustes',format('“%s” voltou para Backlog. Motivo: %s',v_sub.title,v_reason),auth.uid());
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'aqs-revoked','AQS revogou sua subatividade',format('“%s” precisa de ajustes: %s',v_sub.title,left(v_reason,180)),v.project_id,v.activity_id,v.subactivity_id);
end;
$$;

-- Mantém as regras existentes e apenas localiza os logs de mudança de status.
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
    );
  end if;
end;
$$;

revoke execute on function public.set_subactivity_status(uuid,text) from public,anon;
grant execute on function public.set_subactivity_status(uuid,text) to authenticated;

-- Atualiza também o texto das notificações de acompanhamento para o novo rótulo.
create or replace function public.followup_subactivity_update_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_description text;
  v_old_status text;
  v_new_status text;
begin
  if new.title is not distinct from old.title
     and new.status is not distinct from old.status
     and new.assignee_id is not distinct from old.assignee_id
     and new.estimated_hours is not distinct from old.estimated_hours then
    return new;
  end if;

  if new.status is distinct from old.status then
    v_old_status := public.taskboard_subactivity_status_label(old.status::text);
    v_new_status := public.taskboard_subactivity_status_label(new.status::text);
    v_description := format('“%s” · %s → %s',new.title,v_old_status,v_new_status);
  elsif new.title is distinct from old.title then
    v_description := format('“%s” agora se chama “%s”.',old.title,new.title);
  elsif new.assignee_id is distinct from old.assignee_id then
    v_description := format('O responsável por “%s” foi alterado.',new.title);
  else
    v_description := format('A estimativa de “%s” foi alterada.',new.title);
  end if;

  perform public.notify_followup_subactivity_participants(
    new.id,auth.uid(),
    case when new.status is distinct from old.status then 'Status atualizado' else 'Subatividade atualizada' end,
    v_description
  );
  return new;
end;
$$;

commit;
