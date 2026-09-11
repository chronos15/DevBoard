-- TaskBoard V93 · Jornada semanal por dia + acesso personalizado desacoplado
-- Execute depois da migration 076.
--
-- Compatibilidade: nenhum usuário existente recebe restrição automaticamente.
-- Sem uma linha ativa em workspace_member_access_profiles, todas as regras
-- continuam exatamente como antes, baseadas na role do workspace.

begin;

-- ---------------------------------------------------------------------------
-- 1. Jornada semanal: cada dia possui sua própria meta em minutos.
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_member_work_schedule (
  workspace_id uuid not null,
  user_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  target_minutes smallint not null check (target_minutes between 0 and 1440),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,user_id,weekday),
  foreign key (workspace_id,user_id)
    references public.workspace_members(workspace_id,user_id) on delete cascade
);

create index if not exists workspace_member_work_schedule_user_idx
  on public.workspace_member_work_schedule(user_id,weekday);

alter table public.workspace_member_work_schedule enable row level security;
alter table public.workspace_member_work_schedule replica identity full;

drop policy if exists taskboard_workspace_member_work_schedule_select on public.workspace_member_work_schedule;
create policy taskboard_workspace_member_work_schedule_select
  on public.workspace_member_work_schedule for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.workspace_member_work_schedule from anon, authenticated;
grant select on public.workspace_member_work_schedule to authenticated;

-- Migração transparente da configuração antiga. A jornada efetiva não muda.
insert into public.workspace_member_work_schedule(workspace_id,user_id,weekday,target_minutes)
select wm.workspace_id, wm.user_id, d.day,
       least(1440, greatest(1, round(coalesce(wm.daily_hours,8) * 60)::int))::smallint
from public.workspace_members wm
cross join lateral unnest(coalesce(wm.work_days,array[1,2,3,4,5]::smallint[])) as d(day)
where not exists (
  select 1 from public.workspace_member_work_schedule s
  where s.workspace_id=wm.workspace_id and s.user_id=wm.user_id
)
on conflict (workspace_id,user_id,weekday) do nothing;

create or replace function public.set_workspace_member_weekly_schedule(
  p_user_id uuid,
  p_schedule jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_day int;
  v_minutes int;
  v_days smallint[] := '{}'::smallint[];
  v_average numeric := 8.00;
  v_total int := 0;
  v_count int := 0;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem alterar a jornada da equipe'; end if;
  if p_user_id is null then raise exception 'Usuário inválido'; end if;
  if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=p_user_id) then
    raise exception 'Usuário não pertence ao workspace';
  end if;
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'object' then
    raise exception 'Jornada inválida';
  end if;

  delete from public.workspace_member_work_schedule
   where workspace_id=v_workspace and user_id=p_user_id;

  for v_day in 0..6 loop
    begin
      v_minutes := coalesce(nullif(p_schedule ->> v_day::text,''),'0')::int;
    exception when others then
      raise exception 'Horário inválido para o dia %', v_day;
    end;
    if v_minutes < 0 or v_minutes > 1440 then
      raise exception 'A carga diária deve ficar entre 00:00 e 24:00';
    end if;
    if v_minutes > 0 then
      insert into public.workspace_member_work_schedule(workspace_id,user_id,weekday,target_minutes)
      values(v_workspace,p_user_id,v_day::smallint,v_minutes::smallint);
      v_days := array_append(v_days,v_day::smallint);
      v_total := v_total + v_minutes;
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count > 0 then v_average := round((v_total::numeric / v_count) / 60, 2); end if;

  -- Mantém os campos V92 sincronizados para clientes antigos e integrações.
  update public.workspace_members
     set work_days=v_days,
         daily_hours=greatest(0.01,least(24,v_average))
   where workspace_id=v_workspace and user_id=p_user_id;
end;
$$;

-- Compatibilidade com clientes V92: converte a carga única para todos os dias.
create or replace function public.set_workspace_member_schedule(
  p_user_id uuid,
  p_work_days smallint[],
  p_daily_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule jsonb := '{}'::jsonb;
  v_day smallint;
  v_minutes int;
begin
  if p_daily_hours is null or p_daily_hours <= 0 or p_daily_hours > 24 then
    raise exception 'A carga diária deve estar entre 0 e 24 horas';
  end if;
  v_minutes := round(p_daily_hours * 60)::int;
  foreach v_day in array coalesce(p_work_days,'{}'::smallint[]) loop
    if v_day < 0 or v_day > 6 then raise exception 'Dias de trabalho inválidos'; end if;
    v_schedule := v_schedule || jsonb_build_object(v_day::text,v_minutes);
  end loop;
  perform public.set_workspace_member_weekly_schedule(p_user_id,v_schedule);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Acesso personalizado opt-in. Sem linha/disabled = comportamento legado.
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_member_access_profiles (
  workspace_id uuid not null,
  user_id uuid not null,
  enabled boolean not null default false,
  screen_permissions jsonb not null default '{}'::jsonb,
  restrict_projects boolean not null default false,
  restrict_activities boolean not null default false,
  restrict_subactivities boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,user_id),
  foreign key (workspace_id,user_id)
    references public.workspace_members(workspace_id,user_id) on delete cascade,
  constraint workspace_member_access_profiles_screens_object check (jsonb_typeof(screen_permissions)='object')
);

