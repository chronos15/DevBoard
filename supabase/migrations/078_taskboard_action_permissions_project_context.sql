-- TaskBoard V95 · Permissões de ações + contexto do projeto
-- Execute depois da migration 077.
--
-- Compatibilidade: action_permissions é opt-in junto do perfil personalizado.
-- Se o perfil individual estiver desligado, todas as RPCs mantêm as regras
-- legadas e nenhum usuário existente perde permissões automaticamente.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ações estruturais configuráveis, separadas da role e das telas.
-- ---------------------------------------------------------------------------
alter table public.workspace_member_access_profiles
  add column if not exists action_permissions jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='workspace_member_access_profiles_actions_object'
      and conrelid='public.workspace_member_access_profiles'::regclass
  ) then
    alter table public.workspace_member_access_profiles
      add constraint workspace_member_access_profiles_actions_object
      check (jsonb_typeof(action_permissions)='object');
  end if;
end $$;

create or replace function public.taskboard_default_action_permissions(p_role text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'createProjects', p_role in ('admin','developer'),
    'editProjects', p_role in ('admin','developer'),
    'createActivities', p_role in ('admin','developer'),
    'createSubactivities', p_role in ('admin','developer')
  );
$$;

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
      when wm.role::text='admin' then true
      -- Perfil desligado = regra antiga. A RPC de negócio continua sendo o
      -- teto real de role, integração e ownership.
      when coalesce(ap.enabled,false)=false then true
      when p_action not in ('createProjects','editProjects','createActivities','createSubactivities') then false
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

