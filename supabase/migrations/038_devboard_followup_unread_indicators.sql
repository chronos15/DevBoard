begin;

-- 038 · Indicadores de não lido do Acompanhamento
-- Eventos normais são consolidados por usuário/subatividade para não poluir a
-- central de notificações. Menções continuam usando followup-mention e têm
-- prioridade visual no cliente.

create index if not exists notifications_followup_unread_idx
  on public.notifications(recipient_id,project_id,activity_id,subactivity_id,type,read_at,created_at desc);

create or replace function public.upsert_followup_update_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_project_id uuid,
  p_activity_id uuid,
  p_subactivity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.project_workspace_id(p_project_id);
  v_existing uuid;
begin
  if p_recipient_id is null or p_recipient_id = p_actor_id then return; end if;
  if v_workspace is null or not public.is_workspace_member(v_workspace,p_recipient_id) then return; end if;

  select n.id into v_existing
    from public.notifications n
   where n.recipient_id = p_recipient_id
     and n.type = 'followup-update'
     and n.project_id = p_project_id
     and n.subactivity_id is not distinct from p_subactivity_id
     and n.read_at is null
   order by n.created_at desc
   limit 1;

  if v_existing is not null then
    update public.notifications
       set actor_id = p_actor_id,
           title = p_title,
           description = p_description,
           activity_id = p_activity_id,
           created_at = now()
     where id = v_existing;
    return;
  end if;

  insert into public.notifications(
    workspace_id,recipient_id,actor_id,type,title,description,
    project_id,activity_id,subactivity_id
  ) values (
    v_workspace,p_recipient_id,p_actor_id,'followup-update',p_title,p_description,
    p_project_id,p_activity_id,p_subactivity_id
  );
end;
$$;

