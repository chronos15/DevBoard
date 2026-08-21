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
    'chat_messages','meetings','meeting_members','aqs_reviews','support_topics','topic_attachments',
    'developer_settings','developer_notes','developer_water_logs','developer_ides','developer_local_projects'
  ];
  v_functions text[] := array[
    'public.update_my_profile(text,text,text,boolean)',
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
    'public.send_chat_message(uuid,text,jsonb)',
    'public.send_chat_message(uuid,text,jsonb,uuid)',
    'public.create_chat_group(text,uuid[])',
    'public.update_chat_group(uuid,text,uuid[])',
    'public.delete_chat_group(uuid)',
    'public.delete_direct_conversation(uuid)',
    'public.leave_chat_group(uuid)',
    'public.create_meeting(text,uuid[],text,uuid)',
    'public.answer_meeting_invite(uuid,boolean)',
    'public.join_meeting(uuid)',
    'public.heartbeat_meeting(uuid)',
    'public.leave_meeting(uuid)',
    'public.end_meeting(uuid)',
    'public.start_aqs_review(uuid)',
    'public.complete_aqs_review(uuid)',
    'public.revoke_aqs_review(uuid,text)',
    'public.create_support_topic(text,text,text)',
    'public.add_topic_attachment(uuid,text,text,bigint,text,text)',
    'public.start_topic_analysis(uuid)',
    'public.revoke_support_topic(uuid,text)',
    'public.send_topic_to_activity(uuid,uuid,uuid)',
    'public.can_access_presence_realtime(text,uuid)'
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
  if not exists(select 1 from storage.buckets where id='devboard-chat-media' and public=false) then
    v_missing := array_append(v_missing, 'private bucket devboard-chat-media');
  end if;
  if not exists(select 1 from storage.buckets where id='devboard-topic-media' and public=false and file_size_limit=52428800) then
    v_missing := array_append(v_missing, 'private bucket devboard-topic-media (50 MB)');
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

  if not exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='workspace_role' and e.enumlabel='developer') then
    v_missing := array_append(v_missing, 'workspace_role developer');
  end if;
  if not exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='workspace_role' and e.enumlabel='aqs') then
    v_missing := array_append(v_missing, 'workspace_role aqs');
  end if;
  if not exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='workspace_role' and e.enumlabel='support') then
    v_missing := array_append(v_missing, 'workspace_role support');
  end if;
  if not exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='subactivity_status' and e.enumlabel='waiting-aqs') then
    v_missing := array_append(v_missing, 'subactivity_status waiting-aqs');
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='subactivities' and column_name='needs_attention') then
    v_missing := array_append(v_missing, 'subactivities.needs_attention');
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='subactivities' and column_name='attention_message') then
    v_missing := array_append(v_missing, 'subactivities.attention_message');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='aqs_reviews' and policyname='devboard_aqs_reviews_select') then
    v_missing := array_append(v_missing, 'RLS policy devboard_aqs_reviews_select');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_topics' and policyname='devboard_support_topics_select') then
    v_missing := array_append(v_missing, 'RLS policy devboard_support_topics_select');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='topic_attachments' and policyname='devboard_topic_attachments_select') then
    v_missing := array_append(v_missing, 'RLS policy devboard_topic_attachments_select');
  end if;

  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='cadence_meeting_realtime_select') then
    v_missing := array_append(v_missing, 'realtime meeting SELECT policy');
  end if;
  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='cadence_meeting_realtime_insert') then
    v_missing := array_append(v_missing, 'realtime meeting INSERT policy');
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_settings' and policyname='devboard_developer_settings_select') then
    v_missing := array_append(v_missing, 'RLS policy devboard_developer_settings_select');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_notes' and policyname='devboard_developer_notes_all') then
    v_missing := array_append(v_missing, 'RLS policy devboard_developer_notes_all');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_water_logs' and policyname='devboard_developer_water_logs_all') then
    v_missing := array_append(v_missing, 'RLS policy devboard_developer_water_logs_all');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_ides' and policyname='devboard_developer_ides_all') then
    v_missing := array_append(v_missing, 'RLS policy devboard_developer_ides_all');
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_local_projects' and policyname='devboard_developer_local_projects_all') then
    v_missing := array_append(v_missing, 'RLS policy devboard_developer_local_projects_all');
  end if;

  foreach v_table in array array[
    'profiles','workspace_members','user_preferences','projects','project_members','activities','activity_assignees',
    'subactivities','work_sessions','project_comments','subactivity_comments','attachments','project_logs','project_versions',
    'notifications','chat_conversations','chat_members','chat_messages','meetings','meeting_members',
    'aqs_reviews','support_topics','topic_attachments','developer_settings','developer_notes','developer_water_logs','developer_ides','developer_local_projects'
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

  raise notice 'Devboard backend OK: 27 tabelas, roles, AQS, Tópicos, Painel Dev, RPCs críticas, Storage, Auth trigger, índices e Realtime verificados.';
end $$;

-- Resumo visual adicional
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name in (
    'workspaces','profiles','workspace_members','user_preferences','projects','project_members','activities','activity_assignees',
    'subactivities','work_sessions','project_comments','subactivity_comments','attachments','project_logs','project_versions',
    'notifications','chat_conversations','chat_members','chat_messages','meetings','meeting_members',
    'aqs_reviews','support_topics','topic_attachments','developer_settings','developer_notes','developer_water_logs','developer_ides','developer_local_projects'
  )) as devboard_tables,
  (select count(*) from pg_policies where schemaname='public' and (policyname like 'cadence_%' or policyname like 'devboard_%')) as public_rls_policies,
  (select count(*) from storage.buckets where id in ('cadence-attachments','cadence-avatars','devboard-chat-media','devboard-topic-media')) as devboard_buckets;