alter table public.workspace_member_access_profiles enable row level security;
alter table public.workspace_member_access_profiles replica identity full;

drop policy if exists taskboard_workspace_member_access_profiles_select on public.workspace_member_access_profiles;
create policy taskboard_workspace_member_access_profiles_select
  on public.workspace_member_access_profiles for select to authenticated
  using (
    user_id=auth.uid()
    or public.workspace_role_of(workspace_id,auth.uid())='admin'
  );

revoke all on public.workspace_member_access_profiles from anon, authenticated;
grant select on public.workspace_member_access_profiles to authenticated;

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
    'reports', p_role='admin'
  );
$$;

create or replace function public.get_my_workspace_access_profile()
returns table(
  enabled boolean,
  screen_permissions jsonb,
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
    case when wm.role='admin' then false else coalesce(ap.enabled,false) end,
    public.taskboard_default_screen_permissions(wm.role::text) || coalesce(ap.screen_permissions,'{}'::jsonb),
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

create or replace function public.set_workspace_member_access_profile(
  p_user_id uuid,
  p_enabled boolean,
  p_screen_permissions jsonb,
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
  v_role text;
  v_allowed_keys text[] := array['dashboard','developer','projects','followup','requests','requestsAqs','requestsDev','analysis','hours','agenda','chat','reports'];
  v_key text;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem personalizar acessos'; end if;
  select wm.role::text into v_role from public.workspace_members wm
   where wm.workspace_id=v_workspace and wm.user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;
  if p_screen_permissions is null or jsonb_typeof(p_screen_permissions)<>'object' then raise exception 'Permissões de tela inválidas'; end if;
  for v_key in select jsonb_object_keys(p_screen_permissions) loop
    if not (v_key=any(v_allowed_keys)) then raise exception 'Permissão desconhecida: %',v_key; end if;
    if jsonb_typeof(p_screen_permissions->v_key)<>'boolean' then raise exception 'Permissão % deve ser booleana',v_key; end if;
  end loop;

  -- Admin permanece sempre com acesso integral. O perfil pode ficar salvo,
  -- porém nunca é ativado enquanto a role efetiva for admin.
  insert into public.workspace_member_access_profiles(
    workspace_id,user_id,enabled,screen_permissions,
    restrict_projects,restrict_activities,restrict_subactivities,updated_by,updated_at
  ) values(
    v_workspace,p_user_id,case when v_role='admin' then false else coalesce(p_enabled,false) end,
    p_screen_permissions,coalesce(p_restrict_projects,false),coalesce(p_restrict_activities,false),coalesce(p_restrict_subactivities,false),auth.uid(),now()
  ) on conflict (workspace_id,user_id) do update set
    enabled=excluded.enabled,
    screen_permissions=excluded.screen_permissions,
    restrict_projects=excluded.restrict_projects,
    restrict_activities=excluded.restrict_activities,
    restrict_subactivities=excluded.restrict_subactivities,
    updated_by=excluded.updated_by,
    updated_at=now();
end;
$$;

-- Helpers SECURITY DEFINER usados pela RLS. Quando o acesso personalizado está
-- desligado, retornam o mesmo comportamento legado de membro do workspace.
create or replace function public.taskboard_member_access_enabled(p_workspace uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select ap.enabled from public.workspace_member_access_profiles ap
    join public.workspace_members wm on wm.workspace_id=ap.workspace_id and wm.user_id=ap.user_id and wm.active
    where ap.workspace_id=p_workspace and ap.user_id=p_user),false)
    and coalesce(public.workspace_role_of(p_workspace,p_user)::text,'')<>'admin';
$$;

create or replace function public.taskboard_can_view_project(p_project_id uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.projects p
    join public.workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=p_user and wm.active
    left join public.workspace_member_access_profiles ap on ap.workspace_id=p.workspace_id and ap.user_id=p_user
    where p.id=p_project_id and (
      wm.role='admin'
      or coalesce(ap.enabled,false)=false
      or coalesce(ap.restrict_projects,false)=false
      or exists(select 1 from public.project_members pm where pm.project_id=p.id and pm.user_id=p_user)
      or exists(select 1 from public.activities a join public.activity_assignees aa on aa.activity_id=a.id where a.project_id=p.id and aa.user_id=p_user)
      or exists(select 1 from public.activities a join public.subactivities s on s.activity_id=a.id where a.project_id=p.id and (s.assignee_id=p_user or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=p_user)))
    )
  );
