-- Devboard / Devboard
-- Backend completo Supabase: Auth, PostgreSQL, RLS, Storage, Realtime e RPCs.
-- Execute este arquivo uma única vez no SQL Editor do Supabase ou via Supabase CLI.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.workspace_role as enum ('member', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subactivity_status as enum ('backlog', 'waiting', 'in-progress', 'paused', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attachment_kind as enum ('image', 'pdf', 'text', 'document', 'video', 'audio', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_kind as enum ('direct', 'group');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meeting_mode as enum ('audio', 'video');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Tabelas-base
-- -----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Workspace único nesta fase do produto. Todos os usuários autenticados pertencem
-- ao mesmo workspace; o primeiro usuário cadastrado torna-se administrador.
insert into public.workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Devboard')
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  initials text not null,
  color text not null default 'oklch(0.655 0.19 34)',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_email_lower_uidx on public.profiles (lower(email)) where email <> '';

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id, active);

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notify_assignments boolean not null default true,
  notify_comments boolean not null default true,
  notify_team_activity boolean not null default true,
  notify_deadlines boolean not null default true,
  timer_sticky boolean not null default true,
  reduced_motion boolean not null default false,
  density text not null default 'comfortable' check (density in ('comfortable','compact')),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  client text not null default 'Projeto interno',
  description text not null default '',
  tag text not null default 'Desenvolvimento',
  priority public.project_priority not null default 'medium',
  due_date date not null,
  version text,
  build text,
  repository text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_workspace_idx on public.projects(workspace_id, updated_at desc);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists activities_project_idx on public.activities(project_id, created_at);

create table if not exists public.activity_assignees (
  activity_id uuid not null references public.activities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);
create index if not exists activity_assignees_user_idx on public.activity_assignees(user_id);

create table if not exists public.subactivities (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  title text not null,
  status public.subactivity_status not null default 'backlog',
  estimated_hours numeric(10,2) not null default 0 check (estimated_hours >= 0),
  tracked_seconds bigint not null default 0 check (tracked_seconds >= 0),
  timer_started_at timestamptz,
  assignee_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subactivities_timer_consistency check (
    (status = 'in-progress' and timer_started_at is not null)
    or (status <> 'in-progress' and timer_started_at is null)
  )
);
create index if not exists subactivities_activity_idx on public.subactivities(activity_id, created_at);
create index if not exists subactivities_assignee_idx on public.subactivities(assignee_id, status);
create unique index if not exists subactivities_one_running_per_user_uidx
  on public.subactivities(assignee_id)
  where status = 'in-progress';

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds bigint not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  constraint work_sessions_end_after_start check (ended_at is null or ended_at >= started_at)
);
create index if not exists work_sessions_subactivity_idx on public.work_sessions(subactivity_id, started_at desc);
create index if not exists work_sessions_user_history_idx on public.work_sessions(user_id, started_at desc);
create unique index if not exists work_sessions_one_open_per_user_uidx on public.work_sessions(user_id) where ended_at is null;

create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists project_comments_project_idx on public.project_comments(project_id, created_at desc);

create table if not exists public.subactivity_comments (
  id uuid primary key default gen_random_uuid(),
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists subactivity_comments_sub_idx on public.subactivity_comments(subactivity_id, created_at desc);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  subactivity_id uuid references public.subactivities(id) on delete cascade,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  kind public.attachment_kind not null default 'other',
  storage_path text,
  text_content text,
  uploaded_by uuid not null references public.profiles(id),
  active boolean not null default true,
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint attachments_one_parent check (
    (project_id is not null and subactivity_id is null)
    or (project_id is null and subactivity_id is not null)
  ),
  constraint attachments_content_source check (storage_path is not null or text_content is not null)
);
create index if not exists attachments_project_idx on public.attachments(project_id, created_at desc) where project_id is not null;
create index if not exists attachments_sub_idx on public.attachments(subactivity_id, created_at desc) where subactivity_id is not null;

create table if not exists public.project_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);
create index if not exists project_logs_project_idx on public.project_logs(project_id, created_at desc);

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version text not null,
  build text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists project_versions_project_idx on public.project_versions(project_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  title text not null,
  description text,
  project_id uuid references public.projects(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete cascade,
  subactivity_id uuid references public.subactivities(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, read_at, created_at desc);

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind public.chat_kind not null,
  name text,
  direct_key text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_group_name check (kind <> 'group' or length(btrim(coalesce(name, ''))) > 0)
);
alter table public.chat_conversations add column if not exists direct_key text;
create index if not exists chat_conversations_workspace_idx on public.chat_conversations(workspace_id, updated_at desc);


create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members(user_id, conversation_id);

-- Chave canônica evita duas conversas diretas para o mesmo par, inclusive em corrida entre clientes.
update public.chat_conversations c
set direct_key = pairs.direct_key
from (
  select cm.conversation_id, string_agg(cm.user_id::text, ':' order by cm.user_id::text) as direct_key
  from public.chat_members cm
  join public.chat_conversations c2 on c2.id=cm.conversation_id and c2.kind='direct'
  group by cm.conversation_id
  having count(*)=2
) pairs
where c.id=pairs.conversation_id and c.direct_key is null;
create unique index if not exists chat_conversations_direct_key_uidx
  on public.chat_conversations(workspace_id,direct_key) where kind='direct' and direct_key is not null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx on public.chat_messages(conversation_id, created_at);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  title text not null,
  mode public.meeting_mode not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists meetings_workspace_idx on public.meetings(workspace_id, updated_at desc);
create unique index if not exists meetings_one_active_per_conversation_uidx
  on public.meetings(conversation_id) where conversation_id is not null and ended_at is null;

create table if not exists public.meeting_members (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index if not exists meeting_members_user_idx on public.meeting_members(user_id, meeting_id);

-- -----------------------------------------------------------------------------
-- Utilitários / segurança
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.make_initials(p_name text)
returns text language sql immutable as $$
  select upper(
    left(coalesce((regexp_split_to_array(btrim(p_name), '\s+'))[1], ''), 1)
    || left(coalesce((regexp_split_to_array(btrim(p_name), '\s+'))[2], ''), 1)
  );
$$;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select wm.workspace_id
  from public.workspace_members wm
  where wm.user_id = auth.uid() and wm.active
  order by wm.joined_at
  limit 1;
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.active
  );
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.active
      and wm.role = 'admin'
  );