create or replace function public.get_my_workspace_access_profile_v2()
returns table(
  enabled boolean,
  screen_permissions jsonb,
  action_permissions jsonb,
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
    public.taskboard_default_action_permissions(wm.role::text) || coalesce(ap.action_permissions,'{}'::jsonb),
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

create or replace function public.set_workspace_member_access_profile_v2(
  p_user_id uuid,
  p_enabled boolean,
  p_screen_permissions jsonb,
  p_action_permissions jsonb,
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
  v_allowed_screens text[] := array['dashboard','developer','projects','followup','requests','requestsAqs','requestsDev','analysis','hours','agenda','chat','reports'];
  v_allowed_actions text[] := array['createProjects','editProjects','createActivities','createSubactivities'];
  v_key text;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem personalizar acessos'; end if;

  select wm.role::text into v_role
  from public.workspace_members wm
  where wm.workspace_id=v_workspace and wm.user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;

  if p_screen_permissions is null or jsonb_typeof(p_screen_permissions)<>'object' then raise exception 'Permissões de tela inválidas'; end if;
  if p_action_permissions is null or jsonb_typeof(p_action_permissions)<>'object' then raise exception 'Permissões de ação inválidas'; end if;

  for v_key in select jsonb_object_keys(p_screen_permissions) loop
    if not (v_key=any(v_allowed_screens)) then raise exception 'Permissão de tela desconhecida: %',v_key; end if;
    if jsonb_typeof(p_screen_permissions->v_key)<>'boolean' then raise exception 'Permissão % deve ser booleana',v_key; end if;
  end loop;
  for v_key in select jsonb_object_keys(p_action_permissions) loop
    if not (v_key=any(v_allowed_actions)) then raise exception 'Permissão de ação desconhecida: %',v_key; end if;
    if jsonb_typeof(p_action_permissions->v_key)<>'boolean' then raise exception 'Permissão % deve ser booleana',v_key; end if;
  end loop;

  insert into public.workspace_member_access_profiles(
    workspace_id,user_id,enabled,screen_permissions,action_permissions,
    restrict_projects,restrict_activities,restrict_subactivities,updated_by,updated_at
  ) values(
    v_workspace,p_user_id,case when v_role='admin' then false else coalesce(p_enabled,false) end,
    p_screen_permissions,p_action_permissions,
    coalesce(p_restrict_projects,false),coalesce(p_restrict_activities,false),coalesce(p_restrict_subactivities,false),auth.uid(),now()
  ) on conflict (workspace_id,user_id) do update set
    enabled=excluded.enabled,
    screen_permissions=excluded.screen_permissions,
    action_permissions=excluded.action_permissions,
    restrict_projects=excluded.restrict_projects,
    restrict_activities=excluded.restrict_activities,
    restrict_subactivities=excluded.restrict_subactivities,
    updated_by=excluded.updated_by,
    updated_at=now();
end;
$$;

create or replace function public.list_workspace_team_members_v2()
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
    public.taskboard_default_action_permissions(wm.role::text) || coalesce(ap.action_permissions,'{}'::jsonb),
    coalesce(ap.restrict_projects,false),coalesce(ap.restrict_activities,false),coalesce(ap.restrict_subactivities,false),wm.joined_at
  from public.workspace_members wm
  join public.profiles p on p.id=wm.user_id
  left join public.workspace_member_access_profiles ap on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
  where wm.workspace_id=v_workspace
  order by wm.active desc,p.name,p.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Contexto organizacional do projeto.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists modules text[] not null default '{}'::text[];
alter table public.projects add column if not exists subjects text[] not null default '{}'::text[];
alter table public.projects add column if not exists responsible_departments text[] not null default '{}'::text[];

create or replace function public.set_project_context(
  p_project_id uuid,
  p_modules text[] default '{}',
  p_subjects text[] default '{}',
  p_responsible_departments text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_role text;
  v_modules text[];
  v_subjects text[];
  v_departments text[];
  v_changed boolean := false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception 'Projeto não encontrado'; end if;

  select wm.role::text into v_role from public.workspace_members wm
  where wm.workspace_id=v_project.workspace_id and wm.user_id=auth.uid() and wm.active;
  if v_role is null then raise exception 'Sem permissão para editar projetos'; end if;
  if not public.taskboard_can_perform_action('editProjects',v_project.workspace_id,auth.uid()) then
    raise exception 'Seu nível de acesso não permite editar projetos';
  end if;
  if v_role<>'admin' and (v_role<>'developer' or not exists(select 1 from public.project_members pm where pm.project_id=p_project_id and pm.user_id=auth.uid())) then
    raise exception 'Você precisa estar integrado ao projeto para editá-lo';
  end if;

  if exists(select 1 from unnest(coalesce(p_modules,'{}'::text[])) x where char_length(btrim(x))>100)
     or exists(select 1 from unnest(coalesce(p_subjects,'{}'::text[])) x where char_length(btrim(x))>100)
     or exists(select 1 from unnest(coalesce(p_responsible_departments,'{}'::text[])) x where char_length(btrim(x))>100) then
    raise exception 'Módulos, assuntos e departamentos devem ter no máximo 100 caracteres por item';
  end if;

  select coalesce(array_agg(v order by v),'{}'::text[]) into v_modules
  from (select distinct btrim(x) v from unnest(coalesce(p_modules,'{}'::text[])) x where btrim(x)<>'' limit 40) q;
  select coalesce(array_agg(v order by v),'{}'::text[]) into v_subjects
  from (select distinct btrim(x) v from unnest(coalesce(p_subjects,'{}'::text[])) x where btrim(x)<>'' limit 40) q;
  select coalesce(array_agg(v order by v),'{}'::text[]) into v_departments
  from (select distinct btrim(x) v from unnest(coalesce(p_responsible_departments,'{}'::text[])) x where btrim(x)<>'' limit 40) q;

  v_changed := v_project.modules is distinct from v_modules
    or v_project.subjects is distinct from v_subjects
    or v_project.responsible_departments is distinct from v_departments;

  update public.projects set
    modules=v_modules,
    subjects=v_subjects,
    responsible_departments=v_departments,
    updated_at=case when v_changed then now() else updated_at end
  where id=p_project_id;

  if v_changed then
    perform public.add_project_log(p_project_id,'updated','Contexto do projeto atualizado','Módulos, assuntos ou departamentos responsáveis foram atualizados.',auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Enforcement no servidor para as ações configuráveis.
-- ---------------------------------------------------------------------------
create or replace function public.create_project(
  p_name text,
  p_client text,
  p_description text,
  p_tag text,
  p_priority text,
  p_due_date date,
  p_repository text default '',
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_project uuid;
  v_member uuid;
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não autenticado';
  end if;

  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) then
    raise exception 'Somente Administrador ou Desenvolvedor pode criar projetos';
  end if;

  if not public.taskboard_can_perform_action('createProjects', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite adicionar projetos';
  end if;

  if length(btrim(coalesce(p_name,''))) = 0 then
    raise exception 'Nome do projeto é obrigatório';
  end if;

  if p_priority not in ('low','medium','high') then
    raise exception 'Prioridade inválida';
  end if;

  insert into public.projects(
    workspace_id,
    name,
    client,
    description,
    tag,
    priority,
    due_date,
    repository,
    created_by
  )
  values(
    v_workspace,
    btrim(p_name),
    coalesce(nullif(btrim(p_client),''),'Projeto interno'),
    coalesce(p_description,''),
    coalesce(nullif(btrim(p_tag),''),'Desenvolvimento'),
    p_priority::public.project_priority,
    p_due_date,
    coalesce(p_repository,''),
    auth.uid()
  )
  returning id into v_project;

  insert into public.project_members(project_id,user_id,added_by)
  select v_project,x.user_id,auth.uid()
  from (
    select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id
  ) x
  where public.is_workspace_member(v_workspace,x.user_id)
  on conflict do nothing;

  perform public.add_project_log(
    v_project,
    'created',
    'Projeto criado',
    case
      when p_due_date is null then 'Projeto criado e disponibilizado para a equipe, sem data de entrega definida.'
      else 'Projeto criado e disponibilizado para a equipe.'
    end,
    auth.uid()
  );

  for v_member in
    select user_id
    from public.project_members
    where project_id = v_project
      and user_id <> auth.uid()
  loop
    perform public.push_notification(
      v_member,
      auth.uid(),
      'project-assigned',
      'Você foi adicionado a um projeto',
      btrim(p_name),
      v_project,
      null,
      null
    );
  end loop;

  return v_project;
end;
$$;

create or replace function public.update_project(
  p_project_id uuid,
  p_name text,
  p_client text,
  p_description text,
  p_tag text,
  p_priority text,
  p_due_date date,
  p_repository text default '',
  p_member_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_workspace uuid;
  v_role text;
  v_description text := '';
  v_old_members uuid[];
  v_member uuid;
  v_requested_members uuid[];
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then raise exception 'Projeto não encontrado'; end if;

  v_workspace := v_project.workspace_id;
  select wm.role::text into v_role
  from public.workspace_members wm
  where wm.workspace_id = v_workspace
    and wm.user_id = auth.uid()
    and wm.active;

  if v_role is null then raise exception 'Sem permissão para editar projetos'; end if;

  if not public.taskboard_can_perform_action('editProjects', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite editar projetos';
  end if;

  if v_role <> 'admin' and (
    v_role <> 'developer'
    or not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
    )
  ) then
    raise exception 'Você precisa estar integrado ao projeto para editá-lo';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_priority not in ('low', 'medium', 'high') then raise exception 'Prioridade inválida'; end if;

  if v_project.name is distinct from btrim(p_name) then
    v_description := v_description || format('Nome: “%s” → “%s”. ', v_project.name, btrim(p_name));
  end if;
  if v_project.client is distinct from coalesce(nullif(btrim(p_client), ''), 'Projeto interno') then
    v_description := v_description || 'Cliente/área alterado. ';
  end if;
  if v_project.description is distinct from coalesce(p_description, '') then
    v_description := v_description || 'Descrição alterada. ';
  end if;
  if v_project.tag is distinct from coalesce(nullif(btrim(p_tag), ''), 'Desenvolvimento') then
    v_description := v_description || 'Categoria alterada. ';
  end if;
  if v_project.priority::text is distinct from p_priority then
    v_description := v_description || 'Prioridade alterada. ';
  end if;
  if v_project.due_date is distinct from p_due_date then
    v_description := v_description || case when p_due_date is null then 'Data de entrega removida. ' else 'Data de entrega alterada. ' end;
  end if;
  if v_project.repository is distinct from coalesce(p_repository, '') then
    v_description := v_description || 'Repositório/caminho alterado. ';
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    into v_old_members
  from public.project_members
  where project_id = p_project_id;

  update public.projects
     set name = btrim(p_name),
         client = coalesce(nullif(btrim(p_client), ''), 'Projeto interno'),
         description = coalesce(p_description, ''),
         tag = coalesce(nullif(btrim(p_tag), ''), 'Desenvolvimento'),
         priority = p_priority::public.project_priority,
         due_date = p_due_date,
         repository = coalesce(p_repository, '')
   where id = p_project_id;

  v_requested_members := coalesce(p_member_ids, '{}'::uuid[]);
  if v_role = 'developer' then
    v_requested_members := array_append(v_requested_members, auth.uid());
  end if;

  delete from public.project_members where project_id = p_project_id;

  insert into public.project_members(project_id, user_id, added_by)
  select p_project_id, x.user_id, auth.uid()
  from (select distinct unnest(v_requested_members) as user_id) x
  where exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = v_workspace
      and wm.user_id = x.user_id
      and wm.active
  )
  on conflict do nothing;

  if v_old_members is distinct from (
    select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    from public.project_members
    where project_id = p_project_id
  ) then
    v_description := v_description || 'Responsáveis alterados. ';
  end if;

  perform public.add_project_log(
    p_project_id,
    'updated',
    'Projeto atualizado',
    nullif(btrim(v_description), ''),
    auth.uid()
  );

  for v_member in
    select user_id
    from public.project_members
    where project_id = p_project_id
      and user_id <> auth.uid()
      and not (user_id = any(v_old_members))
  loop
    perform public.push_notification(
      v_member,
      auth.uid(),
      'project-assigned',
      'Você foi adicionado a um projeto',
      btrim(p_name),
      p_project_id,
      null,
      null
    );
  end loop;
end;
$$;

create or replace function public.add_activity(p_project_id uuid,p_title text,p_assignee_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_activity uuid;
  v_user uuid;
  v_project_name text;
  v_role text;
begin
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar atividades';
  end if;

  if not public.taskboard_can_perform_action('createActivities', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite adicionar atividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role<>'admin' and not exists(
    select 1
      from public.project_members pm
     where pm.project_id=p_project_id
       and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para criar atividades';
  end if;

  if length(btrim(coalesce(p_title,'')))=0 then
    raise exception 'Título da atividade é obrigatório';
  end if;

  if exists(
    select 1
      from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) x(user_id)
     where public.workspace_role_of(v_workspace,x.user_id) not in ('admin','developer')
  ) then
    raise exception 'Atividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  insert into public.activities(project_id,title,created_by)
  values(p_project_id,btrim(p_title),auth.uid())
  returning id into v_activity;

  insert into public.activity_assignees(activity_id,user_id)
  select v_activity,x.user_id
    from (select distinct unnest(coalesce(p_assignee_ids,'{}'::uuid[])) user_id) x
   where public.is_workspace_member(v_workspace,x.user_id)
  on conflict do nothing;

  perform public.add_project_log(
    p_project_id,'activity-added','Atividade adicionada',
    format('“%s” foi adicionada ao projeto.',btrim(p_title)),auth.uid()
  );

  select name into v_project_name from public.projects where id=p_project_id;
  for v_user in
    select user_id
      from public.activity_assignees
     where activity_id=v_activity and user_id<>auth.uid()
  loop
    perform public.push_notification(
      v_user,auth.uid(),'activity-assigned','Você recebeu uma nova atividade',
      format('“%s” · %s',btrim(p_title),v_project_name),p_project_id,v_activity,null
    );
  end loop;

  return v_activity;
end;
$$;

create or replace function public.add_subactivity(
  p_project_id uuid,p_activity_id uuid,p_title text,p_estimated_hours numeric,p_assignee_id uuid,p_status text default 'backlog'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_id uuid;
  v_activity_title text;
  v_project_name text;
  v_role text;
  v_request_id uuid;
  v_order_number text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then
    raise exception 'Atividade não pertence ao projeto';
  end if;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar subatividades';
  end if;

  if not public.taskboard_can_perform_action('createSubactivities', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite adicionar subatividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role not in ('admin','developer') and not exists(
    select 1 from public.project_members pm
     where pm.project_id=p_project_id and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para criar subatividades';
  end if;

  if length(btrim(coalesce(p_title,'')))=0 then
    raise exception 'Título da subatividade é obrigatório';
  end if;

  if public.workspace_role_of(v_workspace,p_assignee_id) not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then
    raise exception 'Status inválido';
  end if;

  v_request_id:=public.service_request_for_activity(p_activity_id);
  if v_request_id is not null and p_status in ('done','cancelled') then
    select order_number into v_order_number from public.service_requests where id=v_request_id;
    raise exception 'A atividade pertence à OS %. A nova subatividade não pode nascer concluída/cancelada; envie-a para Aguardando AQS ao finalizar.',v_order_number;
  end if;

  if p_status='in-progress' and p_assignee_id<>auth.uid() and v_role<>'admin' then
    raise exception 'Você só pode iniciar uma subatividade atribuída a você';
  end if;

  insert into public.subactivities(
    activity_id,title,status,estimated_hours,tracked_seconds,timer_started_at,
    assignee_id,created_by,completed_at,cancelled_at
  ) values(
    p_activity_id,btrim(p_title),'backlog',greatest(coalesce(p_estimated_hours,0),0),0,null,
    p_assignee_id,auth.uid(),null,null
  ) returning id into v_id;

  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values
    (v_id,p_assignee_id,auth.uid()),
    (v_id,auth.uid(),auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

  select title into v_activity_title from public.activities where id=p_activity_id;
  select name into v_project_name from public.projects where id=p_project_id;

  perform public.add_project_log(
    p_project_id,'subactivity-added','Subatividade adicionada',
    format('“%s” adicionada em “%s”.',btrim(p_title),v_activity_title),auth.uid()
  );

  perform public.push_notification(
    p_assignee_id,auth.uid(),'subactivity-assigned','Você recebeu uma nova subatividade',
    format('“%s” · %s · %s',btrim(p_title),v_activity_title,v_project_name),
    p_project_id,p_activity_id,v_id
  );

  if p_status<>'backlog' then
    perform public.set_subactivity_status(v_id,p_status);
  end if;

  return v_id;
end;
$$;

create or replace function public.version_project(p_project_id uuid,p_version text,p_build text,p_allow_pending boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.project_workspace_id(p_project_id);
begin
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para versionar projetos';
  end if;
  if not public.taskboard_can_perform_action('editProjects', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite editar projetos';
  end if;
  if not public.is_workspace_admin(v_workspace) and (
    public.workspace_role_of(v_workspace,auth.uid())<>'developer'
    or not exists(select 1 from public.project_members pm where pm.project_id=p_project_id and pm.user_id=auth.uid())
  ) then
    raise exception 'Você precisa estar integrado ao projeto para versioná-lo';
  end if;
  if length(btrim(coalesce(p_version,'')))=0 or length(btrim(coalesce(p_build,'')))=0 then raise exception 'Versão e build são obrigatórios'; end if;
  if not coalesce(p_allow_pending,false) and (
    exists(select 1 from public.activities a where a.project_id=p_project_id and not exists(select 1 from public.subactivities s where s.activity_id=a.id))
    or exists(select 1 from public.subactivities s join public.activities a on a.id=s.activity_id where a.project_id=p_project_id and s.status not in ('done','cancelled'))
  ) then raise exception 'Existem atividades ou subatividades não finalizadas. Confirme o versionamento com pendências.'; end if;
  update public.projects set version=btrim(p_version),build=btrim(p_build) where id=p_project_id;
  insert into public.project_versions(project_id,version,build,created_by) values(p_project_id,btrim(p_version),btrim(p_build),auth.uid());
  perform public.add_project_log(p_project_id,'versioned','Projeto versionado',format('Versão %s · Build %s.',btrim(p_version),btrim(p_build)),auth.uid());
end;
$$;

create or replace function public.set_project_visual(
  p_project_id uuid,
  p_icon text,
  p_icon_image_path text default null
)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_icon text := coalesce(nullif(btrim(p_icon), ''), 'folder-kanban');
  v_image_path text := nullif(btrim(coalesce(p_icon_image_path, '')), '');
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'Projeto não encontrado';
  end if;

  if not public.taskboard_can_perform_action('editProjects', v_project.workspace_id, auth.uid()) then
    raise exception 'Seu nível de acesso não permite editar projetos';
  end if;

  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = v_project.workspace_id
      and wm.user_id = auth.uid()
      and wm.active
      and (
        wm.role::text = 'admin'
        or v_project.created_by = auth.uid()
        or (
          wm.role::text = 'developer'
          and exists (
            select 1
            from public.project_members pm
            where pm.project_id = v_project.id
              and pm.user_id = auth.uid()
          )
        )
      )
  ) into v_can_manage;

  if not v_can_manage then
    raise exception 'Você não tem permissão para alterar a identidade visual deste projeto';
  end if;

  if v_icon not in (
    'folder-kanban','code','smartphone','monitor','server','database','globe',
    'shopping-cart','credit-card','store','package','boxes','wrench','rocket','bug','shield'
  ) then
    raise exception 'Ícone de projeto inválido';
  end if;

  if v_image_path is not null then
    if split_part(v_image_path, '/', 2) is distinct from p_project_id::text then
      raise exception 'Imagem personalizada inválida para este projeto';
    end if;

    if not exists (
      select 1
      from storage.objects so
      where so.bucket_id = 'devboard-project-icons'
        and so.name = v_image_path
    ) then
      raise exception 'Imagem personalizada não encontrada no Storage';
    end if;
  end if;

  if v_project.icon is distinct from v_icon
     or v_project.icon_image_path is distinct from v_image_path then
    update public.projects
       set icon = v_icon,
           icon_image_path = v_image_path,
           updated_at = now()
     where id = p_project_id;

    perform public.add_project_log(
      p_project_id,
      'updated',
      'Identidade visual do projeto atualizada',
      case when v_image_path is null then 'Imagem personalizada removida; usando ícone do TaskBoard' else 'Imagem personalizada' end,
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.project_icon_storage_manage_existing_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null or nullif(btrim(coalesce(p_name, '')), '') is null then
    return false;
  end if;

  begin
    v_project_id := split_part(p_name, '/', 2)::uuid;
  exception when others then
    return false;
  end;

  return exists (
    select 1
    from public.projects p
    join public.workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = auth.uid()
     and wm.active
    where p.id = v_project_id
      and public.taskboard_can_perform_action('editProjects', p.workspace_id, auth.uid())
      and (
        wm.role::text = 'admin'
        or p.created_by = auth.uid()
        or (
          wm.role::text = 'developer'
          and exists (
            select 1
            from public.project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
end;
$$;

create or replace function public.set_project_icon(p_project_id uuid, p_icon text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_workspace uuid;
  v_icon text := coalesce(nullif(btrim(p_icon),''),'folder-kanban');
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'Projeto não encontrado'; end if;

  v_workspace := v_project.workspace_id;
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if not public.taskboard_can_perform_action('editProjects', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite editar projetos';
  end if;

  if not public.is_workspace_admin(v_workspace)
     and v_project.created_by <> auth.uid()
     and (
       public.workspace_role_of(v_workspace, auth.uid()) <> 'developer'
       or not exists (
         select 1 from public.project_members pm
         where pm.project_id = p_project_id and pm.user_id = auth.uid()
       )
     ) then
    raise exception 'Você precisa estar integrado ao projeto para alterar o ícone';
  end if;

  if v_icon not in (
    'folder-kanban','code','smartphone','monitor','server','database','globe',
    'shopping-cart','credit-card','store','package','boxes','wrench','rocket','bug','shield'
  ) then
    raise exception 'Ícone de projeto inválido';
  end if;

  if v_project.icon is distinct from v_icon then
    update public.projects set icon = v_icon, updated_at = now() where id = p_project_id;
    perform public.add_project_log(
      p_project_id,
      'updated',
      'Ícone do projeto atualizado',
      null,
      auth.uid()
    );
  end if;
end;
$$;


-- Policies do Storage de ícone também respeitam a ação de edição.
revoke execute on function public.project_icon_storage_manage_existing_allowed(text) from public,anon;
grant execute on function public.project_icon_storage_manage_existing_allowed(text) to authenticated;

revoke execute on function public.get_my_workspace_access_profile_v2() from public,anon;
grant execute on function public.get_my_workspace_access_profile_v2() to authenticated;
revoke execute on function public.set_workspace_member_access_profile_v2(uuid,boolean,jsonb,jsonb,boolean,boolean,boolean) from public,anon;
grant execute on function public.set_workspace_member_access_profile_v2(uuid,boolean,jsonb,jsonb,boolean,boolean,boolean) to authenticated;
revoke execute on function public.list_workspace_team_members_v2() from public,anon;
grant execute on function public.list_workspace_team_members_v2() to authenticated;
revoke execute on function public.set_project_context(uuid,text[],text[],text[]) from public,anon;
grant execute on function public.set_project_context(uuid,text[],text[],text[]) to authenticated;

revoke execute on function public.create_project(text,text,text,text,text,date,text,uuid[]) from public,anon;
grant execute on function public.create_project(text,text,text,text,text,date,text,uuid[]) to authenticated;
revoke execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) from public,anon;
grant execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) to authenticated;
revoke execute on function public.add_activity(uuid,text,uuid[]) from public,anon;
grant execute on function public.add_activity(uuid,text,uuid[]) to authenticated;
revoke execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) from public,anon;
grant execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) to authenticated;
revoke execute on function public.version_project(uuid,text,text,boolean) from public,anon;
grant execute on function public.version_project(uuid,text,text,boolean) to authenticated;
revoke execute on function public.set_project_visual(uuid,text,text) from public,anon;
grant execute on function public.set_project_visual(uuid,text,text) to authenticated;
revoke execute on function public.set_project_icon(uuid,text) from public,anon;
grant execute on function public.set_project_icon(uuid,text) to authenticated;

-- Helpers sensíveis: somente as RPCs SECURITY DEFINER os utilizam diretamente.
revoke execute on function public.taskboard_can_perform_action(text,uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_perform_action(text,uuid,uuid) to authenticated;

commit;
