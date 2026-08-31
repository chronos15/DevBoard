begin;

-- 026 · Permissões estruturais de projetos
-- Admin: pode criar/excluir atividades, criar subatividades e converter tópicos em atividades.
-- Developer: só pode editar/versionar projetos em que está integrado.
-- Demais usuários: mantêm leitura, comentários e anexos conforme as políticas existentes.
-- Comentários/anexos não são restringidos por esta migration.

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
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para editar projetos';
  end if;
  if not public.is_workspace_admin(v_workspace) and (
    public.workspace_role_of(v_workspace,auth.uid())<>'developer'
    or not exists(select 1 from public.project_members pm where pm.project_id=p_project_id and pm.user_id=auth.uid())
  ) then
    raise exception 'Você precisa estar integrado ao projeto para editá-lo';
  end if;
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
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para versionar projetos';
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

create or replace function public.add_activity(p_project_id uuid,p_title text,p_assignee_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace uuid:=public.project_workspace_id(p_project_id); v_activity uuid; v_user uuid; v_project_name text;
begin
  if not public.is_workspace_member(v_workspace) or not public.is_workspace_admin(v_workspace) then
    raise exception 'Apenas administradores podem criar atividades';
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
  if not public.is_workspace_member(v_workspace) or not public.is_workspace_admin(v_workspace) then
    raise exception 'Apenas administradores podem excluir atividades';
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
  if not public.is_workspace_member(v_workspace) or not public.is_workspace_admin(v_workspace) then
    raise exception 'Apenas administradores podem criar subatividades';
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

create or replace function public.send_topic_to_activity(p_topic_id uuid,p_project_id uuid,p_developer_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.support_topics%rowtype; v_workspace uuid; v_activity uuid; v_recipient uuid; v_project_name text;
begin
  if not public.is_workspace_admin(public.current_workspace_id()) then raise exception 'Apenas administradores podem converter tópicos em atividades'; end if;
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

-- Reafirma que as RPCs continuam acessíveis apenas a usuários autenticados;
-- as próprias funções fazem a autorização por role/projeto.
revoke execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]),
 public.version_project(uuid,text,text,boolean),public.add_activity(uuid,text,uuid[]),
 public.delete_activity(uuid),public.add_subactivity(uuid,uuid,text,numeric,uuid,text),
 public.send_topic_to_activity(uuid,uuid,uuid) from public,anon;
grant execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]),
 public.version_project(uuid,text,text,boolean),public.add_activity(uuid,text,uuid[]),
 public.delete_activity(uuid),public.add_subactivity(uuid,uuid,text,numeric,uuid,text),
 public.send_topic_to_activity(uuid,uuid,uuid) to authenticated;

commit;
