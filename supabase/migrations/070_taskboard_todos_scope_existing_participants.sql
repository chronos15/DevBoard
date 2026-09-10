-- TaskBoard V81 · @todos/@here sem associação automática
-- Execute após 069_taskboard_context_meeting_logs_and_group_mentions.sql.
--
-- Objetivo:
--   * @todos notifica apenas pessoas que JÁ fazem parte do contexto/tópico.
--   * @todos e @here são broadcasts e nunca adicionam novos participantes.
--   * menção individual, @desenvolvedores, @aqs e @admin mantêm a semântica
--     existente de associação ao contexto quando permitido.
--   * nenhuma tabela/coluna é criada ou alterada.

begin;

create or replace function public.taskboard_filter_subactivity_broadcast_mentions(
  p_subactivity_id uuid,
  p_mentions jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_user uuid;
  v_label text;
begin
  if jsonb_typeof(coalesce(p_mentions,'[]'::jsonb)) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_mentions,'[]'::jsonb))
  loop
    if coalesce(v_item->>'kind','') <> 'user' then
      v_result := v_result || jsonb_build_array(v_item);
      continue;
    end if;

    v_label := lower(btrim(coalesce(v_item->>'label','')));
    if v_label <> 'todos' then
      -- @here já chega resolvido pelo Presence do contexto no cliente. Ele é
      -- tratado como broadcast no envio (sem associação), mas não é reduzido
      -- aqui porque presença é estado efêmero e não existe no SQL.
      v_result := v_result || jsonb_build_array(v_item);
      continue;
    end if;

    begin
      v_user := nullif(v_item->>'id','')::uuid;
    exception when others then
      continue;
    end;

    -- @todos só alcança quem já pertence ao tópico da subatividade/AQS.
    if exists(
      select 1
      from public.subactivities s
      where s.id=p_subactivity_id
        and s.assignee_id=v_user
    ) or exists(
      select 1
      from public.subactivity_members sm
      where sm.subactivity_id=p_subactivity_id
        and sm.user_id=v_user
    ) or exists(
      select 1
      from public.aqs_reviews ar
      where ar.subactivity_id=p_subactivity_id
        and (
          ar.assigned_aqs_id=v_user
          or exists(
            select 1 from public.aqs_review_participants arp
            where arp.review_id=ar.id and arp.user_id=v_user
          )
        )
    ) then
      v_result := v_result || jsonb_build_array(v_item);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke execute on function public.taskboard_filter_subactivity_broadcast_mentions(uuid,jsonb) from public,anon;
grant execute on function public.taskboard_filter_subactivity_broadcast_mentions(uuid,jsonb) to authenticated;

create or replace function public.taskboard_filter_request_broadcast_mentions(
  p_request_id uuid,
  p_mentions jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_user uuid;
  v_label text;
begin
  if jsonb_typeof(coalesce(p_mentions,'[]'::jsonb)) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_mentions,'[]'::jsonb))
  loop
    if coalesce(v_item->>'kind','') <> 'user' then
      v_result := v_result || jsonb_build_array(v_item);
      continue;
    end if;

    v_label := lower(btrim(coalesce(v_item->>'label','')));
    if v_label <> 'todos' then
      -- @here já chega resolvido pelo Presence do contexto no cliente. Ele é
      -- tratado como broadcast no envio (sem associação), mas não é reduzido
      -- aqui porque presença é estado efêmero e não existe no SQL.
      v_result := v_result || jsonb_build_array(v_item);
      continue;
    end if;

    begin
      v_user := nullif(v_item->>'id','')::uuid;
    exception when others then
      continue;
    end;

    -- @todos considera participantes explícitos e papéis já vinculados ao protocolo.
    if exists(
      select 1 from public.service_request_participants srp
      where srp.request_id=p_request_id and srp.user_id=v_user
    ) or exists(
      select 1 from public.service_requests sr
      where sr.id=p_request_id
        and v_user in (sr.created_by, sr.assigned_aqs_id, sr.responsible_dev_id, sr.executor_id)
    ) then
      v_result := v_result || jsonb_build_array(v_item);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke execute on function public.taskboard_filter_request_broadcast_mentions(uuid,jsonb) from public,anon;