-- 003 · Chat com áudio
select
  to_regclass('public.chat_messages') is not null as chat_messages_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='message_type') as chat_message_type_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='media_path') as chat_media_path_ok,
  to_regprocedure('public.send_chat_audio_message(uuid,text,text,integer,bigint)') is not null as send_chat_audio_rpc_ok,
  exists(select 1 from storage.buckets where id='devboard-chat-media' and public=false) as chat_audio_bucket_ok;

-- 004 · Chat com mídias e anexos
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='media_name') as chat_media_name_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='media_kind') as chat_media_kind_ok,
  to_regprocedure('public.send_chat_media_message(uuid,text,text,text,bigint,text,text)') is not null as send_chat_media_rpc_ok,
  has_function_privilege('authenticated','public.send_chat_media_message(uuid,text,text,text,bigint,text,text)','EXECUTE') as send_chat_media_execute_ok,
  exists(select 1 from storage.buckets where id='devboard-chat-media' and public=false and file_size_limit=52428800) as chat_media_bucket_50mb_ok;


-- 005 · Roles avançadas, AQS e Tópicos
select
  (select array_agg(e.enumlabel order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='workspace_role') as workspace_roles,
  exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='subactivity_status' and e.enumlabel='waiting-aqs') as waiting_aqs_status_ok,
  to_regclass('public.aqs_reviews') is not null as aqs_reviews_ok,
  to_regclass('public.support_topics') is not null as support_topics_ok,
  to_regclass('public.topic_attachments') is not null as topic_attachments_ok,
  to_regprocedure('public.start_aqs_review(uuid)') is not null as start_aqs_review_ok,
  to_regprocedure('public.complete_aqs_review(uuid)') is not null as complete_aqs_review_ok,
  to_regprocedure('public.revoke_aqs_review(uuid,text)') is not null as revoke_aqs_review_ok,
  to_regprocedure('public.send_topic_to_activity(uuid,uuid,uuid)') is not null as send_topic_to_activity_ok,
  exists(select 1 from storage.buckets where id='devboard-topic-media' and public=false) as topic_media_bucket_ok;

