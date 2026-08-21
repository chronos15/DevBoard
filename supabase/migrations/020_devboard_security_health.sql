-- Devboard · Migration 020
-- Diagnóstico administrativo de segurança sem expor segredos.
-- O RPC apenas inspeciona metadados do PostgreSQL/Supabase e só responde para admin.

begin;

create or replace function public.devboard_security_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_is_admin boolean := false;
  v_checks jsonb := '[]'::jsonb;
  v_missing_rls integer := 0;
  v_anon_grants integer := 0;
  v_unsafe_definer integer := 0;
  v_storage_policies integer := 0;
  v_realtime_missing integer := 0;
  v_agent_plain_secret integer := 0;
  v_ok integer := 0;
  v_warning integer := 0;
  v_critical integer := 0;
  v_critical_tables text[] := array[
    'workspaces','profiles','workspace_members','user_preferences','projects','project_members',
    'activities','activity_assignees','subactivities','work_sessions','project_comments',
    'subactivity_comments','attachments','project_logs','project_versions','notifications',
    'chat_conversations','chat_members','chat_messages','meetings','meeting_members',
    'aqs_reviews','support_topics','topic_attachments','developer_settings','developer_notes',
    'developer_water_logs','developer_ides','developer_local_projects','developer_contexts',
    'developer_agents','developer_vcs_changes','developer_vcs_task_baselines'
  ];
begin
  select exists(
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.active
      and wm.role = 'admin'
  ) into v_is_admin;

  if auth.uid() is null or not v_is_admin then
    raise exception 'Apenas administradores podem executar o diagnóstico de segurança'
      using errcode = '42501';
  end if;

  select count(*)::integer
    into v_missing_rls
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and c.relname = any(v_critical_tables)
    and not c.relrowsecurity;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','rls',
    'category','Banco',
    'label','RLS nas tabelas críticas',
    'status',case when v_missing_rls = 0 then 'ok' else 'critical' end,
    'detail',case when v_missing_rls = 0 then 'Todas as tabelas críticas encontradas estão com Row Level Security habilitado.' else format('%s tabela(s) crítica(s) estão sem RLS.', v_missing_rls) end
  ));

  select count(*)::integer
    into v_anon_grants
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee = 'anon'
    and g.table_name = any(v_critical_tables)
    and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','anon-grants',
    'category','API',
    'label','Acesso direto do papel anon',
    'status',case when v_anon_grants = 0 then 'ok' else 'critical' end,
    'detail',case when v_anon_grants = 0 then 'Nenhum grant direto do papel anon foi encontrado nas tabelas críticas.' else format('%s grant(s) direto(s) para anon precisam ser revisados.', v_anon_grants) end
  ));

  select count(*)::integer
    into v_unsafe_definer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
    );

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','security-definer',
    'category','RPC',
    'label','search_path dos SECURITY DEFINER',
    'status',case when v_unsafe_definer = 0 then 'ok' else 'warning' end,
    'detail',case when v_unsafe_definer = 0 then 'Todos os SECURITY DEFINER públicos fixam search_path explicitamente.' else format('%s função(ões) SECURITY DEFINER não fixam search_path e devem ser revisadas.', v_unsafe_definer) end
  ));

  select count(*)::integer
    into v_storage_policies
  from pg_catalog.pg_policies
  where schemaname = 'storage'
    and tablename = 'objects';

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','storage-policies',
    'category','Storage',
    'label','Policies de arquivos',
    'status',case when v_storage_policies > 0 then 'ok' else 'warning' end,
    'detail',case when v_storage_policies > 0 then format('%s policy(ies) encontradas em storage.objects.', v_storage_policies) else 'Nenhuma policy foi encontrada em storage.objects. Revise o acesso aos buckets.' end
  ));

  if exists(select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    select count(*)::integer
      into v_realtime_missing
    from unnest(array['chat_messages','notifications','developer_vcs_changes']::text[]) required_table
    where not exists (
      select 1
      from pg_catalog.pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = required_table
    );
  else
    v_realtime_missing := 3;
  end if;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','realtime',
    'category','Realtime',
    'label','Publicação de eventos essenciais',
    'status',case when v_realtime_missing = 0 then 'ok' else 'warning' end,
    'detail',case when v_realtime_missing = 0 then 'Chat, notificações e vínculos de código estão publicados no Realtime.' else format('%s publicação(ões) essenciais não foram encontradas.', v_realtime_missing) end
  ));

  if to_regclass('public.developer_agents') is not null then
    select count(*)::integer
      into v_agent_plain_secret
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'developer_agents'
      and column_name in ('agent_secret','secret','token','api_key');
  end if;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id','agent-secrets',
    'category','Agent',
    'label','Segredos do Agent',
    'status',case when v_agent_plain_secret = 0 then 'ok' else 'critical' end,
    'detail',case when v_agent_plain_secret = 0 then 'A tabela do Agent mantém somente hash do segredo; o segredo bruto não fica armazenado.' else 'Foi encontrada coluna com nome de segredo/token no cadastro de agentes. Revise imediatamente.' end
  ));

  select
    count(*) filter (where item->>'status' = 'ok')::integer,
    count(*) filter (where item->>'status' = 'warning')::integer,
    count(*) filter (where item->>'status' = 'critical')::integer
  into v_ok, v_warning, v_critical
  from jsonb_array_elements(v_checks) item;

  return jsonb_build_object(
    'checked_at', now(),
    'summary', jsonb_build_object('ok',v_ok,'warning',v_warning,'critical',v_critical),
    'checks', v_checks
  );
end;
$$;

revoke all on function public.devboard_security_health() from public, anon, authenticated;
grant execute on function public.devboard_security_health() to authenticated;

commit;