grant execute on function public.taskboard_filter_request_broadcast_mentions(uuid,jsonb) to authenticated;

-- Acompanhamento principal. O filtro acontece antes de persistir as menções e
-- antes do código legado que associa destinatários citados.
create or replace function public.add_followup_comment(
  p_subactivity_id uuid,
  p_content text,
  p_mentions jsonb default '[]'::jsonb,
  p_reply_to_comment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_project uuid := public.subactivity_project_id(p_subactivity_id);
  v_workspace uuid;
  v_sub public.subactivities%rowtype;
  v_activity uuid;
  v_preview text;
  v_actor_name text;
  v_project_name text;
  v_recipient uuid;
  v_broadcast_only boolean;
  v_was_project_member boolean;
  v_was_sub_member boolean;
  v_mentions jsonb := public.taskboard_filter_subactivity_broadcast_mentions(p_subactivity_id,coalesce(p_mentions,'[]'::jsonb));
begin
  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Você não participa desta subatividade';
  end if;
  if length(btrim(coalesce(p_content,''))) = 0 then raise exception 'Comentário vazio'; end if;
  if jsonb_typeof(v_mentions) <> 'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(v_mentions) > 250 then raise exception 'Muitas menções em uma única mensagem'; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_activity:=v_sub.activity_id;

  if p_reply_to_comment_id is not null and not exists(
    select 1 from public.subactivity_comments c
    where c.id=p_reply_to_comment_id and c.subactivity_id=p_subactivity_id
  ) then
    raise exception 'A mensagem respondida não pertence a esta subatividade';
  end if;

  insert into public.subactivity_comments(subactivity_id,author_id,content,mentions,reply_to_comment_id)
  values(p_subactivity_id,auth.uid(),btrim(p_content),v_mentions,p_reply_to_comment_id)
  returning id into v_id;

  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values(p_subactivity_id,auth.uid(),auth.uid())
  on conflict(subactivity_id,user_id) do nothing;

  select name into v_actor_name from public.profiles where id=auth.uid();
  select name into v_project_name from public.projects where id=v_project;
  v_preview:=left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  for v_recipient, v_broadcast_only in
    select wm.user_id,
           bool_and(lower(btrim(coalesce(value->>'label',''))) in ('todos','here')) as broadcast_only
    from jsonb_array_elements(v_mentions) value
    join public.workspace_members wm
      on wm.workspace_id=v_workspace
     and wm.active=true
     and wm.user_id=case
       when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then (value->>'id')::uuid else null end
    where value->>'kind'='user'
      and wm.user_id<>auth.uid()
    group by wm.user_id
  loop
    select exists(select 1 from public.project_members pm where pm.project_id=v_project and pm.user_id=v_recipient)
      into v_was_project_member;
    select (v_sub.assignee_id=v_recipient) or exists(
      select 1 from public.subactivity_members sm where sm.subactivity_id=p_subactivity_id and sm.user_id=v_recipient
    ) into v_was_sub_member;

    -- @todos/@here são SOMENTE broadcast. Nunca criam vínculo novo, nem em
    -- projeto, subatividade ou AQS. Se o mesmo usuário também foi citado por
    -- nome/@equipe na mesma mensagem, mantém a semântica normal de associação.
    if not v_broadcast_only then
      insert into public.project_members(project_id,user_id,added_by)
      values(v_project,v_recipient,auth.uid())
      on conflict(project_id,user_id) do nothing;

      insert into public.subactivity_members(subactivity_id,user_id,added_by)
      values(p_subactivity_id,v_recipient,auth.uid())
      on conflict(subactivity_id,user_id) do nothing;

      insert into public.aqs_review_participants(review_id,user_id,added_by)
      select ar.id,v_recipient,auth.uid()
      from public.aqs_reviews ar
      where ar.subactivity_id=p_subactivity_id
        and ar.status in ('awaiting','evaluating')
      on conflict(review_id,user_id) do nothing;
    end if;

    perform public.push_notification(
      v_recipient,auth.uid(),'followup-mention',
      format('%s mencionou você no acompanhamento',coalesce(nullif(v_actor_name,''),'Alguém')),
      case
        when v_broadcast_only then
          format('%s · %s · %s',coalesce(nullif(v_project_name,''),'Projeto'),v_sub.title,v_preview)
        when not v_was_sub_member and not v_was_project_member then
          format('Você foi adicionado ao projeto e à subatividade · %s · %s',coalesce(nullif(v_project_name,''),'Projeto'),v_sub.title)
        when not v_was_sub_member then
          format('Você foi adicionado à subatividade · %s · %s',coalesce(nullif(v_project_name,''),'Projeto'),v_sub.title)
        else
          format('%s · %s · %s',coalesce(nullif(v_project_name,''),'Projeto'),v_sub.title,v_preview)
      end,
      v_project,v_activity,p_subactivity_id
    );
  end loop;

  if v_sub.assignee_id<>auth.uid() and not exists(
    select 1 from jsonb_array_elements(v_mentions) value
    where value->>'kind'='user' and value->>'id'=v_sub.assignee_id::text
  ) then
    perform public.push_notification(
      v_sub.assignee_id,auth.uid(),'subactivity-comment','Nova mensagem em sua subatividade',
      format('“%s” · “%s”',v_sub.title,v_preview),v_project,v_activity,p_subactivity_id
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.add_followup_comment(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.add_followup_comment(uuid,text,jsonb,uuid) to authenticated;

-- Comentário tradicional/AQS usa a mesma regra de broadcast.
create or replace function public.add_subactivity_comment_v2(
  p_subactivity_id uuid,
  p_content text,
  p_mentions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_project uuid := public.subactivity_project_id(p_subactivity_id);
  v_workspace uuid;
  v_sub public.subactivities%rowtype;
  v_activity uuid;
  v_preview text;
  v_actor_name text;
  v_project_name text;
  v_mentions jsonb := public.taskboard_filter_subactivity_broadcast_mentions(p_subactivity_id,coalesce(p_mentions,'[]'::jsonb));
  v_recipient uuid;
  v_broadcast_only boolean;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_workspace:=public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Comentário vazio'; end if;
  if length(p_content)>8000 then raise exception 'Comentário muito longo'; end if;
  if jsonb_typeof(v_mentions)<>'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(v_mentions)>250 then raise exception 'Muitas menções em um único comentário'; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_activity:=v_sub.activity_id;

  insert into public.subactivity_comments(subactivity_id,author_id,content,mentions)
  values(p_subactivity_id,auth.uid(),btrim(p_content),v_mentions)
  returning id into v_id;

  select name into v_actor_name from public.profiles where id=auth.uid();
  select name into v_project_name from public.projects where id=v_project;
  v_preview:=left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  perform public.add_project_log(
    v_project,'comment-added','Comentário adicionado à subatividade',
    format('“%s” · “%s”',v_sub.title,v_preview),auth.uid()
  );

  for v_recipient, v_broadcast_only in
    select wm.user_id,
           bool_and(lower(btrim(coalesce(value->>'label',''))) in ('todos','here')) as broadcast_only
    from jsonb_array_elements(v_mentions) value
    join public.workspace_members wm
      on wm.workspace_id=v_workspace
     and wm.active=true
     and wm.user_id=case
       when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then (value->>'id')::uuid else null end
    where value->>'kind'='user'
      and wm.user_id<>auth.uid()
    group by wm.user_id
  loop
    if not v_broadcast_only then
      insert into public.project_members(project_id,user_id,added_by)
      values(v_project,v_recipient,auth.uid())
      on conflict(project_id,user_id) do nothing;

      insert into public.subactivity_members(subactivity_id,user_id,added_by)
      values(p_subactivity_id,v_recipient,auth.uid())
      on conflict(subactivity_id,user_id) do nothing;

      insert into public.aqs_review_participants(review_id,user_id,added_by)
      select ar.id,v_recipient,auth.uid()
      from public.aqs_reviews ar
      where ar.subactivity_id=p_subactivity_id
        and ar.status in ('awaiting','evaluating')
      on conflict(review_id,user_id) do nothing;
    end if;

    perform public.push_notification(
      v_recipient,auth.uid(),'followup-mention',
      format('%s mencionou você em uma subatividade',coalesce(nullif(v_actor_name,''),'Alguém')),
      format('%s · %s · %s',coalesce(nullif(v_project_name,''),'Projeto'),v_sub.title,v_preview),
      v_project,v_activity,p_subactivity_id
    );
  end loop;

  if v_sub.assignee_id is not null
     and v_sub.assignee_id<>auth.uid()
     and not exists(
       select 1 from jsonb_array_elements(v_mentions) value
       where value->>'kind'='user' and value->>'id'=v_sub.assignee_id::text
     ) then
    perform public.push_notification(
      v_sub.assignee_id,auth.uid(),'subactivity-comment','Novo comentário em sua subatividade',
      format('“%s” · “%s”',v_sub.title,v_preview),v_project,v_activity,p_subactivity_id
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.add_subactivity_comment_v2(uuid,text,jsonb) from public,anon;
grant execute on function public.add_subactivity_comment_v2(uuid,text,jsonb) to authenticated;

-- Solicitações: @todos/@here não inserem novos service_request_participants.
create or replace function public.add_service_request_message(
  p_request_id uuid,
  p_content text default '',
  p_mentions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_workspace uuid;
  v_user uuid;
  v_broadcast_only boolean;
  v_mentions jsonb := public.taskboard_filter_request_broadcast_mentions(p_request_id,coalesce(p_mentions,'[]'::jsonb));
begin
  if not public.can_contribute_service_request(p_request_id) then
    raise exception 'Você só pode enviar mensagens em solicitações em aberto que acompanha';
  end if;
  if jsonb_typeof(v_mentions)<>'array' then raise exception 'Menções inválidas'; end if;
  if length(btrim(coalesce(p_content,'')))>8000 then raise exception 'Mensagem muito longa'; end if;

  select workspace_id into v_workspace from public.service_requests where id=p_request_id;
  insert into public.service_request_messages(request_id,author_id,content,mentions)
  values(p_request_id,auth.uid(),coalesce(p_content,''),v_mentions)
  returning id into v_id;

  for v_user, v_broadcast_only in
    select wm.user_id,
           bool_and(lower(btrim(coalesce(value->>'label',''))) in ('todos','here')) as broadcast_only
    from jsonb_array_elements(v_mentions) value
    join public.workspace_members wm
      on wm.workspace_id=v_workspace
     and wm.active=true
     and wm.user_id=case
       when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then (value->>'id')::uuid else null end
    where value->>'kind'='user'
      and wm.user_id<>auth.uid()
    group by wm.user_id
  loop
    -- @todos/@here apenas notificam participantes já existentes. Menções
    -- individuais e de equipe continuam podendo associar o usuário.
    if not v_broadcast_only then
      insert into public.service_request_participants(request_id,user_id,source,added_by)
      values(p_request_id,v_user,'mention',auth.uid())
      on conflict(request_id,user_id) do nothing;
    end if;

    perform public.service_request_notify(
      p_request_id,v_user,'request-mention','Você foi mencionado em uma solicitação',
      coalesce(nullif(left(btrim(p_content),180),''),'Novo anexo ou mensagem no protocolo.')
    );
  end loop;
  return v_id;
end;
$$;

revoke execute on function public.add_service_request_message(uuid,text,jsonb) from public,anon;
grant execute on function public.add_service_request_message(uuid,text,jsonb) to authenticated;

commit;
