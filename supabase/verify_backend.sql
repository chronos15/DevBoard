-- Devboard — verificação do backend Supabase
-- Verificação estrutural pós-migration. Pode ser executada no SQL Editor.

do $$
declare
  v_table text;
  v_function text;
  v_missing text[] := '{}';
  v_tables text[] := array[
    'workspaces','profiles','workspace_members','user_preferences','projects','project_members',
    'activities','activity_assignees','subactivities','work_sessions','project_comments','subactivity_comments',
    'attachments','project_logs','project_versions','notifications','chat_conversations','chat_members',
    'chat_messages','meetings','meeting_members'
  ];
  v_functions text[] := array[
    'public.update_my_profile(text,text)',
    'public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text)',
    'public.set_workspace_member_role(uuid,text)',
    'public.create_project(text,text,text,text,text,date,text,uuid[])',
    'public.update_project(uuid,text,text,text,text,text,date,text,uuid[])',
    'public.version_project(uuid,text,text,boolean)',
    'public.add_activity(uuid,text,uuid[])',
    'public.delete_activity(uuid)',
    'public.add_subactivity(uuid,uuid,text,numeric,uuid,text)',
    'public.start_subactivity(uuid)',
    'public.pause_subactivity(uuid)',
    'public.set_subactivity_status(uuid,text)',
    'public.add_project_comment(uuid,text)',
    'public.add_subactivity_comment(uuid,text)',
    'public.add_attachment(uuid,uuid,text,text,bigint,text,text,text)',
    'public.set_attachment_active(uuid,boolean)',
    'public.ensure_direct_conversation(uuid)',
    'public.send_chat_message(uuid,text)',
    'public.create_chat_group(text,uuid[])',
    'public.update_chat_group(uuid,text,uuid[])',
    'public.delete_chat_group(uuid)',
    'public.create_meeting(text,uuid[],text,uuid)',
    'public.answer_meeting_invite(uuid,boolean)',
    'public.join_meeting(uuid)',
    'public.heartbeat_meeting(uuid)',
    'public.leave_meeting(uuid)',
    'public.end_meeting(uuid)'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      v_missing := array_append(v_missing, 'table public.' || v_table);
    end if;
  end loop;

  foreach v_function in array v_functions loop
    if to_regprocedure(v_function) is null then
      v_missing := array_append(v_missing, 'function ' || v_function);
    elsif not has_function_privilege('authenticated', v_function, 'EXECUTE') then
      v_missing := array_append(v_missing, 'EXECUTE authenticated em ' || v_function);
    end if;
  end loop;

  if not exists(select 1 from storage.buckets where id='cadence-attachments' and public=false) then
    v_missing := array_append(v_missing, 'private bucket cadence-attachments');
  end if;
  if not exists(select 1 from storage.buckets where id='cadence-avatars' and public=true) then
    v_missing := array_append(v_missing, 'public bucket cadence-avatars');
  end if;

  if not exists(select 1 from pg_trigger where tgname='on_auth_user_created' and not tgisinternal) then
    v_missing := array_append(v_missing, 'trigger on_auth_user_created');
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname = any(v_tables)
      and not c.relrowsecurity
  ) then
    v_missing := array_append(v_missing, 'RLS habilitado em todas as tabelas Devboard');
  end if;

  if has_table_privilege('authenticated','public.projects','INSERT')
     or has_table_privilege('authenticated','public.projects','UPDATE')
     or has_table_privilege('authenticated','public.projects','DELETE')
     or has_table_privilege('authenticated','public.subactivities','INSERT')
     or has_table_privilege('authenticated','public.subactivities','UPDATE')
     or has_table_privilege('authenticated','public.subactivities','DELETE') then
    v_missing := array_append(v_missing, 'bloqueio de escrita direta nas tabelas críticas');
  end if;

  if not has_column_privilege('authenticated','public.notifications','read_at','UPDATE') then
    v_missing := array_append(v_missing, 'UPDATE restrito de notifications.read_at');
  end if;

  if has_function_privilege('authenticated','public.add_project_log(uuid,text,text,text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.push_notification(uuid,uuid,text,text,text,uuid,uuid,uuid)','EXECUTE') then
    v_missing := array_append(v_missing, 'RPCs internas sem EXECUTE para authenticated');
  end if;

  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='subactivities_one_running_per_user_uidx') then
    v_missing := array_append(v_missing, 'unique running-subactivity index');
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='work_sessions_one_open_per_user_uidx') then
    v_missing := array_append(v_missing, 'unique open-work-session index');
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='chat_conversations_direct_key_uidx') then
    v_missing := array_append(v_missing, 'unique direct-conversation index');
  end if;

  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='meetings_one_active_per_conversation_uidx') then
    v_missing := array_append(v_missing, 'unique active-meeting-per-conversation index');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications' and column_name='meeting_id'
  ) then
    v_missing := array_append(v_missing, 'notifications.meeting_id');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='meeting_members' and column_name='status'
  ) then
    v_missing := array_append(v_missing, 'meeting_members.status');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='meeting_members_status_check'
      and conrelid='public.meeting_members'::regclass
  ) then
    v_missing := array_append(v_missing, 'meeting_members status constraint');
  end if;

  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='cadence_meeting_realtime_select') then
    v_missing := array_append(v_missing, 'realtime meeting SELECT policy');
  end if;
  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='cadence_meeting_realtime_insert') then
    v_missing := array_append(v_missing, 'realtime meeting INSERT policy');
  end if;

  foreach v_table in array array[
    'profiles','workspace_members','user_preferences','projects','project_members','activities','activity_assignees',
    'subactivities','work_sessions','project_comments','subactivity_comments','attachments','project_logs','project_versions',
    'notifications','chat_conversations','chat_members','chat_messages','meetings','meeting_members'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then
      v_missing := array_append(v_missing, 'realtime publication public.' || v_table);
    end if;
  end loop;

  if array_length(v_missing,1) is not null then
    raise exception 'Backend Devboard incompleto: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'Devboard backend OK: 21 tabelas, RPCs críticas, Storage, Auth trigger, índices e Realtime verificados.';
end $$;

-- Resumo visual adicional
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name in (
    'workspaces','profiles','workspace_members','user_preferences','projects','project_members','activities','activity_assignees',
    'subactivities','work_sessions','project_comments','subactivity_comments','attachments','project_logs','project_versions',
    'notifications','chat_conversations','chat_members','chat_messages','meetings','meeting_members'
  )) as devboard_tables,
  (select count(*) from pg_policies where schemaname='public' and policyname like 'cadence_%') as public_rls_policies,
  (select count(*) from storage.buckets where id in ('cadence-attachments','cadence-avatars')) as devboard_buckets;

-- 003 · Chat com áudio
select
  to_regclass('public.chat_messages') is not null as chat_messages_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='message_type') as chat_message_type_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='media_path') as chat_media_path_ok,
  to_regprocedure('public.send_chat_audio_message(uuid,text,text,integer,bigint)') is not null as send_chat_audio_rpc_ok,
  exists(select 1 from storage.buckets where id='devboard-chat-media' and public=false) as chat_audio_bucket_ok;
