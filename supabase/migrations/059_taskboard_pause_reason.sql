-- TaskBoard V64 - motivo explícito em pausas manuais de subatividade.
-- Mantém pause_subactivity(uuid) intacta para automações e clientes antigos.

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
  );
end;
$$;

revoke execute on function public.pause_subactivity_with_reason(uuid, text) from public, anon;
grant execute on function public.pause_subactivity_with_reason(uuid, text) to authenticated;
