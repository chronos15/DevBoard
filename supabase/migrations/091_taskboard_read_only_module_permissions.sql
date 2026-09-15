-- TaskBoard V161 · READ ONLY por módulo, inclusive entre administradores
-- Execute depois da migration 090.
--
-- Objetivo:
--   * manter a role (inclusive Admin) separada do modo de operação;
--   * permitir Completo / Somente leitura / Sem acesso por módulo;
--   * impedir que um Admin configurado como observador recupere escrita pela
--     própria tela de Configurações quando ela estiver em READ ONLY.

begin;

alter table public.workspace_member_access_profiles
  add column if not exists read_only_screens jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='workspace_member_access_profiles_read_only_object'
      and conrelid='public.workspace_member_access_profiles'::regclass
  ) then
    alter table public.workspace_member_access_profiles
      add constraint workspace_member_access_profiles_read_only_object
      check (jsonb_typeof(read_only_screens)='object');
  end if;
end $$;

create or replace function public.taskboard_default_screen_permissions(p_role text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'dashboard', true,
    'developer', p_role='developer',
    'projects', p_role in ('admin','developer'),
    'followup', true,
    'requests', true,
    'requestsAqs', p_role in ('admin','aqs'),
    'requestsDev', p_role in ('admin','developer'),
    'analysis', p_role in ('admin','developer','aqs'),
    'hours', p_role in ('admin','developer'),
    'agenda', p_role in ('admin','developer'),
    'chat', true,
    'reports', p_role='admin',
    'settings', true
  );
$$;

create or replace function public.taskboard_default_read_only_screens()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'dashboard', false,
    'developer', false,
    'projects', false,
    'followup', false,
    'requests', false,
    'requestsAqs', false,
    'requestsDev', false,
    'analysis', false,
    'hours', false,
    'agenda', false,
    'chat', false,
    'reports', false,
    'settings', false
  );
$$;

create or replace function public.taskboard_can_write_screen(
  p_screen text,
  p_workspace uuid default public.current_workspace_id(),
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when p_screen not in ('dashboard','developer','projects','followup','requests','requestsAqs','requestsDev','analysis','hours','agenda','chat','reports','settings') then false
      -- O perfil personalizado é restritivo: nunca promove a role base.
      when coalesce(((public.taskboard_default_screen_permissions(wm.role::text) ->> p_screen)::boolean),false)=false then false
      when coalesce(ap.enabled,false)=false then true
      when coalesce((coalesce(ap.screen_permissions,'{}'::jsonb) ->> p_screen)::boolean,true)=false then false
      when coalesce(((public.taskboard_default_read_only_screens() || coalesce(ap.read_only_screens,'{}'::jsonb)) ->> p_screen)::boolean,false)=true then false
      else true
    end
    from public.workspace_members wm
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
    where wm.workspace_id=p_workspace and wm.user_id=p_user and wm.active
    limit 1
  ),false);
$$;

-- As ações estruturais já passam por este helper. Agora READ ONLY em Projetos
-- também vale para Admin e deixa de existir o bypass incondicional da role.
create or replace function public.taskboard_can_perform_action(
  p_action text,
  p_workspace uuid default public.current_workspace_id(),
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when p_action not in ('createProjects','editProjects','createActivities','createSubactivities') then false
      when coalesce(ap.enabled,false)=true
       and coalesce(((public.taskboard_default_read_only_screens() || coalesce(ap.read_only_screens,'{}'::jsonb)) ->> 'projects')::boolean,false)=true then false
      when coalesce(ap.enabled,false)=false then
        coalesce(((public.taskboard_default_action_permissions(wm.role::text)) ->> p_action)::boolean,false)
      else coalesce(
        ((public.taskboard_default_action_permissions(wm.role::text) || coalesce(ap.action_permissions,'{}'::jsonb)) ->> p_action)::boolean,
        false
      )
    end
    from public.workspace_members wm
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
    where wm.workspace_id=p_workspace and wm.user_id=p_user and wm.active
    limit 1
  ),false);