$$;

create or replace function public.project_workspace_id(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select workspace_id from public.projects where id = p_project_id;
$$;

create or replace function public.activity_project_id(p_activity_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select project_id from public.activities where id = p_activity_id;
$$;

create or replace function public.subactivity_project_id(p_subactivity_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.project_id
  from public.subactivities s
  join public.activities a on a.id = s.activity_id
  where s.id = p_subactivity_id;
$$;

create or replace function public.conversation_workspace_id(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select workspace_id from public.chat_conversations where id = p_conversation_id;
$$;

create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.chat_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = p_user_id
  );
$$;


create or replace function public.is_meeting_member(p_meeting_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.meeting_members mm
    where mm.meeting_id = p_meeting_id and mm.user_id = p_user_id
  );
$$;

create or replace function public.safe_path_workspace_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v := split_part(p_name, '/', 1);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

create or replace function public.safe_topic_meeting_id(p_topic text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  if p_topic is null or p_topic !~* '^meeting:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  v := split_part(p_topic, ':', 2);
  return v::uuid;
exception when others then return null;
end;
$$;

create or replace function public.can_access_meeting_realtime(p_topic text, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.meetings m
    join public.meeting_members mm on mm.meeting_id=m.id
    where m.id=public.safe_topic_meeting_id(p_topic)
      and m.ended_at is null
      and mm.user_id=p_user_id
  );
$$;

create or replace function public.add_project_log(
  p_project_id uuid,
  p_type text,
  p_title text,
  p_description text default null,
  p_actor_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.project_logs(project_id, actor_id, type, title, description)
  values (p_project_id, p_actor_id, p_type, p_title, p_description);
end;
$$;

create or replace function public.push_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type text,
  p_title text,
  p_description text default null,
  p_project_id uuid default null,
  p_activity_id uuid default null,
  p_subactivity_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid;
begin
  if p_recipient_id is null or p_recipient_id = p_actor_id then return; end if;
  v_workspace := coalesce(
    case when p_project_id is not null then public.project_workspace_id(p_project_id) end,
    public.current_workspace_id()
  );
  if v_workspace is null or not public.is_workspace_member(v_workspace, p_recipient_id) then return; end if;
  if p_type in ('project-assigned','activity-assigned','subactivity-assigned') and exists (
    select 1 from public.user_preferences up where up.user_id=p_recipient_id and not up.notify_assignments
  ) then return; end if;
  if p_type='subactivity-comment' and exists (
    select 1 from public.user_preferences up where up.user_id=p_recipient_id and not up.notify_comments
  ) then return; end if;
  insert into public.notifications(
    workspace_id, recipient_id, actor_id, type, title, description,
    project_id, activity_id, subactivity_id
  ) values (
    v_workspace, p_recipient_id, p_actor_id, p_type, p_title, p_description,
    p_project_id, p_activity_id, p_subactivity_id
  );
end;
$$;

-- Trigger de perfil para cada usuário Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Usuário'), '@', 1)
  );

  insert into public.profiles(id, email, name, initials)
  values (new.id, coalesce(new.email, ''), v_name, coalesce(nullif(public.make_initials(v_name), ''), 'US'))
  on conflict (id) do update
    set email = excluded.email,
        name = excluded.name,
        initials = excluded.initials,
        updated_at = now();

  -- Todo novo cadastro entra sempre como Membro.
  -- Roles superiores são atribuídas posteriormente por um Administrador.
  insert into public.workspace_members(workspace_id, user_id, role)
  values ('00000000-0000-0000-0000-000000000001', new.id, 'member'::public.workspace_role)
  on conflict (workspace_id, user_id) do nothing;

  insert into public.user_preferences(user_id) values(new.id) on conflict(user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_profile_updated on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
create trigger on_auth_user_profile_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill seguro para usuários já existentes.
insert into public.profiles(id, email, name, initials)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(u.email, 'Usuário'), '@', 1)),
  coalesce(nullif(public.make_initials(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(u.email, 'Usuário'), '@', 1))), ''), 'US')
from auth.users u
on conflict (id) do update set email = excluded.email;

insert into public.workspace_members(workspace_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', p.id, 'member'::public.workspace_role
from public.profiles p
on conflict (workspace_id, user_id) do nothing;

insert into public.user_preferences(user_id)
select id from public.profiles
on conflict(user_id) do nothing;

insert into public.work_sessions(subactivity_id,user_id,started_at)
select s.id,s.assignee_id,s.timer_started_at
from public.subactivities s
where s.status='in-progress' and s.timer_started_at is not null
  and not exists(select 1 from public.work_sessions ws where ws.user_id=s.assignee_id and ws.ended_at is null)
on conflict do nothing;

-- updated_at triggers
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at before update on public.user_preferences for each row execute procedure public.set_updated_at();
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects for each row execute procedure public.set_updated_at();
drop trigger if exists activities_set_updated_at on public.activities;
create trigger activities_set_updated_at before update on public.activities for each row execute procedure public.set_updated_at();
drop trigger if exists subactivities_set_updated_at on public.subactivities;
create trigger subactivities_set_updated_at before update on public.subactivities for each row execute procedure public.set_updated_at();
drop trigger if exists chat_conversations_set_updated_at on public.chat_conversations;
create trigger chat_conversations_set_updated_at before update on public.chat_conversations for each row execute procedure public.set_updated_at();
drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at before update on public.meetings for each row execute procedure public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RPCs de perfil / equipe
-- -----------------------------------------------------------------------------
create or replace function public.update_my_profile(p_name text, p_avatar_path text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if length(v_name) < 2 then raise exception 'Informe um nome válido'; end if;
  update public.profiles
  set name = v_name,
      initials = coalesce(nullif(public.make_initials(v_name), ''), initials),
      avatar_path = coalesce(p_avatar_path, avatar_path)
  where id = auth.uid();
end;
$$;

create or replace function public.update_my_preferences(
  p_notify_assignments boolean,
  p_notify_comments boolean,
  p_notify_team_activity boolean,
  p_notify_deadlines boolean,
  p_timer_sticky boolean,
  p_reduced_motion boolean,
  p_density text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_density not in ('comfortable','compact') then raise exception 'Densidade inválida'; end if;
  insert into public.user_preferences(
    user_id,notify_assignments,notify_comments,notify_team_activity,notify_deadlines,timer_sticky,reduced_motion,density
  ) values (
    auth.uid(),p_notify_assignments,p_notify_comments,p_notify_team_activity,p_notify_deadlines,p_timer_sticky,p_reduced_motion,p_density
  )
  on conflict(user_id) do update set
    notify_assignments=excluded.notify_assignments,
    notify_comments=excluded.notify_comments,
    notify_team_activity=excluded.notify_team_activity,
    notify_deadlines=excluded.notify_deadlines,
    timer_sticky=excluded.timer_sticky,
    reduced_motion=excluded.reduced_motion,
    density=excluded.density;
end;
$$;

create or replace function public.set_workspace_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid := public.current_workspace_id();
begin
  if v_workspace is null or not public.is_workspace_admin(v_workspace) then
    raise exception 'Somente administradores podem alterar permissões';
  end if;
  if p_role not in ('member','admin') then raise exception 'Permissão inválida'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin' and not exists (
    select 1 from public.workspace_members
    where workspace_id = v_workspace and role = 'admin' and active and user_id <> auth.uid()
  ) then
    raise exception 'O workspace precisa manter ao menos um administrador';
  end if;
  update public.workspace_members set role = p_role::public.workspace_role
  where workspace_id = v_workspace and user_id = p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs de projetos / atividades / subatividades
-- -----------------------------------------------------------------------------
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
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if length(btrim(coalesce(p_name,''))) = 0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_due_date is null then raise exception 'Data de entrega é obrigatória'; end if;
  if p_priority not in ('low','medium','high') then raise exception 'Prioridade inválida'; end if;

  insert into public.projects(workspace_id,name,client,description,tag,priority,due_date,repository,created_by)
  values (
    v_workspace, btrim(p_name), coalesce(nullif(btrim(p_client),''),'Projeto interno'),
    coalesce(p_description,''), coalesce(nullif(btrim(p_tag),''),'Desenvolvimento'),
    p_priority::public.project_priority, p_due_date, coalesce(p_repository,''), auth.uid()
  ) returning id into v_project;

  insert into public.project_members(project_id,user_id,added_by)
  select v_project, x.user_id, auth.uid()
  from (
    select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]), auth.uid())) as user_id
  ) x
  where public.is_workspace_member(v_workspace, x.user_id)
  on conflict do nothing;

  perform public.add_project_log(v_project,'created','Projeto criado','Projeto criado e disponibilizado para a equipe.',auth.uid());

  for v_member in
    select user_id from public.project_members where project_id = v_project and user_id <> auth.uid()
  loop
    perform public.push_notification(v_member,auth.uid(),'project-assigned','Você foi adicionado a um projeto',btrim(p_name),v_project,null,null);
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
  v_description text := '';
  v_old_members uuid[];
  v_member uuid;
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'Projeto não encontrado'; end if;
  v_workspace := v_project.workspace_id;
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_due_date is null then raise exception 'Data de entrega é obrigatória'; end if;
  if p_priority not in ('low','medium','high') then raise exception 'Prioridade inválida'; end if;

  if v_project.name is distinct from btrim(p_name) then v_description := v_description || format('Nome: “%s” → “%s”. ',v_project.name,btrim(p_name)); end if;
  if v_project.client is distinct from coalesce(nullif(btrim(p_client),''),'Projeto interno') then v_description := v_description || 'Cliente/área alterado. '; end if;
  if v_project.description is distinct from coalesce(p_description,'') then v_description := v_description || 'Descrição alterada. '; end if;
  if v_project.tag is distinct from coalesce(nullif(btrim(p_tag),''),'Desenvolvimento') then v_description := v_description || 'Categoria alterada. '; end if;
  if v_project.priority::text is distinct from p_priority then v_description := v_description || 'Prioridade alterada. '; end if;
  if v_project.due_date is distinct from p_due_date then v_description := v_description || 'Data de entrega alterada. '; end if;
  if v_project.repository is distinct from coalesce(p_repository,'') then v_description := v_description || 'Repositório/caminho alterado. '; end if;

  select coalesce(array_agg(user_id order by user_id),'{}'::uuid[]) into v_old_members from public.project_members where project_id = p_project_id;

  update public.projects set
    name=btrim(p_name), client=coalesce(nullif(btrim(p_client),''),'Projeto interno'),
    description=coalesce(p_description,''), tag=coalesce(nullif(btrim(p_tag),''),'Desenvolvimento'),
    priority=p_priority::public.project_priority, due_date=p_due_date, repository=coalesce(p_repository,'')
  where id=p_project_id;

  delete from public.project_members where project_id=p_project_id;
  insert into public.project_members(project_id,user_id,added_by)
  select p_project_id, x.user_id, auth.uid()
  from (select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]), auth.uid())) user_id) x
  where public.is_workspace_member(v_workspace,x.user_id)
  on conflict do nothing;

  if v_old_members is distinct from (select coalesce(array_agg(user_id order by user_id),'{}'::uuid[]) from public.project_members where project_id=p_project_id) then
    v_description := v_description || 'Responsáveis alterados. ';
  end if;

  perform public.add_project_log(p_project_id,'updated','Projeto atualizado',nullif(btrim(v_description),''),auth.uid());

  for v_member in
    select user_id from public.project_members
    where project_id=p_project_id and user_id<>auth.uid() and not (user_id = any(v_old_members))
  loop
    perform public.push_notification(v_member,auth.uid(),'project-assigned','Você foi adicionado a um projeto',btrim(p_name),p_project_id,null,null);
  end loop;