revoke execute on function public.upsert_followup_update_notification(uuid,uuid,text,text,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.notify_followup_subactivity_participants(
  p_subactivity_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text default null,
  p_excluded_user_ids uuid[] default '{}'::uuid[],
  p_exclude_assignee boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_activity uuid;
  v_workspace uuid;
  v_assignee uuid;
  v_recipient uuid;
begin
  select a.project_id,s.activity_id,p.workspace_id,s.assignee_id
    into v_project,v_activity,v_workspace,v_assignee
    from public.subactivities s
    join public.activities a on a.id=s.activity_id
    join public.projects p on p.id=a.project_id
   where s.id=p_subactivity_id;

  if v_project is null then return; end if;

  for v_recipient in
    select distinct candidate.user_id
      from (
        select sm.user_id
          from public.subactivity_members sm
         where sm.subactivity_id=p_subactivity_id
        union all
        select v_assignee
        union all
        select wm.user_id
          from public.workspace_members wm
         where wm.workspace_id=v_workspace
           and wm.active=true
           and wm.role='admin'::public.workspace_role
      ) candidate
     where candidate.user_id is not null
       and candidate.user_id is distinct from p_actor_id
       and not (candidate.user_id = any(coalesce(p_excluded_user_ids,'{}'::uuid[])))
       and (not p_exclude_assignee or candidate.user_id is distinct from v_assignee)
  loop
    perform public.upsert_followup_update_notification(
      v_recipient,p_actor_id,p_title,p_description,
      v_project,v_activity,p_subactivity_id
    );
  end loop;
end;
$$;

revoke execute on function public.notify_followup_subactivity_participants(uuid,uuid,text,text,uuid[],boolean) from public,anon,authenticated;

create or replace function public.followup_comment_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_excluded uuid[] := '{}'::uuid[];
  v_sub_title text;
begin
  select s.title into v_sub_title from public.subactivities s where s.id=new.subactivity_id;

  select coalesce(array_agg(distinct (m.value->>'id')::uuid),'{}'::uuid[])
    into v_excluded
    from jsonb_array_elements(coalesce(new.mentions,'[]'::jsonb)) m(value)
   where m.value->>'kind'='user'
     and (m.value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  -- O responsável pode receber subactivity-comment pelo RPC atual, mas também
  -- recebe o marcador silencioso: preferências de notificação não devem
  -- desativar o estado de não lido. Mencionados recebem followup-mention.
  perform public.notify_followup_subactivity_participants(
    new.subactivity_id,
    new.author_id,
    'Nova mensagem no acompanhamento',
    format('“%s” · %s',coalesce(v_sub_title,'Subatividade'),left(regexp_replace(new.content,'[[:space:]]+',' ','g'),180)),
    v_excluded,
    false
  );
  return new;
end;
$$;

drop trigger if exists followup_comment_unread on public.subactivity_comments;
create trigger followup_comment_unread
  after insert on public.subactivity_comments
  for each row execute function public.followup_comment_unread_trigger();

create or replace function public.followup_comment_delete_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub_title text;
begin
  select s.title into v_sub_title from public.subactivities s where s.id=old.subactivity_id;
  perform public.notify_followup_subactivity_participants(
    old.subactivity_id,
    auth.uid(),
    'Mensagem removida do acompanhamento',
    format('Uma mensagem foi removida de “%s”.',coalesce(v_sub_title,'Subatividade'))
  );
  return old;
end;
$$;

drop trigger if exists followup_comment_delete_unread on public.subactivity_comments;
create trigger followup_comment_delete_unread
  after delete on public.subactivity_comments
  for each row execute function public.followup_comment_delete_unread_trigger();

create or replace function public.followup_attachment_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub_title text;
begin
  if new.subactivity_id is null then return new; end if;
  select s.title into v_sub_title from public.subactivities s where s.id=new.subactivity_id;
  perform public.notify_followup_subactivity_participants(
    new.subactivity_id,
    new.uploaded_by,
    'Novo anexo no acompanhamento',
    format('“%s” · %s',coalesce(v_sub_title,'Subatividade'),new.name)
  );
  return new;
end;
$$;

drop trigger if exists followup_attachment_unread on public.attachments;
create trigger followup_attachment_unread
  after insert on public.attachments
  for each row when (new.subactivity_id is not null)
  execute function public.followup_attachment_unread_trigger();

create or replace function public.followup_attachment_delete_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sub_title text;
begin
  if old.subactivity_id is null then return old; end if;
  select s.title into v_sub_title from public.subactivities s where s.id=old.subactivity_id;
  perform public.notify_followup_subactivity_participants(
    old.subactivity_id,
    auth.uid(),
    'Anexo removido do acompanhamento',
    format('“%s” · %s',coalesce(v_sub_title,'Subatividade'),old.name)
  );
  return old;
end;
$$;

drop trigger if exists followup_attachment_delete_unread on public.attachments;
create trigger followup_attachment_delete_unread
  after delete on public.attachments
  for each row when (old.subactivity_id is not null)
  execute function public.followup_attachment_delete_unread_trigger();

create or replace function public.followup_subactivity_update_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_description text;
begin
  if new.title is not distinct from old.title
     and new.status is not distinct from old.status
     and new.assignee_id is not distinct from old.assignee_id
     and new.estimated_hours is not distinct from old.estimated_hours then
    return new;
  end if;

  if new.status is distinct from old.status then
    v_description := format('“%s” mudou de %s para %s.',new.title,old.status::text,new.status::text);
  elsif new.title is distinct from old.title then
    v_description := format('“%s” agora se chama “%s”.',old.title,new.title);
  elsif new.assignee_id is distinct from old.assignee_id then
    v_description := format('O responsável por “%s” foi alterado.',new.title);
  else
    v_description := format('A estimativa de “%s” foi alterada.',new.title);
  end if;

  perform public.notify_followup_subactivity_participants(
    new.id,
    auth.uid(),
    'Subatividade atualizada',
    v_description
  );
  return new;
end;
$$;

drop trigger if exists followup_subactivity_update_unread on public.subactivities;
create trigger followup_subactivity_update_unread
  after update on public.subactivities
  for each row execute function public.followup_subactivity_update_unread_trigger();

create or replace function public.followup_member_unread_cleanup_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.notifications n
   where n.recipient_id=old.user_id
     and n.subactivity_id=old.subactivity_id
     and n.type in ('followup-update','followup-mention','followup-subactivity-opened','subactivity-comment','subactivity-assigned');
  return old;
end;
$$;

drop trigger if exists followup_member_unread_cleanup on public.subactivity_members;
create trigger followup_member_unread_cleanup
  after delete on public.subactivity_members
  for each row execute function public.followup_member_unread_cleanup_trigger();

create or replace function public.followup_subactivity_opened_admin_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_project_name text;
  v_activity_title text;
  v_admin uuid;
begin
  select a.project_id,p.workspace_id,p.name,a.title
    into v_project,v_workspace,v_project_name,v_activity_title
    from public.activities a
    join public.projects p on p.id=a.project_id
   where a.id=new.activity_id;

  for v_admin in
    select wm.user_id
      from public.workspace_members wm
     where wm.workspace_id=v_workspace
       and wm.active=true
       and wm.role='admin'::public.workspace_role
       and wm.user_id is distinct from new.created_by
  loop
    perform public.push_notification(
      v_admin,
      new.created_by,
      'followup-subactivity-opened',
      'Nova subatividade aberta',
      format('%s · %s · %s',coalesce(v_project_name,'Projeto'),coalesce(v_activity_title,'Atividade'),new.title),
      v_project,
      new.activity_id,
      new.id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists followup_subactivity_opened_admin on public.subactivities;
create trigger followup_subactivity_opened_admin
  after insert on public.subactivities
  for each row execute function public.followup_subactivity_opened_admin_trigger();

commit;