$$;

create or replace function public.get_my_workspace_access_profile_v3()
returns table(
  enabled boolean,
  screen_permissions jsonb,
  action_permissions jsonb,
  read_only_screens jsonb,
  restrict_projects boolean,
  restrict_activities boolean,
  restrict_subactivities boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(ap.enabled,false),
    public.taskboard_default_screen_permissions(wm.role::text) || coalesce(ap.screen_permissions,'{}'::jsonb),
    public.taskboard_default_action_permissions(wm.role::text) || coalesce(ap.action_permissions,'{}'::jsonb),
    public.taskboard_default_read_only_screens() || coalesce(ap.read_only_screens,'{}'::jsonb),
    coalesce(ap.restrict_projects,false),
    coalesce(ap.restrict_activities,false),
    coalesce(ap.restrict_subactivities,false)
  from public.workspace_members wm
  left join public.workspace_member_access_profiles ap
    on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
  where wm.user_id=auth.uid() and wm.active
  order by wm.joined_at
  limit 1;
$$;

create or replace function public.set_workspace_member_access_profile_v3(
  p_user_id uuid,
  p_enabled boolean,
  p_screen_permissions jsonb,
  p_action_permissions jsonb,
  p_read_only_screens jsonb,
  p_restrict_projects boolean default false,
  p_restrict_activities boolean default false,
  p_restrict_subactivities boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_allowed_screens text[] := array['dashboard','developer','projects','followup','requests','requestsAqs','requestsDev','analysis','hours','agenda','chat','reports','settings'];
  v_allowed_actions text[] := array['createProjects','editProjects','createActivities','createSubactivities'];
  v_key text;
  v_settings_disabled boolean := false;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem personalizar acessos'; end if;
  if not public.taskboard_can_write_screen('settings',v_workspace,auth.uid()) then
    raise exception 'Configurações está em modo somente leitura para este administrador';
  end if;
  if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=p_user_id) then
    raise exception 'Usuário não pertence ao workspace';
  end if;

  if p_screen_permissions is null or jsonb_typeof(p_screen_permissions)<>'object' then raise exception 'Permissões de tela inválidas'; end if;
  if p_action_permissions is null or jsonb_typeof(p_action_permissions)<>'object' then raise exception 'Permissões de ação inválidas'; end if;
  if p_read_only_screens is null or jsonb_typeof(p_read_only_screens)<>'object' then raise exception 'Configuração READ ONLY inválida'; end if;

  for v_key in select jsonb_object_keys(p_screen_permissions) loop
    if not (v_key=any(v_allowed_screens)) then raise exception 'Permissão de tela desconhecida: %',v_key; end if;
    if jsonb_typeof(p_screen_permissions->v_key)<>'boolean' then raise exception 'Permissão % deve ser booleana',v_key; end if;
  end loop;
  for v_key in select jsonb_object_keys(p_action_permissions) loop
    if not (v_key=any(v_allowed_actions)) then raise exception 'Permissão de ação desconhecida: %',v_key; end if;
    if jsonb_typeof(p_action_permissions->v_key)<>'boolean' then raise exception 'Permissão % deve ser booleana',v_key; end if;
  end loop;
  for v_key in select jsonb_object_keys(p_read_only_screens) loop
    if not (v_key=any(v_allowed_screens)) then raise exception 'Módulo READ ONLY desconhecido: %',v_key; end if;
    if jsonb_typeof(p_read_only_screens->v_key)<>'boolean' then raise exception 'READ ONLY de % deve ser booleano',v_key; end if;
  end loop;

  -- Evita que o último administrador capaz de gerenciar acessos tranque a si mesmo.
  v_settings_disabled := coalesce(p_enabled,false) and (
    coalesce((p_screen_permissions->>'settings')::boolean,true)=false
    or coalesce((p_read_only_screens->>'settings')::boolean,false)=true
  );
  if p_user_id=auth.uid() and v_settings_disabled and not exists(
    select 1
    from public.workspace_members wm
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
    where wm.workspace_id=v_workspace
      and wm.user_id<>auth.uid()
      and wm.active
      and wm.role='admin'
      and (
        coalesce(ap.enabled,false)=false
        or (
          coalesce((ap.screen_permissions->>'settings')::boolean,true)=true
          and coalesce((ap.read_only_screens->>'settings')::boolean,false)=false
        )
      )
  ) then
    raise exception 'Mantenha ao menos um Administrador com Configurações em acesso completo';
  end if;

  insert into public.workspace_member_access_profiles(
    workspace_id,user_id,enabled,screen_permissions,action_permissions,read_only_screens,
    restrict_projects,restrict_activities,restrict_subactivities,updated_by,updated_at
  ) values(
    v_workspace,p_user_id,coalesce(p_enabled,false),p_screen_permissions,p_action_permissions,p_read_only_screens,
    coalesce(p_restrict_projects,false),coalesce(p_restrict_activities,false),coalesce(p_restrict_subactivities,false),auth.uid(),now()
  ) on conflict (workspace_id,user_id) do update set
    enabled=excluded.enabled,
    screen_permissions=excluded.screen_permissions,
    action_permissions=excluded.action_permissions,
    read_only_screens=excluded.read_only_screens,
    restrict_projects=excluded.restrict_projects,
    restrict_activities=excluded.restrict_activities,
    restrict_subactivities=excluded.restrict_subactivities,
    updated_by=excluded.updated_by,
    updated_at=now();
end;
$$;

create or replace function public.list_workspace_team_members_v3()
returns table(
  user_id uuid,
  email text,
  name text,
  initials text,
  color text,
  avatar_path text,
  role text,
  active boolean,
  work_days smallint[],
  daily_hours numeric,
  work_schedule jsonb,
  access_enabled boolean,
  access_screens jsonb,
  access_actions jsonb,
  access_read_only jsonb,
  restrict_projects boolean,
  restrict_activities boolean,
  restrict_subactivities boolean,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid := public.current_workspace_id();
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem gerenciar a equipe'; end if;

 //
  return query
  select wm.user_id,p.email,p.name,p.initials,p.color,p.avatar_path,wm.role::text,wm.active,
    coalesce(wm.work_days,array[1,2,3,4,5]::smallint[]),coalesce(wm.daily_hours,8.00::numeric),
    coalesce((select jsonb_object_agg(s.weekday::text,s.target_minutes order by s.weekday) from public.workspace_member_work_schedule s where s.workspace_id=wm.workspace_id and s.user_id=wm.user_id),'{}'::jsonb),
    coalesce(ap.enabled,false),
    public.taskboard_default_screen_permissions(wm.role::text) || coalesce(ap.screen_permissions,'{}'::jsonb),
    public.taskboard_default_action_permissions(wm.role::text) || coalesce(ap.action_permissions,'{}'::jsonb),
    public.taskboard_default_read_only_screens() || coalesce(ap.read_only_screens,'{}'::jsonb),
    coalesce(ap.restrict_projects,false),coalesce(ap.restrict_activities,false),coalesce(ap.restrict_subactivities,false),wm.joined_at
  from public.workspace_members wm
  join public.profiles p on p.id=wm.user_id
  left join public.workspace_member_access_profiles ap on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
  where wm.workspace_id=v_workspace
  order by wm.active desc,p.name,p.email;
end;
$$;

-- Proteção adicional da própria administração do workspace.
create or replace function public.set_workspace_member_role(p_user_id uuid,p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.current_workspace_id();
begin
  if v_workspace is null or not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem alterar permissões'; end if;
  if not public.taskboard_can_write_screen('settings',v_workspace,auth.uid()) then raise exception 'Configurações está em modo somente leitura para este administrador'; end if;
  if p_role not in ('member','support','aqs','developer','admin') then raise exception 'Permissão inválida'; end if;
  if p_user_id=auth.uid() and p_role<>'admin' and not exists(
    select 1 from public.workspace_members where workspace_id=v_workspace and role='admin' and active and user_id<>auth.uid()
  ) then raise exception 'O workspace precisa manter ao menos um administrador'; end if;
  update public.workspace_members set role=p_role::public.workspace_role where workspace_id=v_workspace and user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;
end;
$$;

create or replace function public.set_workspace_member_weekly_schedule(p_user_id uuid,p_schedule jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_day int; v_minutes int; v_days smallint[] := '{}'::smallint[]; v_average numeric := 8.00; v_total int := 0; v_count int := 0;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem alterar a jornada da equipe'; end if;
  if not public.taskboard_can_write_screen('settings',v_workspace,auth.uid()) then raise exception 'Configurações está em modo somente leitura para este administrador'; end if;
  if p_user_id is null then raise exception 'Usuário inválido'; end if;
  if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=p_user_id) then raise exception 'Usuário não pertence ao workspace'; end if;
  if p_schedule is null or jsonb_typeof(p_schedule)<>'object' then raise exception 'Jornada inválida'; end if;

  delete from public.workspace_member_work_schedule where workspace_id=v_workspace and user_id=p_user_id;
  for v_day in 0..6 loop
    begin v_minutes := coalesce(nullif(p_schedule ->> v_day::text,''),'0')::int;
    exception when others then raise exception 'Horário inválido para o dia %',v_day; end;
    if v_minutes<0 or v_minutes>1440 then raise exception 'A carga diária deve ficar entre 00:00 e 24:00'; end if;
    if v_minutes>0 then
      insert into public.workspace_member_work_schedule(workspace_id,user_id,weekday,target_minutes)
      values(v_workspace,p_user_id,v_day,v_minutes);
      v_days := array_append(v_days,v_day::smallint); v_total := v_total+v_minutes; v_count := v_count+1;
    end if;
  end loop;
  if v_count>0 then v_average := round((v_total::numeric/v_count)/60.0,2); end if;
  update public.workspace_members set work_days=v_days,daily_hours=v_average where workspace_id=v_workspace and user_id=p_user_id;
end;
$$;

create or replace function public.set_workspace_member_active(p_user_id uuid,p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.current_workspace_id(); v_target_role public.workspace_role;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem alterar o status da equipe'; end if;
  if not public.taskboard_can_write_screen('settings',v_workspace,auth.uid()) then raise exception 'Configurações está em modo somente leitura para este administrador'; end if;
  if p_user_id is null then raise exception 'Usuário inválido'; end if;
  select wm.role into v_target_role from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;
  if p_active is false and p_user_id=auth.uid() then raise exception 'Você não pode inativar sua própria conta por esta tela'; end if;
  if p_active is false and v_target_role='admin' and not exists(
    select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id<>p_user_id and wm.active and wm.role='admin'
  ) then raise exception 'O workspace precisa manter ao menos um administrador ativo'; end if;
  update public.workspace_members set active=coalesce(p_active,true) where workspace_id=v_workspace and user_id=p_user_id;
end;
$$;

revoke execute on function public.get_my_workspace_access_profile_v3() from public,anon;
grant execute on function public.get_my_workspace_access_profile_v3() to authenticated;
revoke execute on function public.set_workspace_member_access_profile_v3(uuid,boolean,jsonb,jsonb,jsonb,boolean,boolean,boolean) from public,anon;
grant execute on function public.set_workspace_member_access_profile_v3(uuid,boolean,jsonb,jsonb,jsonb,boolean,boolean,boolean) to authenticated;
revoke execute on function public.list_workspace_team_members_v3() from public,anon;
grant execute on function public.list_workspace_team_members_v3() to authenticated;
revoke execute on function public.taskboard_can_write_screen(text,uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_write_screen(text,uuid,uuid) to authenticated;

commit;