end;
$$;

create or replace function public.version_project(p_project_id uuid,p_version text,p_build text,p_allow_pending boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid := public.project_workspace_id(p_project_id);
begin
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_version,'')))=0 or length(btrim(coalesce(p_build,'')))=0 then
    raise exception 'Versão e build são obrigatórios';
  end if;
  if not coalesce(p_allow_pending,false) and (
    exists(select 1 from public.activities a where a.project_id=p_project_id and not exists(select 1 from public.subactivities s where s.activity_id=a.id))
    or exists(
      select 1 from public.subactivities s
      join public.activities a on a.id=s.activity_id
      where a.project_id=p_project_id and s.status not in ('done','cancelled')
    )
  ) then
    raise exception 'Existem atividades ou subatividades não finalizadas. Confirme o versionamento com pendências.';
  end if;
  update public.projects set version=btrim(p_version),build=btrim(p_build) where id=p_project_id;
  insert into public.project_versions(project_id,version,build,created_by)
  values(p_project_id,btrim(p_version),btrim(p_build),auth.uid());
  perform public.add_project_log(p_project_id,'versioned','Projeto versionado',format('Versão %s · Build %s.',btrim(p_version),btrim(p_build)),auth.uid());
end;
$$;

create or replace function public.add_activity(p_project_id uuid,p_title text,p_assignee_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.project_workspace_id(p_project_id);
  v_activity uuid;
  v_user uuid;
  v_project_name text;
begin
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_title,'')))=0 then raise exception 'Título da atividade é obrigatório'; end if;
  insert into public.activities(project_id,title,created_by) values(p_project_id,btrim(p_title),auth.uid()) returning id into v_activity;
  insert into public.activity_assignees(activity_id,user_id)
  select v_activity,x.user_id from (select distinct unnest(coalesce(p_assignee_ids,'{}'::uuid[])) user_id) x
  where public.is_workspace_member(v_workspace,x.user_id) on conflict do nothing;
  perform public.add_project_log(p_project_id,'activity-added','Atividade adicionada',format('“%s” foi adicionada ao projeto.',btrim(p_title)),auth.uid());
  select name into v_project_name from public.projects where id=p_project_id;
  for v_user in select user_id from public.activity_assignees where activity_id=v_activity and user_id<>auth.uid() loop
    perform public.push_notification(v_user,auth.uid(),'activity-assigned','Você recebeu uma nova atividade',format('“%s” · %s',btrim(p_title),v_project_name),p_project_id,v_activity,null);
  end loop;
  return v_activity;
