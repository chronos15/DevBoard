-- TaskBoard V192 · Aprovação persistente em "Subatividades recentes"
--
-- A solicitação de aprovação deixa de gerar uma notificação comum. O estado
-- persistente continua sendo a própria subatividade (status=waiting +
-- approval_user_id), permitindo que a UI mostre a pendência até o usuário
-- aprovar ou devolver para Backlog.

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
      format('“%s”: %s → Ag. Aprovação.',v_sub.title,v_old_label),
      auth.uid(),
      p_subactivity_id
    );
  end if;

  -- Intencionalmente não chama push_notification aqui. A pendência de aprovação
  -- é apresentada de forma persistente em "Subatividades recentes" enquanto
  -- approval_user_id apontar para o usuário citado.
end;
$$;

revoke execute on function public.request_subactivity_approval(uuid,uuid) from public,anon;
grant execute on function public.request_subactivity_approval(uuid,uuid) to authenticated;
