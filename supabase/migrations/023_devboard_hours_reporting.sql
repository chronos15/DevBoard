-- Devboard · Controle de horas
-- Apuração profissional por período/projeto/responsável e isolamento dos registros
-- para usuários que não são administradores.

-- Helper específico para a policy de work_sessions.
-- Não expomos is_workspace_admin(...) diretamente ao cliente porque ela aceita um user_id
-- arbitrário; esta função sempre avalia o usuário autenticado e somente a sessão recebida.
create or replace function public.can_read_work_session(
  p_subactivity_id uuid,
  p_session_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and (
      p_session_user_id = auth.uid()
      or exists (
        select 1
        from public.subactivities s
        join public.activities a on a.id = s.activity_id
        join public.projects p on p.id = a.project_id
        join public.workspace_members wm on wm.workspace_id = p.workspace_id
        where s.id = p_subactivity_id
          and wm.user_id = auth.uid()
          and wm.active
          and wm.role = 'admin'
      )
    );
$$;

revoke execute on function public.can_read_work_session(uuid,uuid) from public, anon, authenticated;
grant execute on function public.can_read_work_session(uuid,uuid) to authenticated;

-- A leitura direta de work_sessions segue o mesmo princípio da tela:
-- administrador pode consultar o workspace; os demais usuários veem somente os próprios registros.
drop policy if exists cadence_work_sessions_select on public.work_sessions;
create policy cadence_work_sessions_select
on public.work_sessions
for select
to authenticated
using (public.can_read_work_session(subactivity_id, user_id));

create or replace function public.hours_report(
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
  reported_seconds bigint
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
  v_is_admin := public.is_workspace_admin(v_workspace);

  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.workspace_id = v_workspace
  ) then
    raise exception 'Projeto inválido para este workspace';
  end if;

  if not v_is_admin and p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'Você pode consultar somente seus próprios registros';
  end if;

  return query
  select
    ws.id,
    ws.subactivity_id,
    ws.user_id,
    p.id,
    p.name,
    a.id,
    a.title,
    s.title,
    s.status::text,
    s.estimated_hours,
    ws.started_at,
    ws.ended_at,
    case
      when ws.ended_at is null then
        greatest(
          0,
          floor(extract(epoch from (
            least(now(), p_end) - greatest(ws.started_at, p_start)
          )))::bigint
        )
      when ws.started_at >= p_start and ws.ended_at <= p_end then
        ws.duration_seconds
      else
        -- Para sessões que atravessam a borda do período, preserva eventuais
        -- descontos de inatividade distribuindo o duration_seconds proporcionalmente.
        greatest(
          0,
          floor(
            ws.duration_seconds::numeric
            * greatest(0, extract(epoch from (least(ws.ended_at, p_end) - greatest(ws.started_at, p_start))))
            / greatest(1, extract(epoch from (ws.ended_at - ws.started_at)))
          )::bigint
        )
    end as reported_seconds
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
  order by ws.started_at desc;
end;
$$;

revoke execute on function public.hours_report(timestamptz,timestamptz,uuid,uuid) from public, anon;
grant execute on function public.hours_report(timestamptz,timestamptz,uuid,uuid) to authenticated;