-- 008 · Links diretos + menções persistentes no Chat
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='mentions') as chat_mentions_column_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='conversation_id') as notification_conversation_id_ok,
  to_regprocedure('public.send_chat_message(uuid,text,jsonb)') is not null as send_chat_message_mentions_rpc_ok,
  has_function_privilege('authenticated','public.send_chat_message(uuid,text,jsonb)','EXECUTE') as send_chat_message_mentions_execute_ok;

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='mentions') then
    raise exception 'Backend Devboard incompleto: chat_messages.mentions ausente (migration 008)';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='conversation_id') then
    raise exception 'Backend Devboard incompleto: notifications.conversation_id ausente (migration 008)';
  end if;
  if to_regprocedure('public.send_chat_message(uuid,text,jsonb)') is null then
    raise exception 'Backend Devboard incompleto: send_chat_message(uuid,text,jsonb) ausente (migration 008)';
  end if;
  raise notice 'Migration 008 OK: links diretos client-side e menções persistentes do Chat prontas.';
end $$;

-- 009 · Histórico paginado + exclusão/saída segura do Chat
select
  exists(
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='chat_messages'
      and indexname='chat_messages_conversation_created_desc_idx'
  ) as chat_history_index_ok,
  to_regprocedure('public.delete_direct_conversation(uuid)') is not null as delete_direct_conversation_rpc_ok,
  has_function_privilege('authenticated','public.delete_direct_conversation(uuid)','EXECUTE') as delete_direct_conversation_execute_ok,
  to_regprocedure('public.leave_chat_group(uuid)') is not null as leave_chat_group_rpc_ok,
  has_function_privilege('authenticated','public.leave_chat_group(uuid)','EXECUTE') as leave_chat_group_execute_ok,
  exists(
    select 1 from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='devboard_chat_media_conversation_delete'
  ) as chat_media_conversation_delete_policy_ok;

do $$
begin
  if not exists(
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='chat_messages'
      and indexname='chat_messages_conversation_created_desc_idx'
  ) then
    raise exception 'Backend Devboard incompleto: índice do histórico ausente (migration 009)';
  end if;
  if to_regprocedure('public.delete_direct_conversation(uuid)') is null then
    raise exception 'Backend Devboard incompleto: delete_direct_conversation(uuid) ausente (migration 009)';
  end if;
  if to_regprocedure('public.leave_chat_group(uuid)') is null then
    raise exception 'Backend Devboard incompleto: leave_chat_group(uuid) ausente (migration 009)';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='devboard_chat_media_conversation_delete'
  ) then
    raise exception 'Backend Devboard incompleto: policy de exclusão de mídia do Chat ausente (migration 009)';
  end if;
  raise notice 'Migration 009 OK: histórico paginado e ações de conversa prontas.';
end $$;


-- 010 · Remoção local de conversas individuais
select
  exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='chat_members'
      and column_name='hidden_at'
  ) as chat_members_hidden_at_ok,
  to_regprocedure('public.is_conversation_visible(uuid,uuid)') is not null as conversation_visibility_rpc_ok,
  exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='chat_messages'
      and t.tgname='chat_messages_reveal_direct_conversation'
      and not t.tgisinternal
  ) as direct_chat_reveal_trigger_ok;

do $$
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='chat_members'
      and column_name='hidden_at'
  ) then
    raise exception 'Backend Devboard incompleto: chat_members.hidden_at ausente (migration 010)';
  end if;
  if to_regprocedure('public.is_conversation_visible(uuid,uuid)') is null then
    raise exception 'Backend Devboard incompleto: is_conversation_visible(uuid,uuid) ausente (migration 010)';
  end if;
  if not exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='chat_messages'
      and t.tgname='chat_messages_reveal_direct_conversation'
      and not t.tgisinternal
  ) then
    raise exception 'Backend Devboard incompleto: trigger de reexibição do chat ausente (migration 010)';
  end if;
  raise notice 'Migration 010 OK: exclusão individual é local e novas mensagens reexibem a conversa.';
