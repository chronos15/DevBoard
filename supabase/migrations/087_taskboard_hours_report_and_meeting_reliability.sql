-- TaskBoard V111 · apuração de horas + confiabilidade das reuniões
-- Execute após 086_taskboard_admin_worked_hours_maintenance.sql.
--
-- 1) Corrige hours_report(): a versão 086 introduziu um CTE e o SELECT final
--    usava nomes iguais aos parâmetros OUT da RETURNS TABLE sem qualificação.
--    Em PL/pgSQL isso pode gerar "column reference ... is ambiguous" em runtime.
--    A regra permanece: Admin vê todo o workspace; demais usuários veem apenas
--    os próprios apontamentos.
-- 2) Gravação de reunião passa a ser estritamente owner-only. Nenhum convidado
--    pode assumir a gravação após timeout nem publicar o vídeo da reunião.

begin;

-- ---------------------------------------------------------------------------
-- Controle de horas
-- ---------------------------------------------------------------------------

drop function if exists public.hours_report(timestamptz,timestamptz,uuid,uuid);

create function public.hours_report(
  p_start timestamptz,
  p_end timestamptz,
  p_project_id uuid default null,
  p_user_id uuid default null
)
returns table (
  session_id uuid,
  subactivity_id uuid,
  user_id uuid,
  project_id uuid,
  project_name text,
  activity_id uuid,
  activity_title text,
  subactivity_title text,
  subactivity_status text,
  estimated_hours numeric,
  started_at timestamptz,
  ended_at timestamptz,
  reported_seconds bigint,
  is_adjustment boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid;
  v_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Período inválido';
  end if;

  v_workspace := public.current_workspace_id();
  if v_workspace is null then
    raise exception 'Workspace não encontrado';
  end if;

  select exists (
    select 1
      from public.workspace_members wm
     where wm.workspace_id = v_workspace
       and wm.user_id = auth.uid()
       and wm.active
       and wm.role = 'admin'
  ) into v_is_admin;

  if p_project_id is not null and not exists (
    select 1
      from public.projects p
     where p.id = p_project_id
       and p.workspace_id = v_workspace
  ) then
    raise exception 'Projeto inválido para este workspace';
  end if;

  if not v_is_admin and p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'Você pode consultar somente seus próprios registros';
  end if;

  return query
  with report_rows as (
    select
      ws.id as row_id,
      ws.subactivity_id as row_subactivity_id,
      ws.user_id as row_user_id,
      p.id as row_project_id,
      p.name as row_project_name,
      a.id as row_activity_id,
      a.title as row_activity_title,
      s.title as row_subactivity_title,
      s.status::text as row_subactivity_status,
      s.estimated_hours as row_estimated_hours,
      ws.started_at as row_started_at,
      ws.ended_at as row_ended_at,
      case
        when ws.ended_at is null then
          greatest(
            0,
            floor(extract(epoch from (least(now(), p_end) - greatest(ws.started_at, p_start))))::bigint
          )
        when ws.started_at >= p_start and ws.ended_at <= p_end then ws.duration_seconds
        else greatest(
          0,
          floor(
            ws.duration_seconds::numeric
            * greatest(0, extract(epoch from (least(ws.ended_at, p_end) - greatest(ws.started_at, p_start))))
            / greatest(1, extract(epoch from (ws.ended_at - ws.started_at)))
          )::bigint
        )
      end as row_seconds,
      false as row_is_adjustment
    from public.work_sessions ws
    join public.subactivities s on s.id = ws.subactivity_id
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
    where p.workspace_id = v_workspace
      and ws.started_at < p_end
      and coalesce(ws.ended_at, now()) > p_start
      and (p_project_id is null or p.id = p_project_id)
      and (
        (v_is_admin and (p_user_id is null or ws.user_id = p_user_id))
        or (not v_is_admin and ws.user_id = auth.uid())
      )

    union all

    select
      adj.id as row_id,
      adj.subactivity_id as row_subactivity_id,
      adj.user_id as row_user_id,
      p.id as row_project_id,
      p.name as row_project_name,
      a.id as row_activity_id,
      a.title as row_activity_title,
      s.title as row_subactivity_title,
      s.status::text as row_subactivity_status,
      s.estimated_hours as row_estimated_hours,
      adj.created_at as row_started_at,
      adj.created_at as row_ended_at,
      adj.adjustment_seconds as row_seconds,
      true as row_is_adjustment
    from public.subactivity_time_adjustments adj
    join public.subactivities s on s.id = adj.subactivity_id
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
    where p.workspace_id = v_workspace
      and adj.created_at >= p_start
      and adj.created_at < p_end
      and (p_project_id is null or p.id = p_project_id)
      and (
        (v_is_admin and (p_user_id is null or adj.user_id = p_user_id))
        or (not v_is_admin and adj.user_id = auth.uid())
      )
  )
  select
    rr.row_id,
    rr.row_subactivity_id,
    rr.row_user_id,
    rr.row_project_id,
    rr.row_project_name,
    rr.row_activity_id,
    rr.row_activity_title,
    rr.row_subactivity_title,
    rr.row_subactivity_status,
    rr.row_estimated_hours,
    rr.row_started_at,
    rr.row_ended_at,
    rr.row_seconds,
    rr.row_is_adjustment
  from report_rows rr
  order by rr.row_started_at desc;
end;
$$;

revoke all on function public.hours_report(timestamptz,timestamptz,uuid,uuid) from public, anon, authenticated;
grant execute on function public.hours_report(timestamptz,timestamptz,uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Gravação de reunião: owner-only
-- ---------------------------------------------------------------------------

-- Reuniões ainda abertas/pendentes que tenham sido assumidas por convidado em
-- versões anteriores voltam para o criador. Gravações já publicadas não são
-- reescritas para preservar auditoria histórica.
update public.meeting_recordings mr
   set recorder_user_id = m.created_by,
       status = case when mr.status = 'finalizing' then 'recording' else mr.status end,
       heartbeat_at = now(),
       error_text = null,
       updated_at = now()
  from public.meetings m
 where m.id = mr.meeting_id
   and mr.status <> 'published'
   and mr.recorder_user_id is distinct from m.created_by;

create or replace function public.enforce_meeting_recording_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select m.created_by into v_owner
    from public.meetings m
   where m.id = new.meeting_id;

  if v_owner is null then
    raise exception 'Reunião não encontrada';
  end if;

  if new.recorder_user_id is distinct from v_owner then
    raise exception 'Somente o criador da reunião pode ser responsável pela gravação';
  end if;

  return new;
end;
$$;

drop trigger if exists meeting_recordings_owner_only on public.meeting_recordings;
create trigger meeting_recordings_owner_only
before insert or update of recorder_user_id on public.meeting_recordings
for each row execute function public.enforce_meeting_recording_owner();

create or replace function public.claim_meeting_recording(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_context public.activity_meeting_runs%rowtype;
  v_recording public.meeting_recordings%rowtype;
  v_can_record boolean := false;
  v_has_context boolean := false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting
    from public.meetings
   where id = p_meeting_id;

  if not found or v_meeting.ended_at is not null then
    raise exception 'Esta reunião não está mais em andamento';
  end if;

  if not exists (
    select 1
      from public.meeting_members mm
     where mm.meeting_id = p_meeting_id
       and mm.user_id = auth.uid()
       and mm.status = 'joined'
  ) then
    raise exception 'Entre na reunião antes de consultar a gravação';
  end if;

  select * into v_context
    from public.activity_meeting_runs
   where meeting_id = p_meeting_id;
  v_has_context := found;

  if not v_has_context then
    return jsonb_build_object(
      'canRecord', false,
      'hasContext', false,
      'status', 'unavailable',
      'recorderId', v_meeting.created_by
    );
  end if;

  select * into v_recording
    from public.meeting_recordings
   where meeting_id = p_meeting_id
   for update;

  -- Participantes nunca assumem a gravação. Eles podem apenas consultar o
  -- estado atual para exibir a UI da reunião.
  if auth.uid() <> v_meeting.created_by then
    return jsonb_build_object(
      'canRecord', false,
      'hasContext', true,
      'status', coalesce(v_recording.status, 'waiting'),
      'recorderId', coalesce(v_recording.recorder_user_id, v_meeting.created_by),
      'workspaceId', v_meeting.workspace_id,
      'projectId', v_context.project_id,
      'activityId', v_context.activity_id,
      'subactivityId', v_context.subactivity_id,
      'requestId', v_context.request_id,
      'aqsReviewId', v_context.aqs_review_id
    );
  end if;

  if v_recording.meeting_id is null then
    insert into public.meeting_recordings(
      meeting_id, workspace_id, recorder_user_id, status, heartbeat_at, updated_at
    ) values (
      p_meeting_id, v_meeting.workspace_id, v_meeting.created_by, 'recording', now(), now()
    )
    returning * into v_recording;
  elsif v_recording.status = 'failed' then
    update public.meeting_recordings
       set recorder_user_id = v_meeting.created_by,
           status = 'recording',
           heartbeat_at = now(),
           error_text = null,
           updated_at = now()
     where meeting_id = p_meeting_id
     returning * into v_recording;
  elsif v_recording.recorder_user_id is distinct from v_meeting.created_by then
    update public.meeting_recordings
       set recorder_user_id = v_meeting.created_by,
           status = case when status = 'published' then status else 'recording' end,
           heartbeat_at = now(),
           error_text = null,
           updated_at = now()
     where meeting_id = p_meeting_id
     returning * into v_recording;
  elsif v_recording.status = 'recording' then
    update public.meeting_recordings
       set heartbeat_at = now(), updated_at = now()
     where meeting_id = p_meeting_id
     returning * into v_recording;
  end if;

  v_can_record := v_recording.status = 'recording'
                  and v_recording.recorder_user_id = auth.uid();

  return jsonb_build_object(
    'canRecord', v_can_record,
    'hasContext', true,
    'status', coalesce(v_recording.status, 'waiting'),
    'recorderId', v_meeting.created_by,
    'workspaceId', v_meeting.workspace_id,
    'projectId', v_context.project_id,
    'activityId', v_context.activity_id,
    'subactivityId', v_context.subactivity_id,
    'requestId', v_context.request_id,
    'aqsReviewId', v_context.aqs_review_id
  );
end;
$$;

revoke all on function public.enforce_meeting_recording_owner() from public, anon, authenticated;
revoke all on function public.claim_meeting_recording(uuid) from public, anon, authenticated;
grant execute on function public.claim_meeting_recording(uuid) to authenticated;

commit;
