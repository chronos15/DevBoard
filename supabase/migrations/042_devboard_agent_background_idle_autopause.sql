begin;

-- =============================================================================
-- 042 · Auto-pausa por inatividade supervisionada pelo Devboard Agent (Windows)
-- =============================================================================
-- Permite ao Agent recuperar a sessão ativa e pausá-la sem depender de uma
-- sessão do navegador/PWA. A autenticação é feita pelo agent_id + segredo de
-- 256 bits emitido na instalação. O Agent só pode consultar/pausar o próprio
-- apontamento e a regra de tipos intermitentes é revalidada no banco.

create or replace function public.developer_agent_active_timer(
  p_agent_id uuid,
  p_agent_secret text
)
returns table(
  subactivity_id uuid,
  activity_id uuid,
  project_id uuid,
  subactivity_title text,
  activity_title text,
  project_name text,
  timer_started_at timestamptz,
  session_started_at timestamptz,
  intermittent boolean
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if p_agent_id is null or coalesce(length(p_agent_secret), 0) < 32 then
    return;
  end if;

  select a.user_id
    into v_user_id
    from public.developer_agents a
   where a.id = p_agent_id
     and a.revoked_at is null
     and a.secret_hash = encode(digest(p_agent_secret, 'sha256'), 'hex')
   limit 1;

  if v_user_id is null then
    return;
  end if;

  return query
  select
    s.id,
    ac.id,
    p.id,
    s.title,
    ac.title,
    p.name,
    s.timer_started_at,
    ws.started_at,
    coalesce(st.intermittent, false) or coalesce(at.intermittent, false)
  from public.work_sessions ws
  join public.subactivities s on s.id = ws.subactivity_id
  join public.activities ac on ac.id = s.activity_id
  join public.projects p on p.id = ac.project_id
  left join public.work_item_types st on st.id = s.type_id
  left join public.work_item_types at on at.id = ac.type_id
  where ws.user_id = v_user_id
    and ws.ended_at is null
    and s.assignee_id = v_user_id
    and s.status = 'in-progress'
  order by ws.started_at desc
  limit 1;
end;
$$;

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

  if not found or v_sub.status <> 'in-progress' or v_sub.timer_started_at is null then
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

  -- A característica pode ter sido alterada enquanto o Agent estava contando.
  -- Revalidamos no último instante e não pausamos itens intermitentes.
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
  );

  return true;
end;
$$;

revoke all on function public.developer_agent_active_timer(uuid,text) from public;
revoke all on function public.developer_agent_pause_for_idle(uuid,text,uuid,bigint) from public;

-- As RPCs precisam ser invocáveis pelo Agent sem JWT do usuário. A autorização
-- real é o segredo individual do Agent e ambas limitam o escopo ao user_id dele.
grant execute on function public.developer_agent_active_timer(uuid,text) to anon, authenticated;
grant execute on function public.developer_agent_pause_for_idle(uuid,text,uuid,bigint) to anon, authenticated;

commit;