end $$;


-- 011 · Corte individual do histórico em chats diretos
select
  exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='chat_members'
      and column_name='cleared_at'
  ) as chat_members_cleared_at_ok,
  to_regprocedure('public.can_read_chat_message(uuid,timestamptz)') is not null as chat_message_visibility_rpc_ok,
  has_function_privilege('authenticated','public.can_read_chat_message(uuid,timestamptz)','EXECUTE') as chat_message_visibility_execute_ok,
  exists(
    select 1 from pg_policies
    where schemaname='public'
      and tablename='chat_messages'
      and policyname='cadence_chat_messages_select'
      and qual like '%can_read_chat_message%'
  ) as chat_message_cutoff_policy_ok;

do $$
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='chat_members'
      and column_name='cleared_at'
  ) then
    raise exception 'Backend Devboard incompleto: chat_members.cleared_at ausente (migration 011)';
  end if;
  if to_regprocedure('public.can_read_chat_message(uuid,timestamptz)') is null then
    raise exception 'Backend Devboard incompleto: can_read_chat_message(uuid,timestamptz) ausente (migration 011)';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='public'
      and tablename='chat_messages'
      and policyname='cadence_chat_messages_select'
      and qual like '%can_read_chat_message%'
  ) then
    raise exception 'Backend Devboard incompleto: policy de corte individual do histórico ausente (migration 011)';
  end if;
  raise notice 'Migration 011 OK: histórico direto respeita o corte individual de cada participante.';
end $$;

-- 012 · Respostas a mensagens no Chat
select
  exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='chat_messages'
      and column_name='reply_to_message_id'
  ) as chat_reply_column_ok,
  to_regprocedure('public.send_chat_message(uuid,text,jsonb,uuid)') is not null as send_chat_message_reply_rpc_ok,
  has_function_privilege('authenticated','public.send_chat_message(uuid,text,jsonb,uuid)','EXECUTE') as send_chat_message_reply_execute_ok,
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='chat_messages'
      and indexname='chat_messages_reply_to_idx'
  ) as chat_reply_index_ok;

do $$
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='chat_messages'
      and column_name='reply_to_message_id'
  ) then
    raise exception 'Backend Devboard incompleto: chat_messages.reply_to_message_id ausente (migration 012)';
  end if;
  if to_regprocedure('public.send_chat_message(uuid,text,jsonb,uuid)') is null then
    raise exception 'Backend Devboard incompleto: send_chat_message(uuid,text,jsonb,uuid) ausente (migration 012)';
  end if;
  if not has_function_privilege('authenticated','public.send_chat_message(uuid,text,jsonb,uuid)','EXECUTE') then
    raise exception 'Backend Devboard incompleto: authenticated sem EXECUTE em send_chat_message de reply (migration 012)';
  end if;
  raise notice 'Migration 012 OK: respostas a mensagens do Chat prontas.';
end $$;

-- 013 · Presença online do Chat via Supabase Realtime Presence
select
  to_regprocedure('public.safe_topic_presence_workspace_id(text)') is not null as presence_topic_parser_ok,
  to_regprocedure('public.can_access_presence_realtime(text,uuid)') is not null as presence_access_helper_ok,
  has_function_privilege('authenticated','public.can_access_presence_realtime(text,uuid)','EXECUTE') as presence_access_execute_ok,
  exists(
    select 1 from pg_policies
    where schemaname='realtime'
      and tablename='messages'
      and policyname='devboard_presence_realtime_select'
  ) as presence_select_policy_ok,
  exists(
    select 1 from pg_policies
    where schemaname='realtime'
      and tablename='messages'
      and policyname='devboard_presence_realtime_insert'
  ) as presence_insert_policy_ok;