end;
$$;

create or replace function public.delete_activity(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.activities%rowtype; v_workspace uuid;
begin
  select * into v_activity from public.activities where id=p_activity_id for update;
  if not found then raise exception 'Atividade não encontrada'; end if;
  v_workspace := public.project_workspace_id(v_activity.project_id);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if exists(select 1 from public.subactivities where activity_id=p_activity_id) then
    raise exception 'Só é possível excluir atividades sem subatividades';
  end if;
  perform public.add_project_log(v_activity.project_id,'activity-deleted','Atividade excluída',format('“%s” foi removida do projeto.',v_activity.title),auth.uid());
  delete from public.activities where id=p_activity_id;
end;
$$;

create or replace function public.start_subactivity(p_subactivity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_is_admin boolean;
  v_other record;
  v_now timestamptz := now();
begin
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);
  v_is_admin := public.is_workspace_admin(v_workspace);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if not v_is_admin and v_sub.assignee_id<>auth.uid() then raise exception 'Apenas o responsável pode executar esta subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_is_admin then raise exception 'Somente um administrador pode reabrir uma subatividade finalizada'; end if;
  if v_sub.status='in-progress' then return; end if;

  -- Serializa inícios do mesmo responsável, evitando corrida entre duas abas/dispositivos.
  perform 1 from public.profiles where id=v_sub.assignee_id for update;

  for v_other in
    select s.*, a.project_id
    from public.subactivities s join public.activities a on a.id=s.activity_id
    where s.assignee_id=v_sub.assignee_id and s.status='in-progress' and s.id<>p_subactivity_id
    for update of s
  loop
    update public.work_sessions
    set ended_at=v_now, duration_seconds=greatest(0,floor(extract(epoch from (v_now-started_at)))::bigint)
    where user_id=v_sub.assignee_id and subactivity_id=v_other.id and ended_at is null;
    update public.subactivities
    set tracked_seconds = tracked_seconds + greatest(0, floor(extract(epoch from (v_now-timer_started_at)))::bigint),
        status='paused', timer_started_at=null
    where id=v_other.id;
    perform public.add_project_log(v_other.project_id,'subactivity-status','Subatividade pausada automaticamente',format('“%s” foi pausada porque o responsável iniciou outra subatividade.',v_other.title),auth.uid());
  end loop;

  -- Fecha qualquer sessão aberta residual do responsável antes de abrir a nova.
  update public.work_sessions
  set ended_at=v_now, duration_seconds=greatest(0,floor(extract(epoch from (v_now-started_at)))::bigint)
  where user_id=v_sub.assignee_id and ended_at is null;

  update public.subactivities set status='in-progress', timer_started_at=v_now, completed_at=null, cancelled_at=null where id=p_subactivity_id;
  insert into public.work_sessions(subactivity_id,user_id,started_at) values(p_subactivity_id,v_sub.assignee_id,v_now);
  perform public.add_project_log(v_project,'subactivity-status','Subatividade iniciada',format('“%s” está em execução.',v_sub.title),auth.uid());
end;
$$;

create or replace function public.pause_subactivity(p_subactivity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub public.subactivities%rowtype; v_project uuid; v_workspace uuid; v_now timestamptz:=now();
begin
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_project:=public.subactivity_project_id(p_subactivity_id); v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if not public.is_workspace_admin(v_workspace) and v_sub.assignee_id<>auth.uid() then raise exception 'Apenas o responsável pode pausar esta subatividade'; end if;
  if v_sub.status<>'in-progress' then return; end if;
  update public.work_sessions
  set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from (v_now-started_at)))::bigint)
  where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  update public.subactivities
  set tracked_seconds=tracked_seconds+greatest(0,floor(extract(epoch from (v_now-timer_started_at)))::bigint),
      status='paused',timer_started_at=null
  where id=p_subactivity_id;
  perform public.add_project_log(v_project,'subactivity-status','Subatividade pausada',format('“%s” foi pausada.',v_sub.title),auth.uid());
end;
$$;

