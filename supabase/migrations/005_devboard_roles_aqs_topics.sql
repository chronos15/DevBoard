-- Devboard · Roles, fluxo AQS e Tópicos
-- Incremental: execute após 004_devboard_chat_media_attachments.sql.
-- Não remove dados existentes.

-- Valores adicionados a enums existentes precisam ser confirmados antes de uso em
-- expressões/tabelas no PostgreSQL. Por isso estes ALTER TYPE ficam fora do bloco BEGIN.
alter type public.workspace_role add value if not exists 'developer';
alter type public.workspace_role add value if not exists 'aqs';
alter type public.workspace_role add value if not exists 'support';
alter type public.subactivity_status add value if not exists 'waiting-aqs';

begin;

do $$ begin
  create type public.aqs_review_status as enum ('awaiting','evaluating','completed','revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_topic_status as enum ('open','analyzing','sent-to-dev','revoked');
exception when duplicate_object then null; end $$;

alter table public.subactivities
  add column if not exists needs_attention boolean not null default false,
  add column if not exists attention_message text;

create table if not exists public.aqs_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  status public.aqs_review_status not null default 'awaiting',
  assigned_aqs_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
);
create index if not exists aqs_reviews_workspace_status_idx on public.aqs_reviews(workspace_id,status,created_at desc);
create index if not exists aqs_reviews_subactivity_idx on public.aqs_reviews(subactivity_id,created_at desc);
create unique index if not exists aqs_reviews_one_active_sub_uidx
  on public.aqs_reviews(subactivity_id)
  where status in ('awaiting','evaluating');