$$;

create or replace function public.taskboard_can_view_activity(p_activity_id uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.activities a
    join public.projects p on p.id=a.project_id
    join public.workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=p_user and wm.active
    left join public.workspace_member_access_profiles ap on ap.workspace_id=p.workspace_id and ap.user_id=p_user
    where a.id=p_activity_id
      and public.taskboard_can_view_project(p.id,p_user)
      and (
        wm.role='admin'
        or coalesce(ap.enabled,false)=false
        or coalesce(ap.restrict_activities,false)=false
        or exists(select 1 from public.activity_assignees aa where aa.activity_id=a.id and aa.user_id=p_user)
        or exists(select 1 from public.subactivities s where s.activity_id=a.id and (s.assignee_id=p_user or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=p_user)))
      )
  );
$$;

create or replace function public.taskboard_can_view_subactivity(p_subactivity_id uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.subactivities s
    join public.activities a on a.id=s.activity_id
    join public.projects p on p.id=a.project_id
    join public.workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=p_user and wm.active
    left join public.workspace_member_access_profiles ap on ap.workspace_id=p.workspace_id and ap.user_id=p_user
    where s.id=p_subactivity_id
      and public.taskboard_can_view_activity(a.id,p_user)
      and (
        wm.role='admin'
        or coalesce(ap.enabled,false)=false
        or coalesce(ap.restrict_subactivities,false)=false
        or s.assignee_id=p_user
        or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=p_user)
      )
  );
$$;

-- O observador DEV continua existindo por padrão, mas passa a respeitar o
-- escopo personalizado quando o administrador optou por restringi-lo.
create or replace function public.can_view_followup_subactivity(p_subactivity_id uuid)
returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(
    select 1 from public.subactivities s
    join public.activities a on a.id=s.activity_id
    join public.projects p on p.id=a.project_id
    where s.id=p_subactivity_id
      and public.taskboard_can_view_subactivity(s.id,auth.uid())
      and (
        public.workspace_role_of(p.workspace_id,auth.uid()) in ('admin','developer')
        or s.assignee_id=auth.uid()
        or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=auth.uid())
      )
  );
$$;

-- RLS estrutural: substitui somente as policies SELECT originais. As policies
-- de escrita permanecem intactas, preservando toda a regra de negócio atual.
drop policy if exists cadence_projects_select on public.projects;
create policy cadence_projects_select on public.projects for select to authenticated
  using (public.taskboard_can_view_project(id));

drop policy if exists cadence_project_members_select on public.project_members;
create policy cadence_project_members_select on public.project_members for select to authenticated
  using (public.taskboard_can_view_project(project_id));

drop policy if exists cadence_activities_select on public.activities;
create policy cadence_activities_select on public.activities for select to authenticated
  using (public.taskboard_can_view_activity(id));

drop policy if exists cadence_activity_assignees_select on public.activity_assignees;
create policy cadence_activity_assignees_select on public.activity_assignees for select to authenticated
  using (public.taskboard_can_view_activity(activity_id));

drop policy if exists cadence_subactivities_select on public.subactivities;
create policy cadence_subactivities_select on public.subactivities for select to authenticated
  using (public.taskboard_can_view_subactivity(id));

drop policy if exists cadence_subactivity_members_select on public.subactivity_members;
create policy cadence_subactivity_members_select on public.subactivity_members for select to authenticated
  using (public.taskboard_can_view_subactivity(subactivity_id));

drop policy if exists cadence_work_sessions_select on public.work_sessions;
create policy cadence_work_sessions_select on public.work_sessions for select to authenticated
  using (public.taskboard_can_view_subactivity(subactivity_id));

drop policy if exists cadence_project_comments_select on public.project_comments;
create policy cadence_project_comments_select on public.project_comments for select to authenticated
  using (public.taskboard_can_view_project(project_id));

drop policy if exists cadence_subactivity_comments_select on public.subactivity_comments;
create policy cadence_subactivity_comments_select on public.subactivity_comments for select to authenticated
  using (public.taskboard_can_view_subactivity(subactivity_id));

drop policy if exists cadence_attachments_select on public.attachments;
create policy cadence_attachments_select on public.attachments for select to authenticated using (
  (project_id is not null and public.taskboard_can_view_project(project_id))
  or (activity_id is not null and public.taskboard_can_view_activity(activity_id))
  or (subactivity_id is not null and public.taskboard_can_view_subactivity(subactivity_id))
);