create or replace function public.set_subactivity_status(p_subactivity_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype; v_project uuid; v_workspace uuid; v_admin boolean; v_now timestamptz:=now();
begin
  if p_status not in ('backlog','waiting','in-progress','paused','done','cancelled') then raise exception 'Status inválido'; end if;
  if p_status='in-progress' then perform public.start_subactivity(p_subactivity_id); return; end if;
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  if v_sub.status::text=p_status then return; end if;
  v_project:=public.subactivity_project_id(p_subactivity_id); v_workspace:=public.project_workspace_id(v_project); v_admin:=public.is_workspace_admin(v_workspace);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if not v_admin and v_sub.assignee_id<>auth.uid() then raise exception 'Apenas o responsável pode alterar esta subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_admin then raise exception 'Somente um administrador pode alterar uma subatividade finalizada'; end if;

  if v_sub.status='in-progress' then
    update public.work_sessions
    set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from (v_now-started_at)))::bigint)
    where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  end if;

  update public.subactivities
  set tracked_seconds = tracked_seconds + case when v_sub.status='in-progress' then greatest(0,floor(extract(epoch from (v_now-v_sub.timer_started_at)))::bigint) else 0 end,
      status=p_status::public.subactivity_status,
      timer_started_at=null,
      completed_at=case when p_status='done' then v_now else null end,
      cancelled_at=case when p_status='cancelled' then v_now else null end
  where id=p_subactivity_id;
  perform public.add_project_log(v_project,'subactivity-status','Status da subatividade alterado',format('“%s”: %s → %s.',v_sub.title,v_sub.status::text,p_status),auth.uid());
end;
$$;

create or replace function public.add_subactivity(
  p_project_id uuid,
  p_activity_id uuid,
  p_title text,
  p_estimated_hours numeric,
  p_assignee_id uuid,
  p_status text default 'backlog'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.project_workspace_id(p_project_id); v_id uuid; v_activity_title text; v_project_name text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then raise exception 'Atividade não pertence ao projeto'; end if;
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_title,'')))=0 then raise exception 'Título da subatividade é obrigatório'; end if;
  if not public.is_workspace_member(v_workspace,p_assignee_id) then raise exception 'Responsável não pertence ao workspace'; end if;
  if p_status not in ('backlog','waiting','in-progress','paused','done','cancelled') then raise exception 'Status inválido'; end if;
  if p_status='in-progress' and p_assignee_id<>auth.uid() and not public.is_workspace_admin(v_workspace) then
    raise exception 'Apenas administrador pode iniciar uma subatividade de outro usuário';
  end if;
  insert into public.subactivities(activity_id,title,status,estimated_hours,tracked_seconds,timer_started_at,assignee_id,created_by,completed_at,cancelled_at)
  values(p_activity_id,btrim(p_title),'backlog',greatest(coalesce(p_estimated_hours,0),0),0,null,p_assignee_id,auth.uid(),null,null)
  returning id into v_id;
  select title into v_activity_title from public.activities where id=p_activity_id;
  select name into v_project_name from public.projects where id=p_project_id;
  perform public.add_project_log(p_project_id,'subactivity-added','Subatividade adicionada',format('“%s” adicionada em “%s”.',btrim(p_title),v_activity_title),auth.uid());
  perform public.push_notification(p_assignee_id,auth.uid(),'subactivity-assigned','Você recebeu uma nova subatividade',format('“%s” · %s · %s',btrim(p_title),v_activity_title,v_project_name),p_project_id,p_activity_id,v_id);
  if p_status<>'backlog' then perform public.set_subactivity_status(v_id,p_status); end if;
  return v_id;
end;
$$;