create table if not exists public.support_topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_number text not null,
  title text not null,
  description text not null,
  status public.support_topic_status not null default 'open',
  created_by uuid not null references public.profiles(id),
  assigned_analyst_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  developer_id uuid references public.profiles(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_topics_workspace_status_idx on public.support_topics(workspace_id,status,updated_at desc);
create index if not exists support_topics_creator_idx on public.support_topics(created_by,created_at desc);
create unique index if not exists support_topics_workspace_order_uidx on public.support_topics(workspace_id,lower(order_number));
drop trigger if exists support_topics_set_updated_at on public.support_topics;
create trigger support_topics_set_updated_at before update on public.support_topics for each row execute procedure public.set_updated_at();

create table if not exists public.topic_attachments (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.support_topics(id) on delete cascade,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check(size_bytes > 0 and size_bytes <= 52428800),
  kind public.attachment_kind not null default 'other',
  storage_path text not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists topic_attachments_topic_idx on public.topic_attachments(topic_id,created_at);
create unique index if not exists topic_attachments_path_uidx on public.topic_attachments(storage_path);

create or replace function public.current_workspace_role()
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select wm.role
  from public.workspace_members wm
  where wm.user_id=auth.uid() and wm.active
  order by wm.joined_at
  limit 1;
$$;

create or replace function public.has_workspace_role(
  p_roles public.workspace_role[],
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.workspace_members wm
    where wm.user_id=p_user_id and wm.active and wm.role=any(p_roles)
  );
$$;

create or replace function public.workspace_role_of(p_workspace_id uuid,p_user_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id=p_workspace_id and wm.user_id=p_user_id and wm.active
  limit 1;
$$;

create or replace function public.can_view_topic(p_topic_id uuid,p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
    from public.support_topics t
    join public.workspace_members wm on wm.workspace_id=t.workspace_id and wm.user_id=p_user_id and wm.active
    where t.id=p_topic_id
      and (wm.role in ('admin','developer','aqs','support') or t.created_by=p_user_id)
  );
$$;

create or replace function public.safe_topic_media_topic_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v:=split_part(p_name,'/',2);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return v::uuid; end if;
  return null;
exception when others then return null;
end;
$$;

create or replace function public.safe_topic_media_uploader_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v:=split_part(p_name,'/',3);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return v::uuid; end if;
  return null;
exception when others then return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
create or replace function public.set_workspace_member_role(p_user_id uuid,p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.current_workspace_id();
begin
  if v_workspace is null or not public.is_workspace_admin(v_workspace) then
    raise exception 'Somente administradores podem alterar permissões';
  end if;
  if p_role not in ('member','support','aqs','developer','admin') then raise exception 'Permissão inválida'; end if;
  if p_user_id=auth.uid() and p_role<>'admin' and not exists(
    select 1 from public.workspace_members
    where workspace_id=v_workspace and role='admin' and active and user_id<>auth.uid()
  ) then
    raise exception 'O workspace precisa manter ao menos um administrador';
  end if;
  update public.workspace_members set role=p_role::public.workspace_role
  where workspace_id=v_workspace and user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões de Projeto / Atividade / Subatividade
-- Admin: tudo. Developer: gestão geral, execução apenas do que for seu.
-- AQS/Support/Member não alteram estrutura do projeto por estas RPCs.
-- -----------------------------------------------------------------------------
create or replace function public.create_project(
  p_name text,p_client text,p_description text,p_tag text,p_priority text,p_due_date date,
  p_repository text default '',p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.current_workspace_id(); v_project uuid; v_member uuid;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) then
    raise exception 'Somente Administrador ou Desenvolvedor pode criar projetos';
  end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_due_date is null then raise exception 'Data de entrega é obrigatória'; end if;
  if p_priority not in ('low','medium','high') then raise exception 'Prioridade inválida'; end if;

  insert into public.projects(workspace_id,name,client,description,tag,priority,due_date,repository,created_by)
  values(v_workspace,btrim(p_name),coalesce(nullif(btrim(p_client),''),'Projeto interno'),coalesce(p_description,''),
    coalesce(nullif(btrim(p_tag),''),'Desenvolvimento'),p_priority::public.project_priority,p_due_date,coalesce(p_repository,''),auth.uid())
  returning id into v_project;

  insert into public.project_members(project_id,user_id,added_by)
  select v_project,x.user_id,auth.uid()
  from (select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id) x
  where public.is_workspace_member(v_workspace,x.user_id)
  on conflict do nothing;

  perform public.add_project_log(v_project,'created','Projeto criado','Projeto criado e disponibilizado para a equipe.',auth.uid());
  for v_member in select user_id from public.project_members where project_id=v_project and user_id<>auth.uid() loop
    perform public.push_notification(v_member,auth.uid(),'project-assigned','Você foi adicionado a um projeto',btrim(p_name),v_project,null,null);
  end loop;
  return v_project;
end;
$$;

create or replace function public.update_project(
  p_project_id uuid,p_name text,p_client text,p_description text,p_tag text,p_priority text,p_due_date date,
  p_repository text default '',p_member_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_project public.projects%rowtype; v_workspace uuid; v_description text:=''; v_old_members uuid[]; v_member uuid;
begin
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception 'Projeto não encontrado'; end if;
  v_workspace:=v_project.workspace_id;
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role])
     or not public.is_workspace_member(v_workspace) then raise exception 'Sem permissão para editar projetos'; end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_due_date is null then raise exception 'Data de entrega é obrigatória'; end if;
  if p_priority not in ('low','medium','high') then raise exception 'Prioridade inválida'; end if;

  if v_project.name is distinct from btrim(p_name) then v_description:=v_description||format('Nome: “%s” → “%s”. ',v_project.name,btrim(p_name)); end if;
  if v_project.client is distinct from coalesce(nullif(btrim(p_client),''),'Projeto interno') then v_description:=v_description||'Cliente/área alterado. '; end if;
  if v_project.description is distinct from coalesce(p_description,'') then v_description:=v_description||'Descrição alterada. '; end if;
  if v_project.tag is distinct from coalesce(nullif(btrim(p_tag),''),'Desenvolvimento') then v_description:=v_description||'Categoria alterada. '; end if;
  if v_project.priority::text is distinct from p_priority then v_description:=v_description||'Prioridade alterada. '; end if;
  if v_project.due_date is distinct from p_due_date then v_description:=v_description||'Data de entrega alterada. '; end if;
  if v_project.repository is distinct from coalesce(p_repository,'') then v_description:=v_description||'Repositório/caminho alterado. '; end if;

  select coalesce(array_agg(user_id order by user_id),'{}'::uuid[]) into v_old_members from public.project_members where project_id=p_project_id;
  update public.projects set name=btrim(p_name),client=coalesce(nullif(btrim(p_client),''),'Projeto interno'),description=coalesce(p_description,''),
    tag=coalesce(nullif(btrim(p_tag),''),'Desenvolvimento'),priority=p_priority::public.project_priority,due_date=p_due_date,repository=coalesce(p_repository,'')
  where id=p_project_id;

  delete from public.project_members where project_id=p_project_id;
  insert into public.project_members(project_id,user_id,added_by)
  select p_project_id,x.user_id,auth.uid() from (select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id) x
  where public.is_workspace_member(v_workspace,x.user_id) on conflict do nothing;

  if v_old_members is distinct from (select coalesce(array_agg(user_id order by user_id),'{}'::uuid[]) from public.project_members where project_id=p_project_id) then
    v_description:=v_description||'Responsáveis alterados. ';
  end if;
  perform public.add_project_log(p_project_id,'updated','Projeto atualizado',nullif(btrim(v_description),''),auth.uid());
  for v_member in select user_id from public.project_members where project_id=p_project_id and user_id<>auth.uid() and not(user_id=any(v_old_members)) loop
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
declare v_workspace uuid:=public.project_workspace_id(p_project_id);
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para versionar projetos';
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

create or replace function public.add_activity(p_project_id uuid,p_title text,p_assignee_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.project_workspace_id(p_project_id); v_activity uuid; v_user uuid; v_project_name text;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar atividades';
  end if;
  if length(btrim(coalesce(p_title,'')))=0 then raise exception 'Título da atividade é obrigatório'; end if;
  if exists(
    select 1 from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) x(user_id)
    where public.workspace_role_of(v_workspace,x.user_id) not in ('admin','developer')
  ) then raise exception 'Atividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor'; end if;

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
  v_workspace:=public.project_workspace_id(v_activity.project_id);
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para excluir atividades';
  end if;
  if exists(select 1 from public.subactivities where activity_id=p_activity_id) then raise exception 'Só é possível excluir atividades sem subatividades'; end if;
  perform public.add_project_log(v_activity.project_id,'activity-deleted','Atividade excluída',format('“%s” foi removida do projeto.',v_activity.title),auth.uid());
  delete from public.activities where id=p_activity_id;
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
declare v_workspace uuid:=public.project_workspace_id(p_project_id); v_id uuid; v_activity_title text; v_project_name text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then raise exception 'Atividade não pertence ao projeto'; end if;
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar subatividades';
  end if;
  if length(btrim(coalesce(p_title,'')))=0 then raise exception 'Título da subatividade é obrigatório'; end if;
  if public.workspace_role_of(v_workspace,p_assignee_id) not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;
  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then raise exception 'Status inválido'; end if;
  if p_status='in-progress' and p_assignee_id<>auth.uid() and not public.is_workspace_admin(v_workspace) then
    raise exception 'Desenvolvedor só pode iniciar a própria subatividade';
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

create or replace function public.enqueue_aqs_review(p_subactivity_id uuid,p_actor_id uuid default auth.uid())
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid; v_activity uuid; v_workspace uuid; v_review uuid; v_sub_title text; v_recipient uuid;
begin
  select s.activity_id,s.title into v_activity,v_sub_title from public.subactivities s where s.id=p_subactivity_id;
  if v_activity is null then raise exception 'Subatividade não encontrada'; end if;
  v_project:=public.activity_project_id(v_activity); v_workspace:=public.project_workspace_id(v_project);
  select id into v_review from public.aqs_reviews where subactivity_id=p_subactivity_id and status in ('awaiting','evaluating') order by created_at desc limit 1;
  if v_review is null then
    insert into public.aqs_reviews(workspace_id,project_id,activity_id,subactivity_id,status,created_by)
    values(v_workspace,v_project,v_activity,p_subactivity_id,'awaiting',p_actor_id) returning id into v_review;
  end if;
  perform public.add_project_log(v_project,'aqs-submitted','Subatividade enviada para AQS',format('“%s” entrou na fila de análise.',v_sub_title),p_actor_id);
  -- Notifica individualmente TODOS os usuários ativos com role AQS.
  -- Administradores continuam com acesso à fila, mas não entram nesta distribuição
  -- automática a menos que sua role efetiva seja AQS.
  for v_recipient in
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id=v_workspace
      and wm.active
      and wm.role='aqs'::public.workspace_role
      and wm.user_id<>p_actor_id
  loop
    perform public.push_notification(
      v_recipient,
      p_actor_id,
      'aqs-awaiting',
      'Nova tarefa aguardando AQS',
      v_sub_title,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end loop;
  return v_review;
end;
$$;

create or replace function public.start_subactivity(p_subactivity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub public.subactivities%rowtype; v_project uuid; v_workspace uuid; v_is_admin boolean; v_other record; v_now timestamptz:=now();
begin
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_project:=public.subactivity_project_id(p_subactivity_id); v_workspace:=public.project_workspace_id(v_project); v_is_admin:=public.is_workspace_admin(v_workspace);
  if not v_is_admin and public.current_workspace_role()<>'developer' then raise exception 'Somente Administrador ou Desenvolvedor pode executar subatividades'; end if;
  if not v_is_admin and v_sub.assignee_id<>auth.uid() then raise exception 'Desenvolvedor só pode executar a própria subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_is_admin then raise exception 'Somente um administrador pode reabrir uma subatividade finalizada'; end if;
  if v_sub.status='waiting-aqs' and not v_is_admin then raise exception 'A subatividade está em análise AQS'; end if;
  if v_sub.status='in-progress' then return; end if;

  perform 1 from public.profiles where id=v_sub.assignee_id for update;
  for v_other in select s.*,a.project_id from public.subactivities s join public.activities a on a.id=s.activity_id
    where s.assignee_id=v_sub.assignee_id and s.status='in-progress' and s.id<>p_subactivity_id for update of s
  loop
    update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
      where user_id=v_sub.assignee_id and subactivity_id=v_other.id and ended_at is null;
    update public.subactivities set tracked_seconds=tracked_seconds+greatest(0,floor(extract(epoch from(v_now-timer_started_at)))::bigint),status='paused',timer_started_at=null where id=v_other.id;
    perform public.add_project_log(v_other.project_id,'subactivity-status','Subatividade pausada automaticamente',format('“%s” foi pausada porque o responsável iniciou outra subatividade.',v_other.title),auth.uid());
  end loop;
  update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint) where user_id=v_sub.assignee_id and ended_at is null;
  update public.subactivities set status='in-progress',timer_started_at=v_now,completed_at=null,cancelled_at=null,needs_attention=false,attention_message=null where id=p_subactivity_id;
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
  if not public.is_workspace_admin(v_workspace) and (public.current_workspace_role()<>'developer' or v_sub.assignee_id<>auth.uid()) then
    raise exception 'Desenvolvedor só pode pausar a própria subatividade';
  end if;
  if v_sub.status<>'in-progress' then return; end if;
  update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
    where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  update public.subactivities set tracked_seconds=tracked_seconds+greatest(0,floor(extract(epoch from(v_now-timer_started_at)))::bigint),status='paused',timer_started_at=null where id=p_subactivity_id;
  perform public.add_project_log(v_project,'subactivity-status','Subatividade pausada',format('“%s” foi pausada.',v_sub.title),auth.uid());
end;
$$;

create or replace function public.set_subactivity_status(p_subactivity_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub public.subactivities%rowtype; v_project uuid; v_workspace uuid; v_admin boolean; v_role public.workspace_role; v_now timestamptz:=now();
begin
  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then raise exception 'Status inválido'; end if;
  if p_status='in-progress' then perform public.start_subactivity(p_subactivity_id); return; end if;
  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  if v_sub.status::text=p_status then return; end if;
  v_project:=public.subactivity_project_id(p_subactivity_id); v_workspace:=public.project_workspace_id(v_project); v_admin:=public.is_workspace_admin(v_workspace); v_role:=public.current_workspace_role();
  if not v_admin and (v_role<>'developer' or v_sub.assignee_id<>auth.uid()) then raise exception 'Desenvolvedor só pode alterar a própria subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_admin then raise exception 'Somente um administrador pode alterar uma subatividade finalizada'; end if;
  if v_sub.status='waiting-aqs' and not v_admin then raise exception 'Aguardando decisão do AQS'; end if;

  if v_sub.status='in-progress' then
    update public.work_sessions set ended_at=v_now,duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
    where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  end if;
  update public.subactivities
  set tracked_seconds=tracked_seconds+case when v_sub.status='in-progress' then greatest(0,floor(extract(epoch from(v_now-v_sub.timer_started_at)))::bigint) else 0 end,
      status=p_status::public.subactivity_status,timer_started_at=null,
      completed_at=case when p_status='done' then v_now else null end,
      cancelled_at=case when p_status='cancelled' then v_now else null end,
      needs_attention=case when p_status='waiting' then needs_attention else false end,
      attention_message=case when p_status='waiting' then attention_message else null end
  where id=p_subactivity_id;

  if p_status='waiting-aqs' then
    perform public.enqueue_aqs_review(p_subactivity_id,auth.uid());
  else
    perform public.add_project_log(v_project,'subactivity-status','Status da subatividade alterado',format('“%s”: %s → %s.',v_sub.title,v_sub.status::text,p_status),auth.uid());
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- AQS
-- -----------------------------------------------------------------------------
create or replace function public.start_aqs_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.aqs_reviews%rowtype; v_sub_title text;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Apenas AQS ou Administrador pode avaliar'; end if;
  select * into v from public.aqs_reviews where id=p_review_id for update;
  if not found then raise exception 'Revisão AQS não encontrada'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Revisão fora do seu workspace'; end if;
  if v.status='completed' or v.status='revoked' then raise exception 'Esta análise já foi finalizada'; end if;
  if v.status='evaluating' and v.assigned_aqs_id is distinct from auth.uid() and public.current_workspace_role()<>'admin' then raise exception 'Esta análise já está com outro AQS'; end if;
  update public.aqs_reviews set status='evaluating',assigned_aqs_id=auth.uid(),started_at=coalesce(started_at,now()) where id=p_review_id;
  select title into v_sub_title from public.subactivities where id=v.subactivity_id;
  perform public.add_project_log(v.project_id,'aqs-started','Análise AQS iniciada',format('“%s” está sendo avaliada.',v_sub_title),auth.uid());
end;
$$;

create or replace function public.complete_aqs_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.aqs_reviews%rowtype; v_sub public.subactivities%rowtype;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Apenas AQS ou Administrador pode concluir a análise'; end if;
  select * into v from public.aqs_reviews where id=p_review_id for update;
  if not found then raise exception 'Revisão AQS não encontrada'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Revisão fora do seu workspace'; end if;
  if v.status not in ('awaiting','evaluating') then raise exception 'Esta análise já foi finalizada'; end if;
  if v.assigned_aqs_id is not null and v.assigned_aqs_id<>auth.uid() and public.current_workspace_role()<>'admin' then raise exception 'Esta análise pertence a outro AQS'; end if;
  select * into v_sub from public.subactivities where id=v.subactivity_id for update;
  update public.aqs_reviews set status='completed',assigned_aqs_id=coalesce(assigned_aqs_id,auth.uid()),started_at=coalesce(started_at,now()),completed_at=now() where id=p_review_id;
  update public.subactivities set status='done',timer_started_at=null,completed_at=now(),cancelled_at=null,needs_attention=false,attention_message=null where id=v.subactivity_id;
  perform public.add_project_log(v.project_id,'aqs-completed','AQS aprovou a subatividade',format('“%s” foi aprovada e concluída.',v_sub.title),auth.uid());
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'aqs-approved','AQS aprovou sua subatividade',format('“%s” foi concluída após a análise.',v_sub.title),v.project_id,v.activity_id,v.subactivity_id);
end;
$$;

create or replace function public.revoke_aqs_review(p_review_id uuid,p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.aqs_reviews%rowtype; v_sub public.subactivities%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Apenas AQS ou Administrador pode revogar a análise'; end if;
  if length(v_reason)<3 then raise exception 'Informe o motivo da revogação'; end if;
  select * into v from public.aqs_reviews where id=p_review_id for update;
  if not found then raise exception 'Revisão AQS não encontrada'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Revisão fora do seu workspace'; end if;
  if v.status not in ('awaiting','evaluating') then raise exception 'Esta análise já foi finalizada'; end if;
  if v.assigned_aqs_id is not null and v.assigned_aqs_id<>auth.uid() and public.current_workspace_role()<>'admin' then raise exception 'Esta análise pertence a outro AQS'; end if;
  select * into v_sub from public.subactivities where id=v.subactivity_id for update;
  update public.aqs_reviews set status='revoked',assigned_aqs_id=coalesce(assigned_aqs_id,auth.uid()),started_at=coalesce(started_at,now()),revoked_at=now(),revoked_reason=v_reason where id=p_review_id;
  update public.subactivities set status='waiting',timer_started_at=null,completed_at=null,cancelled_at=null,needs_attention=true,attention_message=v_reason where id=v.subactivity_id;
  perform public.add_project_log(v.project_id,'aqs-revoked','AQS solicitou ajustes',format('“%s” voltou para o desenvolvedor. Motivo: %s',v_sub.title,v_reason),auth.uid());
  perform public.push_notification(v_sub.assignee_id,auth.uid(),'aqs-revoked','AQS revogou sua subatividade',format('“%s” precisa de ajustes: %s',v_sub.title,left(v_reason,180)),v.project_id,v.activity_id,v.subactivity_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Tópicos
-- -----------------------------------------------------------------------------
create or replace function public.create_support_topic(p_order_number text,p_title text,p_description text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.current_workspace_id(); v_id uuid; v_recipient uuid;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.has_workspace_role(array['admin'::public.workspace_role,'support'::public.workspace_role,'member'::public.workspace_role]) then
    raise exception 'Apenas Administrador, Suporte ou Membro pode abrir tópicos';
  end if;
  if length(btrim(coalesce(p_order_number,'')))=0 then raise exception 'Número da ordem é obrigatório'; end if;
  if length(btrim(coalesce(p_title,'')))<3 then raise exception 'Informe um título'; end if;
  if length(btrim(coalesce(p_description,'')))<5 then raise exception 'Informe uma descrição'; end if;
  insert into public.support_topics(workspace_id,order_number,title,description,created_by)
  values(v_workspace,btrim(p_order_number),btrim(p_title),btrim(p_description),auth.uid()) returning id into v_id;
  for v_recipient in select wm.user_id from public.workspace_members wm where wm.workspace_id=v_workspace and wm.active and wm.role in ('admin','developer','aqs') and wm.user_id<>auth.uid() loop
    perform public.push_notification(v_recipient,auth.uid(),'topic-created','Novo tópico para análise',format('Ordem %s · %s',btrim(p_order_number),btrim(p_title)),null,null,null);
  end loop;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um tópico com este número de ordem';
end;
$$;

create or replace function public.add_topic_attachment(
  p_topic_id uuid,p_name text,p_mime_type text,p_size_bytes bigint,p_kind text,p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_topic public.support_topics%rowtype; v_id uuid;
begin
  select * into v_topic from public.support_topics where id=p_topic_id;
  if not found then raise exception 'Tópico não encontrado'; end if;
  if not public.can_view_topic(p_topic_id) then raise exception 'Sem acesso ao tópico'; end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do arquivo inválido'; end if;
  if coalesce(p_size_bytes,0)<=0 or p_size_bytes>52428800 then raise exception 'Arquivo deve ter no máximo 50 MB'; end if;
  if p_kind not in ('image','pdf','text','document','video','audio','other') then raise exception 'Tipo de arquivo inválido'; end if;
  if public.safe_path_workspace_id(p_storage_path) is distinct from v_topic.workspace_id
     or public.safe_topic_media_topic_id(p_storage_path) is distinct from p_topic_id
     or public.safe_topic_media_uploader_id(p_storage_path) is distinct from auth.uid() then raise exception 'Caminho de Storage inválido'; end if;
  insert into public.topic_attachments(topic_id,name,mime_type,size_bytes,kind,storage_path,uploaded_by)
  values(p_topic_id,btrim(p_name),coalesce(nullif(btrim(p_mime_type),''),'application/octet-stream'),p_size_bytes,p_kind::public.attachment_kind,p_storage_path,auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.start_topic_analysis(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.support_topics%rowtype;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Sem permissão para analisar tópicos'; end if;
  select * into v from public.support_topics where id=p_topic_id for update;
  if not found then raise exception 'Tópico não encontrado'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Tópico fora do seu workspace'; end if;
  if v.status in ('sent-to-dev','revoked') then raise exception 'Este tópico já foi finalizado'; end if;
  update public.support_topics set status='analyzing',assigned_analyst_id=auth.uid(),revoked_reason=null where id=p_topic_id;
  perform public.push_notification(v.created_by,auth.uid(),'topic-status','Seu tópico está em análise',format('Ordem %s · %s',v.order_number,v.title),null,null,null);
end;
$$;

create or replace function public.revoke_support_topic(p_topic_id uuid,p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.support_topics%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Sem permissão para revogar tópicos'; end if;
  if length(v_reason)<3 then raise exception 'Informe o motivo da revogação'; end if;
  select * into v from public.support_topics where id=p_topic_id for update;
  if not found then raise exception 'Tópico não encontrado'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Tópico fora do seu workspace'; end if;
  if v.status='sent-to-dev' then raise exception 'Tópico já convertido em atividade'; end if;
  update public.support_topics set status='revoked',assigned_analyst_id=coalesce(assigned_analyst_id,auth.uid()),revoked_reason=v_reason where id=p_topic_id;
  perform public.push_notification(v.created_by,auth.uid(),'topic-status','Seu tópico foi revogado',format('Ordem %s · %s',v.order_number,left(v_reason,160)),null,null,null);
end;
$$;

create or replace function public.send_topic_to_activity(p_topic_id uuid,p_project_id uuid,p_developer_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.support_topics%rowtype; v_workspace uuid; v_activity uuid; v_recipient uuid; v_project_name text;
begin
  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role,'aqs'::public.workspace_role]) then raise exception 'Sem permissão para encaminhar tópicos'; end if;
  select * into v from public.support_topics where id=p_topic_id for update;
  if not found then raise exception 'Tópico não encontrado'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Tópico fora do seu workspace'; end if;
  if v.status='sent-to-dev' then return v.activity_id; end if;
  v_workspace:=public.project_workspace_id(p_project_id);
  if v_workspace is distinct from v.workspace_id then raise exception 'Projeto inválido para este workspace'; end if;
  if p_developer_id is not null and public.workspace_role_of(v_workspace,p_developer_id)<>'developer' then raise exception 'O responsável associado precisa ter a role Desenvolvedor'; end if;

  insert into public.activities(project_id,title,created_by)
  values(p_project_id,format('[Ordem %s] %s',v.order_number,v.title),auth.uid()) returning id into v_activity;
  if p_developer_id is not null then
    insert into public.activity_assignees(activity_id,user_id) values(v_activity,p_developer_id) on conflict do nothing;
  end if;
  update public.support_topics set status='sent-to-dev',assigned_analyst_id=coalesce(assigned_analyst_id,auth.uid()),project_id=p_project_id,activity_id=v_activity,developer_id=p_developer_id,revoked_reason=null where id=p_topic_id;
  select name into v_project_name from public.projects where id=p_project_id;
  perform public.add_project_log(p_project_id,'topic-to-activity','Tópico convertido em atividade',format('Ordem %s · “%s” foi enviada para desenvolvimento.',v.order_number,v.title),auth.uid());

  for v_recipient in select wm.user_id from public.workspace_members wm where wm.workspace_id=v_workspace and wm.active and wm.role='admin' and wm.user_id<>auth.uid() loop
    perform public.push_notification(v_recipient,auth.uid(),'topic-sent','Tópico enviado para desenvolvimento',format('Ordem %s · %s · %s',v.order_number,v.title,v_project_name),p_project_id,v_activity,null);
  end loop;
  if p_developer_id is not null then
    perform public.push_notification(p_developer_id,auth.uid(),'topic-sent','Nova atividade originada do Suporte',format('Ordem %s · %s · %s',v.order_number,v.title,v_project_name),p_project_id,v_activity,null);
  end if;
  perform public.push_notification(v.created_by,auth.uid(),'topic-status','Seu tópico foi enviado para desenvolvimento',format('Ordem %s · %s',v.order_number,v_project_name),p_project_id,v_activity,null);
  return v_activity;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS / grants
-- -----------------------------------------------------------------------------
alter table public.aqs_reviews enable row level security;
alter table public.support_topics enable row level security;
alter table public.topic_attachments enable row level security;

drop policy if exists devboard_aqs_reviews_select on public.aqs_reviews;
drop policy if exists devboard_support_topics_select on public.support_topics;
drop policy if exists devboard_topic_attachments_select on public.topic_attachments;

create policy devboard_aqs_reviews_select on public.aqs_reviews for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role,'aqs'::public.workspace_role])
);

create policy devboard_support_topics_select on public.support_topics for select to authenticated
using (public.can_view_topic(id));

create policy devboard_topic_attachments_select on public.topic_attachments for select to authenticated
using (public.can_view_topic(topic_id));

revoke all on public.aqs_reviews,public.support_topics,public.topic_attachments from anon,authenticated;
grant select on public.aqs_reviews,public.support_topics,public.topic_attachments to authenticated;

revoke execute on function public.current_workspace_role() from public,anon;
revoke execute on function public.has_workspace_role(public.workspace_role[],uuid) from public,anon;
revoke execute on function public.workspace_role_of(uuid,uuid) from public,anon;
revoke execute on function public.can_view_topic(uuid,uuid) from public,anon;
revoke execute on function public.safe_topic_media_topic_id(text) from public,anon;
revoke execute on function public.safe_topic_media_uploader_id(text) from public,anon;
grant execute on function public.current_workspace_role(),public.has_workspace_role(public.workspace_role[],uuid),public.workspace_role_of(uuid,uuid),public.can_view_topic(uuid,uuid),public.safe_topic_media_topic_id(text),public.safe_topic_media_uploader_id(text) to authenticated;

revoke execute on function public.enqueue_aqs_review(uuid,uuid) from public,anon,authenticated;

revoke execute on function public.start_aqs_review(uuid) from public,anon;
revoke execute on function public.complete_aqs_review(uuid) from public,anon;
revoke execute on function public.revoke_aqs_review(uuid,text) from public,anon;
revoke execute on function public.create_support_topic(text,text,text) from public,anon;
revoke execute on function public.add_topic_attachment(uuid,text,text,bigint,text,text) from public,anon;
revoke execute on function public.start_topic_analysis(uuid) from public,anon;
revoke execute on function public.revoke_support_topic(uuid,text) from public,anon;
revoke execute on function public.send_topic_to_activity(uuid,uuid,uuid) from public,anon;
grant execute on function public.start_aqs_review(uuid),public.complete_aqs_review(uuid),public.revoke_aqs_review(uuid,text),
  public.create_support_topic(text,text,text),public.add_topic_attachment(uuid,text,text,bigint,text,text),public.start_topic_analysis(uuid),
  public.revoke_support_topic(uuid,text),public.send_topic_to_activity(uuid,uuid,uuid) to authenticated;

-- Reafirma grants das RPCs substituídas.
revoke execute on function public.set_workspace_member_role(uuid,text),public.create_project(text,text,text,text,text,date,text,uuid[]),
 public.update_project(uuid,text,text,text,text,text,date,text,uuid[]),public.version_project(uuid,text,text,boolean),
 public.add_activity(uuid,text,uuid[]),public.delete_activity(uuid),public.add_subactivity(uuid,uuid,text,numeric,uuid,text),
 public.start_subactivity(uuid),public.pause_subactivity(uuid),public.set_subactivity_status(uuid,text) from public,anon;
grant execute on function public.set_workspace_member_role(uuid,text),public.create_project(text,text,text,text,text,date,text,uuid[]),
 public.update_project(uuid,text,text,text,text,text,date,text,uuid[]),public.version_project(uuid,text,text,boolean),
 public.add_activity(uuid,text,uuid[]),public.delete_activity(uuid),public.add_subactivity(uuid,uuid,text,numeric,uuid,text),
 public.start_subactivity(uuid),public.pause_subactivity(uuid),public.set_subactivity_status(uuid,text) to authenticated;

-- Storage privado dos tópicos.
insert into storage.buckets(id,name,public,file_size_limit)
values('devboard-topic-media','devboard-topic-media',false,52428800)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=null;

drop policy if exists devboard_topic_media_select on storage.objects;
drop policy if exists devboard_topic_media_insert on storage.objects;
drop policy if exists devboard_topic_media_rollback_delete on storage.objects;

create policy devboard_topic_media_select on storage.objects for select to authenticated
using (
  bucket_id='devboard-topic-media'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
  and public.can_view_topic(public.safe_topic_media_topic_id(name))
);
create policy devboard_topic_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id='devboard-topic-media'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
  and public.can_view_topic(public.safe_topic_media_topic_id(name))
  and public.safe_topic_media_uploader_id(name)=auth.uid()
);
create policy devboard_topic_media_rollback_delete on storage.objects for delete to authenticated
using (
  bucket_id='devboard-topic-media'
  and public.safe_topic_media_uploader_id(name)=auth.uid()
  and not exists(select 1 from public.topic_attachments ta where ta.storage_path=storage.objects.name)
);

-- Realtime das novas filas.
do $$
declare t text;
begin
  foreach t in array array['aqs_reviews','support_topics','topic_attachments'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

commit;
