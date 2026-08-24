-- Devboard · Painel Dev
-- Detecção de inatividade pelo Agent e ajuste seguro da sessão ativa.

alter table public.developer_settings
  add column if not exists idle_detection_enabled boolean not null default true,
  add column if not exists idle_threshold_minutes integer not null default 10;

alter table public.developer_settings
  drop constraint if exists developer_settings_idle_threshold_minutes_check;
alter table public.developer_settings
  add constraint developer_settings_idle_threshold_minutes_check
  check (idle_threshold_minutes between 3 and 120);

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
    );
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

revoke execute on function public.developer_adjust_active_session(uuid, integer, boolean) from public, anon;
grant execute on function public.developer_adjust_active_session(uuid, integer, boolean) to authenticated;
