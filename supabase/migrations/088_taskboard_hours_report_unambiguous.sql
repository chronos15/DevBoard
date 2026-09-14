-- TaskBoard V114 · hours_report sem ambiguidade PL/pgSQL
-- Execute após 087_taskboard_hours_report_and_meeting_reliability.sql.
--
-- Corrige definitivamente o erro PostgreSQL 42702:
--   column reference "subactivity_id" is ambiguous
--
-- A função passa a ser LANGUAGE SQL. Dessa forma os nomes definidos em
-- RETURNS TABLE não viram variáveis procedurais e não podem conflitar com
-- colunas de work_sessions/subactivities/subactivity_time_adjustments.
--
-- Regra de acesso preservada:
--   • Admin: todo o workspace, opcionalmente filtrado por usuário/projeto.
--   • Demais usuários: somente auth.uid(), mesmo que p_user_id tente apontar
--     para outra pessoa.

begin;

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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with caller_base as (
    select
      auth.uid() as caller_id,
      public.current_workspace_id() as workspace_id
  ),
  caller_context as (
    select
      cb.caller_id,
      cb.workspace_id,
      exists (
        select 1
          from public.workspace_members wm
         where wm.workspace_id = cb.workspace_id
           and wm.user_id = cb.caller_id
           and wm.active
           and wm.role = 'admin'
      ) as is_admin
    from caller_base cb
  ),
  report_rows as (
    select
      ws.id as r_session_id,
      ws.subactivity_id as r_subactivity_id,
      ws.user_id as r_user_id,
      p.id as r_project_id,
      p.name as r_project_name,
      a.id as r_activity_id,
      a.title as r_activity_title,
      s.title as r_subactivity_title,
      s.status::text as r_subactivity_status,
      s.estimated_hours as r_estimated_hours,
      ws.started_at as r_started_at,
      ws.ended_at as r_ended_at,
      case
        when ws.ended_at is null then
          greatest(
            0,
            floor(
              extract(
                epoch from (
                  least(now(), p_end) - greatest(ws.started_at, p_start)
                )
              )
            )::bigint
          )
        when ws.started_at >= p_start and ws.ended_at <= p_end then
          coalesce(ws.duration_seconds, 0)::bigint
        else
          greatest(
            0,
            floor(
              coalesce(ws.duration_seconds, 0)::numeric
              * greatest(
                  0,
                  extract(
                    epoch from (
                      least(ws.ended_at, p_end) - greatest(ws.started_at, p_start)
                    )
                  )
                )
              / greatest(
                  1,
                  extract(epoch from (ws.ended_at - ws.started_at))
                )
            )::bigint
          )
      end as r_reported_seconds,
      false as r_is_adjustment
    from public.work_sessions ws
    join public.subactivities s on s.id = ws.subactivity_id
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
    cross join caller_context cc
    where cc.caller_id is not null
      and cc.workspace_id is not null
      and p_start is not null
      and p_end is not null
      and p_end > p_start
      and p.workspace_id = cc.workspace_id
      and ws.started_at < p_end
      and coalesce(ws.ended_at, now()) > p_start
      and (p_project_id is null or p.id = p_project_id)
      and (
        (cc.is_admin and (p_user_id is null or ws.user_id = p_user_id))
        or (not cc.is_admin and ws.user_id = cc.caller_id)
      )

    union all

    select
      adj.id as r_session_id,
      adj.subactivity_id as r_subactivity_id,
      adj.user_id as r_user_id,
      p.id as r_project_id,
      p.name as r_project_name,
      a.id as r_activity_id,
      a.title as r_activity_title,
      s.title as r_subactivity_title,
      s.status::text as r_subactivity_status,
      s.estimated_hours as r_estimated_hours,
      adj.created_at as r_started_at,
      adj.created_at as r_ended_at,
      adj.adjustment_seconds::bigint as r_reported_seconds,
      true as r_is_adjustment
    from public.subactivity_time_adjustments adj
    join public.subactivities s on s.id = adj.subactivity_id
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
    cross join caller_context cc
    where cc.caller_id is not null
      and cc.workspace_id is not null
      and p_start is not null
      and p_end is not null
      and p_end > p_start
      and p.workspace_id = cc.workspace_id
      and adj.created_at >= p_start
      and adj.created_at < p_end
      and (p_project_id is null or p.id = p_project_id)
      and (
        (cc.is_admin and (p_user_id is null or adj.user_id = p_user_id))
        or (not cc.is_admin and adj.user_id = cc.caller_id)
      )
  )
  select
    rr.r_session_id,
    rr.r_subactivity_id,
    rr.r_user_id,
    rr.r_project_id,
    rr.r_project_name,
    rr.r_activity_id,
    rr.r_activity_title,
    rr.r_subactivity_title,
    rr.r_subactivity_status,
    rr.r_estimated_hours,
    rr.r_started_at,
    rr.r_ended_at,
    rr.r_reported_seconds,
    rr.r_is_adjustment
  from report_rows rr
  order by rr.r_started_at desc, rr.r_session_id desc;
$$;

revoke all on function public.hours_report(timestamptz,timestamptz,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.hours_report(timestamptz,timestamptz,uuid,uuid)
  to authenticated;

commit;