do $$
begin
  if to_regprocedure('public.safe_topic_presence_workspace_id(text)') is null then
    raise exception 'Backend Devboard incompleto: parser do tópico de Presence ausente (migration 013)';
  end if;
  if to_regprocedure('public.can_access_presence_realtime(text,uuid)') is null then
    raise exception 'Backend Devboard incompleto: helper de autorização de Presence ausente (migration 013)';
  end if;
  if not has_function_privilege('authenticated','public.can_access_presence_realtime(text,uuid)','EXECUTE') then
    raise exception 'Backend Devboard incompleto: authenticated sem EXECUTE no helper de Presence (migration 013)';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='realtime'
      and tablename='messages'
      and policyname='devboard_presence_realtime_select'
  ) then
    raise exception 'Backend Devboard incompleto: policy SELECT de Presence ausente (migration 013)';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='realtime'
      and tablename='messages'
      and policyname='devboard_presence_realtime_insert'
  ) then
    raise exception 'Backend Devboard incompleto: policy INSERT de Presence ausente (migration 013)';
  end if;
  raise notice 'Migration 013 OK: Presence privado do Chat autorizado por workspace.';
end $$;



-- 015 · Painel pessoal do Desenvolvedor
select
  to_regclass('public.developer_settings') is not null as developer_settings_ok,
  to_regclass('public.developer_notes') is not null as developer_notes_ok,
  to_regclass('public.developer_water_logs') is not null as developer_water_logs_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_settings' and policyname='devboard_developer_settings_select') as developer_settings_rls_ok,
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='developer_notes') as developer_notes_realtime_ok;


-- 016 · Múltiplas IDEs e projetos locais do Painel Dev
select
  to_regclass('public.developer_ides') is not null as developer_ides_ok,
  to_regclass('public.developer_local_projects') is not null as developer_local_projects_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_ides' and policyname='devboard_developer_ides_all') as developer_ides_rls_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_local_projects' and policyname='devboard_developer_local_projects_all') as developer_local_projects_rls_ok,
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='developer_ides') as developer_ides_realtime_ok,
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='developer_local_projects') as developer_local_projects_realtime_ok;


-- 017 · Cockpit, automações e contextos pessoais do Painel Dev
select
  to_regclass('public.developer_contexts') is not null as developer_contexts_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_settings' and column_name='auto_focus_on_timer') as developer_auto_focus_setting_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_settings' and column_name='forgotten_timer_minutes') as developer_forgotten_timer_setting_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_contexts' and policyname='devboard_developer_contexts_all') as developer_contexts_rls_ok,
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='developer_contexts') as developer_contexts_realtime_ok;

do $$
begin
  if to_regclass('public.developer_contexts') is null then
    raise exception 'Backend Devboard incompleto: developer_contexts ausente (migration 017)';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_settings' and column_name='auto_focus_on_timer') then
    raise exception 'Backend Devboard incompleto: automações do Painel Dev ausentes (migration 017)';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_contexts' and policyname='devboard_developer_contexts_all') then
    raise exception 'Backend Devboard incompleto: RLS de developer_contexts ausente (migration 017)';
  end if;
  raise notice 'Migration 017 OK: cockpit, automações e contextos pessoais do developer prontos.';
end $$;

-- 018 · Devboard Agent para Windows
select
  to_regclass('public.developer_agents') is not null as developer_agents_ok,
  to_regprocedure('public.register_developer_agent()') is not null as register_developer_agent_ok,
  to_regprocedure('public.developer_agent_status()') is not null as developer_agent_status_ok,
  to_regprocedure('public.developer_agent_heartbeat(uuid,text,text,text,text,boolean)') is not null as developer_agent_heartbeat_ok,
  has_function_privilege('authenticated','public.register_developer_agent()','EXECUTE') as register_developer_agent_execute_ok,
  has_function_privilege('anon','public.developer_agent_heartbeat(uuid,text,text,text,text,boolean)','EXECUTE') as heartbeat_anon_execute_ok;