drop policy if exists cadence_project_logs_select on public.project_logs;
create policy cadence_project_logs_select on public.project_logs for select to authenticated
  using (public.taskboard_can_view_project(project_id));

drop policy if exists cadence_project_versions_select on public.project_versions;
create policy cadence_project_versions_select on public.project_versions for select to authenticated
  using (public.taskboard_can_view_project(project_id));

-- A fila AQS acompanha o mesmo recorte estrutural. Com acesso personalizado
-- desligado, taskboard_can_view_subactivity() devolve o comportamento legado.
drop policy if exists devboard_aqs_reviews_select on public.aqs_reviews;
create policy devboard_aqs_reviews_select on public.aqs_reviews for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role,'aqs'::public.workspace_role])
    and public.taskboard_can_view_subactivity(subactivity_id)
  );

drop policy if exists devboard_aqs_review_participants_select on public.aqs_review_participants;
create policy devboard_aqs_review_participants_select on public.aqs_review_participants for select to authenticated
  using (
    exists(
      select 1 from public.aqs_reviews ar
      where ar.id=review_id and public.taskboard_can_view_subactivity(ar.subactivity_id)
    )
  );

-- Tabelas adicionadas em migrations posteriores.
do $$ begin
  if to_regclass('public.activity_notes') is not null then
    execute 'drop policy if exists taskboard_activity_notes_select on public.activity_notes';
    execute 'create policy taskboard_activity_notes_select on public.activity_notes for select to authenticated using (public.taskboard_can_view_activity(activity_id))';
  end if;
  if to_regclass('public.subactivity_checklist_items') is not null then
    execute 'drop policy if exists taskboard_subactivity_checklist_select on public.subactivity_checklist_items';
    execute 'create policy taskboard_subactivity_checklist_select on public.subactivity_checklist_items for select to authenticated using (public.taskboard_can_view_subactivity(subactivity_id))';
  end if;
end $$;

-- Lista administrativa V93: jornada por dia e perfil de acesso no mesmo payload.
drop function if exists public.list_workspace_team_members();
create function public.list_workspace_team_members()
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

  return query
  select wm.user_id,p.email,p.name,p.initials,p.color,p.avatar_path,wm.role::text,wm.active,
    coalesce(wm.work_days,array[1,2,3,4,5]::smallint[]),coalesce(wm.daily_hours,8.00::numeric),
    coalesce((select jsonb_object_agg(s.weekday::text,s.target_minutes order by s.weekday) from public.workspace_member_work_schedule s where s.workspace_id=wm.workspace_id and s.user_id=wm.user_id),'{}'::jsonb),
    case when wm.role='admin' then false else coalesce(ap.enabled,false) end,
    public.taskboard_default_screen_permissions(wm.role::text) || coalesce(ap.screen_permissions,'{}'::jsonb),
    coalesce(ap.restrict_projects,false),coalesce(ap.restrict_activities,false),coalesce(ap.restrict_subactivities,false),wm.joined_at
  from public.workspace_members wm
  join public.profiles p on p.id=wm.user_id
  left join public.workspace_member_access_profiles ap on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
  where wm.workspace_id=v_workspace
  order by wm.active desc,p.name,p.email;
end;
$$;

revoke execute on function public.set_workspace_member_weekly_schedule(uuid,jsonb) from public,anon;
grant execute on function public.set_workspace_member_weekly_schedule(uuid,jsonb) to authenticated;
revoke execute on function public.set_workspace_member_schedule(uuid,smallint[],numeric) from public,anon;
grant execute on function public.set_workspace_member_schedule(uuid,smallint[],numeric) to authenticated;
revoke execute on function public.get_my_workspace_access_profile() from public,anon;
grant execute on function public.get_my_workspace_access_profile() to authenticated;
revoke execute on function public.set_workspace_member_access_profile(uuid,boolean,jsonb,boolean,boolean,boolean) from public,anon;
grant execute on function public.set_workspace_member_access_profile(uuid,boolean,jsonb,boolean,boolean,boolean) to authenticated;
revoke execute on function public.list_workspace_team_members() from public,anon;
grant execute on function public.list_workspace_team_members() to authenticated;
revoke execute on function public.taskboard_can_view_project(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_activity(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_subactivity(uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_view_project(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_activity(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_subactivity(uuid,uuid) to authenticated;

-- Realtime para alterações administrativas de jornada/acesso.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_member_work_schedule') then
    alter publication supabase_realtime add table public.workspace_member_work_schedule;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_member_access_profiles') then
    alter publication supabase_realtime add table public.workspace_member_access_profiles;
  end if;
end $$;

commit;