create or replace function public.add_project_comment(p_project_id uuid,p_content text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_workspace uuid:=public.project_workspace_id(p_project_id); v_preview text;
begin
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Comentário vazio'; end if;
  insert into public.project_comments(project_id,author_id,content) values(p_project_id,auth.uid(),btrim(p_content)) returning id into v_id;
  v_preview:=left(regexp_replace(btrim(p_content),'\s+',' ','g'),140);
  perform public.add_project_log(p_project_id,'comment-added','Comentário adicionado ao projeto',format('“%s”',v_preview),auth.uid());
  return v_id;
end;
$$;

create or replace function public.add_subactivity_comment(p_subactivity_id uuid,p_content text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_project uuid:=public.subactivity_project_id(p_subactivity_id); v_workspace uuid; v_sub public.subactivities%rowtype; v_activity uuid; v_preview text;
begin
  v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Comentário vazio'; end if;
  select * into v_sub from public.subactivities where id=p_subactivity_id;
  select activity_id into v_activity from public.subactivities where id=p_subactivity_id;
  insert into public.subactivity_comments(subactivity_id,author_id,content) values(p_subactivity_id,auth.uid(),btrim(p_content)) returning id into v_id;
  v_preview:=left(regexp_replace(btrim(p_content),'\s+',' ','g'),140);
  perform public.add_project_log(v_project,'comment-added','Comentário adicionado à subatividade',format('“%s” · “%s”',v_sub.title,v_preview),auth.uid());
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'subactivity-comment','Novo comentário em sua subatividade',format('“%s” · “%s”',v_sub.title,v_preview),v_project,v_activity,p_subactivity_id);
  return v_id;
end;
$$;

create or replace function public.add_attachment(
  p_project_id uuid default null,
  p_subactivity_id uuid default null,
  p_name text default '',
  p_mime_type text default 'application/octet-stream',
  p_size_bytes bigint default 0,
  p_kind text default 'other',
  p_storage_path text default null,
  p_text_content text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_project uuid; v_workspace uuid; v_sub_title text;
begin
  if (p_project_id is null)=(p_subactivity_id is null) then raise exception 'Informe projeto ou subatividade, exclusivamente'; end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do anexo é obrigatório'; end if;
  if p_kind not in ('image','pdf','text','document','video','audio','other') then raise exception 'Tipo de anexo inválido'; end if;
  if p_storage_path is null and p_text_content is null then raise exception 'Anexo sem conteúdo'; end if;
  v_project:=coalesce(p_project_id,public.subactivity_project_id(p_subactivity_id));
  v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if p_storage_path is not null and (
    public.safe_path_workspace_id(p_storage_path) is distinct from v_workspace
    or split_part(p_storage_path,'/',3) is distinct from auth.uid()::text
  ) then
    raise exception 'Caminho de Storage inválido para este usuário/workspace';
  end if;
  insert into public.attachments(project_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,text_content,uploaded_by)
  values(p_project_id,p_subactivity_id,btrim(p_name),coalesce(p_mime_type,'application/octet-stream'),greatest(coalesce(p_size_bytes,0),0),p_kind::public.attachment_kind,p_storage_path,p_text_content,auth.uid())
  returning id into v_id;
  if p_subactivity_id is null then
    perform public.add_project_log(v_project,'attachment-added','Arquivo adicionado ao projeto',format('“%s” foi anexado e está ativo.',btrim(p_name)),auth.uid());
  else
    select title into v_sub_title from public.subactivities where id=p_subactivity_id;
    perform public.add_project_log(v_project,'attachment-added','Arquivo adicionado à subatividade',format('“%s” anexado em “%s” e mantido ativo.',btrim(p_name),v_sub_title),auth.uid());
  end if;
  return v_id;
end;
$$;

create or replace function public.set_attachment_active(p_attachment_id uuid,p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.attachments%rowtype; v_project uuid; v_workspace uuid; v_sub_title text;
begin
  select * into v from public.attachments where id=p_attachment_id for update;
  if not found then raise exception 'Anexo não encontrado'; end if;
  if v.active=p_active then return; end if;
  v_project:=coalesce(v.project_id,public.subactivity_project_id(v.subactivity_id)); v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  update public.attachments set active=p_active,status_changed_at=now(),status_changed_by=auth.uid() where id=p_attachment_id;
  if v.subactivity_id is null then
    perform public.add_project_log(v_project,'attachment-status',case when p_active then 'Arquivo do projeto reativado' else 'Arquivo do projeto marcado como inativo' end,format('“%s” agora está %s.',v.name,case when p_active then 'ativo' else 'inativo' end),auth.uid());
  else
    select title into v_sub_title from public.subactivities where id=v.subactivity_id;
    perform public.add_project_log(v_project,'attachment-status',case when p_active then 'Arquivo da subatividade reativado' else 'Arquivo da subatividade marcado como inativo' end,format('“%s” em “%s” agora está %s.',v.name,v_sub_title,case when p_active then 'ativo' else 'inativo' end),auth.uid());
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs de Chat / Reuniões
-- -----------------------------------------------------------------------------
create or replace function public.ensure_direct_conversation(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.current_workspace_id();
  v_id uuid;
  v_direct_key text;
begin
  if p_member_id=auth.uid() or not public.is_workspace_member(v_workspace,p_member_id) then return null; end if;
  v_direct_key:=least(auth.uid()::text,p_member_id::text)||':'||greatest(auth.uid()::text,p_member_id::text);

  select c.id into v_id
  from public.chat_conversations c
  where c.workspace_id=v_workspace and c.kind='direct' and c.direct_key=v_direct_key
  limit 1;

  if v_id is null then
    begin
      insert into public.chat_conversations(workspace_id,kind,direct_key,created_by)
      values(v_workspace,'direct',v_direct_key,auth.uid()) returning id into v_id;
    exception when unique_violation then
      select c.id into v_id from public.chat_conversations c
      where c.workspace_id=v_workspace and c.kind='direct' and c.direct_key=v_direct_key limit 1;
    end;
  end if;

  insert into public.chat_members(conversation_id,user_id) values(v_id,auth.uid()),(v_id,p_member_id)
  on conflict(conversation_id,user_id) do nothing;
  return v_id;
end;
$$;

create or replace function public.send_chat_message(p_conversation_id uuid,p_content text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'Você não participa desta conversa'; end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Mensagem vazia'; end if;
  insert into public.chat_messages(conversation_id,sender_id,content) values(p_conversation_id,auth.uid(),btrim(p_content)) returning id into v_id;
  update public.chat_conversations set updated_at=now() where id=p_conversation_id;
  return v_id;
end;
$$;

create or replace function public.create_chat_group(p_name text,p_member_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.current_workspace_id(); v_id uuid;
begin
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do grupo é obrigatório'; end if;
  insert into public.chat_conversations(workspace_id,kind,name,created_by) values(v_workspace,'group',btrim(p_name),auth.uid()) returning id into v_id;
  insert into public.chat_members(conversation_id,user_id)
  select v_id,x.user_id from (select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id) x
  where public.is_workspace_member(v_workspace,x.user_id) on conflict do nothing;
  if (select count(*) from public.chat_members where conversation_id=v_id)<2 then raise exception 'Selecione ao menos um participante além de você'; end if;
  return v_id;
end;
$$;

create or replace function public.update_chat_group(p_conversation_id uuid,p_name text,p_member_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.chat_conversations%rowtype; v_workspace uuid;
begin
  select * into v from public.chat_conversations where id=p_conversation_id and kind='group' for update;
  if not found then raise exception 'Grupo não encontrado'; end if;
  v_workspace:=v.workspace_id;
  if v.created_by<>auth.uid() and not public.is_workspace_admin(v_workspace) then raise exception 'Somente o criador ou administrador pode gerenciar o grupo'; end if;
  update public.chat_conversations set name=coalesce(nullif(btrim(p_name),''),name) where id=p_conversation_id;
  delete from public.chat_members where conversation_id=p_conversation_id;
  insert into public.chat_members(conversation_id,user_id)
  select p_conversation_id,x.user_id from (select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),v.created_by)) user_id) x
  where public.is_workspace_member(v_workspace,x.user_id) on conflict do nothing;
end;
$$;

create or replace function public.delete_chat_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.chat_conversations%rowtype;
begin
  select * into v from public.chat_conversations where id=p_conversation_id and kind='group';
  if not found then raise exception 'Grupo não encontrado'; end if;
  if v.created_by<>auth.uid() and not public.is_workspace_admin(v.workspace_id) then raise exception 'Somente o criador ou administrador pode excluir o grupo'; end if;
  delete from public.chat_conversations where id=p_conversation_id;
end;
$$;

create or replace function public.create_meeting(p_title text,p_member_ids uuid[],p_mode text,p_conversation_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.current_workspace_id();
  v_id uuid;
begin
  if v_workspace is null or auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_mode not in ('audio','video') then raise exception 'Modo inválido'; end if;

  if p_conversation_id is not null then
    if not public.is_conversation_member(p_conversation_id) then raise exception 'Você não participa desta conversa'; end if;
    if public.conversation_workspace_id(p_conversation_id) is distinct from v_workspace then raise exception 'Conversa inválida para este workspace'; end if;

    select id into v_id from public.meetings
    where conversation_id=p_conversation_id and ended_at is null
    order by created_at desc limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  begin
    insert into public.meetings(workspace_id,conversation_id,title,mode,created_by)
    values(v_workspace,p_conversation_id,coalesce(nullif(btrim(p_title),''),'Reunião'),p_mode::public.meeting_mode,auth.uid())
    returning id into v_id;
  exception when unique_violation then
    if p_conversation_id is not null then
      select id into v_id from public.meetings
      where conversation_id=p_conversation_id and ended_at is null
      order by created_at desc limit 1;
      if v_id is not null then return v_id; end if;
    end if;
    raise;
  end;

  if p_conversation_id is not null then
    insert into public.meeting_members(meeting_id,user_id)
    select v_id,cm.user_id
    from public.chat_members cm
    where cm.conversation_id=p_conversation_id
    on conflict do nothing;
  else
    insert into public.meeting_members(meeting_id,user_id)
    select v_id,x.user_id
    from (select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id) x
    where public.is_workspace_member(v_workspace,x.user_id)
    on conflict do nothing;
  end if;

  if (select count(*) from public.meeting_members where meeting_id=v_id)<2 then
    raise exception 'A reunião precisa de pelo menos dois participantes';
  end if;
  return v_id;
end;
$$;

create or replace function public.end_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.meetings%rowtype;
begin
  select * into v from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'Reunião não encontrada'; end if;
  if v.ended_at is not null then return; end if;
  if v.created_by<>auth.uid() and not public.is_workspace_admin(v.workspace_id) then raise exception 'Somente o criador ou administrador pode encerrar a reunião'; end if;
  update public.meetings set ended_at=now(),updated_at=now() where id=p_meeting_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security (leituras e operações simples; escritas críticas via RPC)
-- -----------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.user_preferences enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.activities enable row level security;
alter table public.activity_assignees enable row level security;
alter table public.subactivities enable row level security;
alter table public.work_sessions enable row level security;
alter table public.project_comments enable row level security;
alter table public.subactivity_comments enable row level security;
alter table public.attachments enable row level security;
alter table public.project_logs enable row level security;
alter table public.project_versions enable row level security;
alter table public.notifications enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_members enable row level security;

-- Limpa políticas de uma execução anterior desta migration.
do $$
declare r record;
begin
  for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and policyname like 'cadence_%' loop
    execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  end loop;
end $$;

create policy cadence_workspaces_select on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy cadence_profiles_select on public.profiles for select to authenticated using (
  exists(select 1 from public.workspace_members wm_self join public.workspace_members wm_other on wm_other.workspace_id=wm_self.workspace_id
         where wm_self.user_id=auth.uid() and wm_self.active and wm_other.user_id=profiles.id and wm_other.active)
);
create policy cadence_workspace_members_select on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy cadence_user_preferences_select on public.user_preferences for select to authenticated using (user_id=auth.uid());
create policy cadence_projects_select on public.projects for select to authenticated using (public.is_workspace_member(workspace_id));
create policy cadence_project_members_select on public.project_members for select to authenticated using (public.is_workspace_member(public.project_workspace_id(project_id)));
create policy cadence_activities_select on public.activities for select to authenticated using (public.is_workspace_member(public.project_workspace_id(project_id)));
create policy cadence_activity_assignees_select on public.activity_assignees for select to authenticated using (public.is_workspace_member(public.project_workspace_id(public.activity_project_id(activity_id))));
create policy cadence_subactivities_select on public.subactivities for select to authenticated using (public.is_workspace_member(public.project_workspace_id(public.subactivity_project_id(id))));
create policy cadence_work_sessions_select on public.work_sessions for select to authenticated using (public.is_workspace_member(public.project_workspace_id(public.subactivity_project_id(subactivity_id))));
create policy cadence_project_comments_select on public.project_comments for select to authenticated using (public.is_workspace_member(public.project_workspace_id(project_id)));
create policy cadence_subactivity_comments_select on public.subactivity_comments for select to authenticated using (public.is_workspace_member(public.project_workspace_id(public.subactivity_project_id(subactivity_id))));
create policy cadence_attachments_select on public.attachments for select to authenticated using (
  public.is_workspace_member(public.project_workspace_id(coalesce(project_id,public.subactivity_project_id(subactivity_id))))
);
create policy cadence_project_logs_select on public.project_logs for select to authenticated using (public.is_workspace_member(public.project_workspace_id(project_id)));
create policy cadence_project_versions_select on public.project_versions for select to authenticated using (public.is_workspace_member(public.project_workspace_id(project_id)));
create policy cadence_notifications_select on public.notifications for select to authenticated using (recipient_id=auth.uid());
create policy cadence_notifications_update on public.notifications for update to authenticated using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());
create policy cadence_chat_conversations_select on public.chat_conversations for select to authenticated using (public.is_conversation_member(id));
create policy cadence_chat_members_select on public.chat_members for select to authenticated using (public.is_conversation_member(conversation_id));
create policy cadence_chat_messages_select on public.chat_messages for select to authenticated using (public.is_conversation_member(conversation_id));
create policy cadence_meetings_select on public.meetings for select to authenticated using (public.is_meeting_member(id));
create policy cadence_meeting_members_select on public.meeting_members for select to authenticated using (public.is_meeting_member(meeting_id));

-- Escritas críticas são exclusivamente via RPCs security-definer acima.
revoke all on public.workspaces,public.profiles,public.workspace_members,public.user_preferences,public.projects,public.project_members,
  public.activities,public.activity_assignees,public.subactivities,public.work_sessions,public.project_comments,public.subactivity_comments,
  public.attachments,public.project_logs,public.project_versions,public.chat_conversations,public.chat_members,
  public.chat_messages,public.meetings,public.meeting_members from anon, authenticated;
grant select on public.workspaces,public.profiles,public.workspace_members,public.user_preferences,public.projects,public.project_members,
  public.activities,public.activity_assignees,public.subactivities,public.work_sessions,public.project_comments,public.subactivity_comments,
  public.attachments,public.project_logs,public.project_versions,public.chat_conversations,public.chat_members,
  public.chat_messages,public.meetings,public.meeting_members to authenticated;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;

-- Funções não ficam executáveis implicitamente pelo cliente.
-- A documentação do Supabase recomenda revogar o EXECUTE padrão e liberar apenas
-- os endpoints/funções auxiliares realmente necessários.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Helpers necessários pelas próprias políticas RLS avaliadas como authenticated.
grant execute on function public.current_workspace_id(),
 public.is_workspace_member(uuid,uuid), public.project_workspace_id(uuid), public.activity_project_id(uuid),
 public.subactivity_project_id(uuid), public.is_conversation_member(uuid,uuid), public.is_meeting_member(uuid,uuid),
 public.safe_path_workspace_id(text), public.can_access_meeting_realtime(text,uuid)
 to authenticated;

-- RPC grants explícitos para operações da aplicação.
grant execute on function public.update_my_profile(text,text), public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text), public.set_workspace_member_role(uuid,text),
 public.create_project(text,text,text,text,text,date,text,uuid[]),
 public.update_project(uuid,text,text,text,text,text,date,text,uuid[]),
 public.version_project(uuid,text,text,boolean), public.add_activity(uuid,text,uuid[]), public.delete_activity(uuid),
 public.start_subactivity(uuid), public.pause_subactivity(uuid), public.set_subactivity_status(uuid,text),
 public.add_subactivity(uuid,uuid,text,numeric,uuid,text), public.add_project_comment(uuid,text),
 public.add_subactivity_comment(uuid,text), public.add_attachment(uuid,uuid,text,text,bigint,text,text,text),
 public.set_attachment_active(uuid,boolean), public.ensure_direct_conversation(uuid), public.send_chat_message(uuid,text),
 public.create_chat_group(text,uuid[]), public.update_chat_group(uuid,text,uuid[]), public.delete_chat_group(uuid),
 public.create_meeting(text,uuid[],text,uuid), public.end_meeting(uuid)
 to authenticated;

-- Segurança de funções: funções SECURITY DEFINER não ficam executáveis por PUBLIC/anon.
revoke execute on function public.add_project_log(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.push_notification(uuid,uuid,text,text,text,uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.update_my_profile(text,text) from public, anon;
revoke execute on function public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text) from public, anon;
revoke execute on function public.set_workspace_member_role(uuid,text) from public, anon;
revoke execute on function public.create_project(text,text,text,text,text,date,text,uuid[]) from public, anon;
revoke execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) from public, anon;
revoke execute on function public.version_project(uuid,text,text,boolean) from public, anon;
revoke execute on function public.add_activity(uuid,text,uuid[]) from public, anon;
revoke execute on function public.delete_activity(uuid) from public, anon;
revoke execute on function public.start_subactivity(uuid) from public, anon;
revoke execute on function public.pause_subactivity(uuid) from public, anon;
revoke execute on function public.set_subactivity_status(uuid,text) from public, anon;
revoke execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) from public, anon;
revoke execute on function public.add_project_comment(uuid,text) from public, anon;
revoke execute on function public.add_subactivity_comment(uuid,text) from public, anon;
revoke execute on function public.add_attachment(uuid,uuid,text,text,bigint,text,text,text) from public, anon;
revoke execute on function public.set_attachment_active(uuid,boolean) from public, anon;
revoke execute on function public.ensure_direct_conversation(uuid) from public, anon;
revoke execute on function public.send_chat_message(uuid,text) from public, anon;
revoke execute on function public.create_chat_group(text,uuid[]) from public, anon;
revoke execute on function public.update_chat_group(uuid,text,uuid[]) from public, anon;
revoke execute on function public.delete_chat_group(uuid) from public, anon;
revoke execute on function public.create_meeting(text,uuid[],text,uuid) from public, anon;
revoke execute on function public.end_meeting(uuid) from public, anon;
revoke execute on function public.can_access_meeting_realtime(text,uuid) from public, anon;
grant execute on function public.can_access_meeting_realtime(text,uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit)
values('cadence-attachments','cadence-attachments',false,52428800)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cadence-avatars','cadence-avatars',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Storage policies idempotentes.
drop policy if exists cadence_attachments_storage_select on storage.objects;
drop policy if exists cadence_attachments_storage_insert on storage.objects;
drop policy if exists cadence_attachments_storage_rollback_delete on storage.objects;
drop policy if exists cadence_avatars_storage_select on storage.objects;
drop policy if exists cadence_avatars_storage_insert on storage.objects;
drop policy if exists cadence_avatars_storage_update on storage.objects;
drop policy if exists cadence_avatars_storage_delete on storage.objects;

create policy cadence_attachments_storage_select on storage.objects for select to authenticated
using (bucket_id='cadence-attachments' and public.is_workspace_member(public.safe_path_workspace_id(name)));
create policy cadence_attachments_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='cadence-attachments' and public.is_workspace_member(public.safe_path_workspace_id(name)));
create policy cadence_attachments_storage_rollback_delete on storage.objects for delete to authenticated
using (
  bucket_id='cadence-attachments'
  and split_part(name,'/',3)=auth.uid()::text
  and not exists(select 1 from public.attachments a where a.storage_path=storage.objects.name)
);

create policy cadence_avatars_storage_select on storage.objects for select to public
using (bucket_id='cadence-avatars');
create policy cadence_avatars_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='cadence-avatars' and split_part(name,'/',1)=auth.uid()::text);
create policy cadence_avatars_storage_update on storage.objects for update to authenticated
using (bucket_id='cadence-avatars' and split_part(name,'/',1)=auth.uid()::text)
with check (bucket_id='cadence-avatars' and split_part(name,'/',1)=auth.uid()::text);
create policy cadence_avatars_storage_delete on storage.objects for delete to authenticated
using (bucket_id='cadence-avatars' and split_part(name,'/',1)=auth.uid()::text);

-- -----------------------------------------------------------------------------
-- Realtime Authorization: canais privados das reuniões WebRTC.
-- O tópico usado no cliente é meeting:<uuid>.
-- -----------------------------------------------------------------------------
-- RLS em realtime.messages já é habilitado e gerenciado pelo Supabase.
-- Não executar ALTER TABLE aqui: o usuário do projeto não é owner dessa tabela.
drop policy if exists cadence_meeting_realtime_select on realtime.messages;
drop policy if exists cadence_meeting_realtime_insert on realtime.messages;
create policy cadence_meeting_realtime_select on realtime.messages
  for select to authenticated
  using (public.can_access_meeting_realtime((select realtime.topic())));
create policy cadence_meeting_realtime_insert on realtime.messages
  for insert to authenticated
  with check (public.can_access_meeting_realtime((select realtime.topic())));

-- -----------------------------------------------------------------------------
-- Realtime: habilita mudanças das tabelas de uso geral.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;

  foreach t in array array[
    'profiles','workspace_members','user_preferences','projects','project_members','activities','activity_assignees','subactivities',
    'work_sessions','project_comments','subactivity_comments','attachments','project_logs','project_versions','notifications',
    'chat_conversations','chat_members','chat_messages','meetings','meeting_members'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

commit;