do $$
begin
  if to_regclass('public.developer_agents') is null then
    raise exception 'Backend Devboard incompleto: developer_agents ausente (migration 018)';
  end if;
  if to_regprocedure('public.register_developer_agent()') is null then
    raise exception 'Backend Devboard incompleto: register_developer_agent() ausente (migration 018)';
  end if;
  if to_regprocedure('public.developer_agent_status()') is null then
    raise exception 'Backend Devboard incompleto: developer_agent_status() ausente (migration 018)';
  end if;
  if to_regprocedure('public.developer_agent_heartbeat(uuid,text,text,text,text,boolean)') is null then
    raise exception 'Backend Devboard incompleto: developer_agent_heartbeat(...) ausente (migration 018)';
  end if;
  if not has_function_privilege('anon','public.developer_agent_heartbeat(uuid,text,text,text,text,boolean)','EXECUTE') then
    raise exception 'Backend Devboard incompleto: anon sem EXECUTE no heartbeat do agente (migration 018)';
  end if;
  raise notice 'Migration 018 OK: Devboard Agent para Windows pronto para instalação e heartbeat.';
end $$;

-- 019 · Controle de versão local Git/SVN do Painel Dev
select
  to_regclass('public.developer_vcs_changes') is not null as developer_vcs_changes_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_local_projects' and column_name='devboard_project_id') as developer_local_project_link_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_select')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_insert')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_update')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_delete') as developer_vcs_changes_rls_ok,
  exists(select 1 from pg_indexes where schemaname='public' and tablename='developer_vcs_changes' and indexname='developer_vcs_changes_subactivity_idx') as developer_vcs_changes_subactivity_index_ok,
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='developer_vcs_changes') as developer_vcs_changes_realtime_ok;

do $$
begin
  if to_regclass('public.developer_vcs_changes') is null then
    raise exception 'Backend Devboard incompleto: developer_vcs_changes ausente (migration 019)';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_local_projects' and column_name='devboard_project_id') then
    raise exception 'Backend Devboard incompleto: vínculo developer_local_projects.devboard_project_id ausente (migration 019)';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_select')
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_insert')
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_update')
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_changes' and policyname='devboard_developer_vcs_changes_delete') then
    raise exception 'Backend Devboard incompleto: policies RLS de developer_vcs_changes ausentes (migration 019)';
  end if;
  raise notice 'Migration 019 OK: vínculos de commits/revisões Git/SVN do Painel Dev prontos.';
end $$;

-- 020 · Diagnóstico administrativo de segurança
select
  to_regprocedure('public.devboard_security_health()') is not null as security_health_rpc_ok,
  has_function_privilege('authenticated','public.devboard_security_health()','EXECUTE') as security_health_execute_ok;

do $$
begin
  if to_regprocedure('public.devboard_security_health()') is null then
    raise exception 'Backend Devboard incompleto: devboard_security_health() ausente (migration 020)';
  end if;
  raise notice 'Migration 020 OK: diagnóstico administrativo de segurança disponível.';
end $$;

-- 021 · Baseline de Git/SVN no início da subatividade
select
  to_regclass('public.developer_vcs_task_baselines') is not null as developer_vcs_task_baselines_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_task_baselines' and policyname='devboard_developer_vcs_task_baselines_select') as developer_vcs_task_baselines_rls_ok,
  exists(select 1 from pg_indexes where schemaname='public' and tablename='developer_vcs_task_baselines' and indexname='developer_vcs_task_baselines_subactivity_idx') as developer_vcs_task_baselines_index_ok;

do $$
begin
  if to_regclass('public.developer_vcs_task_baselines') is null then
    raise exception 'Backend Devboard incompleto: developer_vcs_task_baselines ausente (migration 021)';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='developer_vcs_task_baselines' and policyname='devboard_developer_vcs_task_baselines_select') then
    raise exception 'Backend Devboard incompleto: RLS de developer_vcs_task_baselines ausente (migration 021)';
  end if;
  raise notice 'Migration 021 OK: baseline Git/SVN por subatividade disponível.';
end $$;
