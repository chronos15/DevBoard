begin;

-- =============================================================================
-- 071 · Brainstorm por subatividade + proteção contra auto-pausa
-- =============================================================================
-- O modo Brainstorm é temporário e só pode existir enquanto a subatividade
-- está em execução. Ele NÃO altera o cronômetro nem o status; apenas sinaliza
-- que a execução está em discussão/levantamento e, por isso, deve ser ignorada
-- pelos mecanismos automáticos de pausa por inatividade.

alter table public.subactivities
  add column if not exists brainstorm_mode boolean not null default false;

comment on column public.subactivities.brainstorm_mode is
  'Quando true, a subatividade em execução está em modo Brainstorm e não pode ser pausada automaticamente por inatividade.';

alter table public.subactivities
  drop constraint if exists subactivities_brainstorm_requires_running;
alter table public.subactivities
  add constraint subactivities_brainstorm_requires_running
  check (not brainstorm_mode or status::text = 'in-progress');

-- Mantém a regra estrutural no banco: ao sair de Em execução, Brainstorm é
-- encerrado automaticamente. Isso protege inclusive clientes antigos.
create or replace function public.taskboard_clear_brainstorm_when_not_running()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status::text <> 'in-progress' then
    new.brainstorm_mode := false;
  end if;
  return new;
end;
$$;

drop trigger if exists taskboard_subactivity_clear_brainstorm on public.subactivities;
create trigger taskboard_subactivity_clear_brainstorm
before insert or update of status on public.subactivities
for each row execute function public.taskboard_clear_brainstorm_when_not_running();

-- Registra quando o status encerra automaticamente um Brainstorm que ainda
-- estava ativo. O liga/desliga manual é registrado pela RPC abaixo.
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
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists taskboard_subactivity_log_brainstorm_auto_end on public.subactivities;
create trigger taskboard_subactivity_log_brainstorm_auto_end
after update of status on public.subactivities
for each row execute function public.taskboard_log_brainstorm_auto_end();

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
  );

  return true;
end;
$$;

revoke all on function public.set_subactivity_brainstorm(uuid,boolean) from public, anon;
grant execute on function public.set_subactivity_brainstorm(uuid,boolean) to authenticated;

-- O Agent usa o campo "intermittent" como sinal universal de que a sessão não
-- deve entrar na contagem automática. Brainstorm passa a participar desse sinal
-- sem exigir atualização do executável nativo já instalado.
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
    coalesce(s.brainstorm_mode, false)
      or coalesce(st.intermittent, false)
      or coalesce(at.intermittent, false)
  from public.work_sessions ws
  join public.subactivities s on s.id = ws.subactivity_id
  join public.activities ac on ac.id = s.activity_id
  join public.projects p on p.id = ac.project_id
  left join public.work_item_types st on st.id = s.type_id
  left join public.work_item_types at on at.id = ac.type_id
  where ws.user_id = v_user_id
    and ws.ended_at is null
    and s.assignee_id = v_user_id
    and s.status::text = 'in-progress'
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
  );

  return true;
end;
$$;

revoke all on function public.developer_agent_active_timer(uuid,text) from public;
revoke all on function public.developer_agent_pause_for_idle(uuid,text,uuid,bigint) from public;
grant execute on function public.developer_agent_active_timer(uuid,text) to anon, authenticated;
grant execute on function public.developer_agent_pause_for_idle(uuid,text,uuid,bigint) to anon, authenticated;

commit;
