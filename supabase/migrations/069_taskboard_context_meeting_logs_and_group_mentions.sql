-- TaskBoard V80 · reuniões por contexto + menções de grupo
-- Execute após 068_taskboard_release_handoff_and_typing.sql.
--
-- Sem mudança estrutural de negócio: apenas amplia metadata de menções do chat,
-- adiciona uma RPC compatível para comentários e torna os logs de reunião
-- rastreáveis pela subatividade exata.

begin;

-- Até 250 destinatários permite @todos em workspaces maiores sem quebrar a
-- mensagem. O front-end continua enviando somente usuários ativos resolvidos.
alter table public.chat_messages
  drop constraint if exists chat_messages_mentions_array_check;
alter table public.chat_messages
  add constraint chat_messages_mentions_array_check
  check (jsonb_typeof(mentions)='array' and jsonb_array_length(mentions)<=250);

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
  v_mentions jsonb := coalesce(p_mentions,'[]'::jsonb);
  v_recipient uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_workspace:=public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;
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

  for v_recipient in
    select distinct wm.user_id
      from jsonb_array_elements(v_mentions) value
      join public.workspace_members wm
        on wm.workspace_id=v_workspace
       and wm.active=true
       and wm.user_id=case
         when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         then (value->>'id')::uuid else null end
     where value->>'kind'='user'
       and wm.user_id<>auth.uid()
  loop
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

-- Acompanhamento: mesma política atual, apenas suporta aliases de grupo
-- expandidos no cliente e associa mencionados à análise AQS ativa, quando houver.
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
  v_was_project_member boolean;
  v_was_sub_member boolean;
  v_mentions jsonb := coalesce(p_mentions, '[]'::jsonb);
begin
  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Você não participa desta subatividade';
  end if;
  if length(btrim(coalesce(p_content,''))) = 0 then
    raise exception 'Comentário vazio';
  end if;
  if jsonb_typeof(v_mentions) <> 'array' then
    raise exception 'Menções inválidas';
  end if;
  if jsonb_array_length(v_mentions) > 250 then
    raise exception 'Muitas menções em uma única mensagem';
  end if;

  select * into v_sub from public.subactivities where id = p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_activity := v_sub.activity_id;

  if p_reply_to_comment_id is not null and not exists (
    select 1 from public.subactivity_comments c
     where c.id = p_reply_to_comment_id and c.subactivity_id = p_subactivity_id
  ) then
    raise exception 'A mensagem respondida não pertence a esta subatividade';
  end if;

  insert into public.subactivity_comments(
    subactivity_id, author_id, content, mentions, reply_to_comment_id
  ) values (
    p_subactivity_id, auth.uid(), btrim(p_content), v_mentions, p_reply_to_comment_id
  ) returning id into v_id;

  -- Garante que um participante que escreveu continue explicitamente associado.
  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values(p_subactivity_id,auth.uid(),auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

  select name into v_actor_name from public.profiles where id = auth.uid();
  select name into v_project_name from public.projects where id = v_project;
  v_preview := left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  for v_recipient in
    select distinct wm.user_id
      from jsonb_array_elements(v_mentions) value
      join public.workspace_members wm
        on wm.workspace_id = v_workspace
       and wm.active = true
       and wm.user_id = case
         when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         then (value->>'id')::uuid
         else null
       end
     where value->>'kind' = 'user'
       and wm.user_id <> auth.uid()
  loop
    select exists(
      select 1 from public.project_members pm
       where pm.project_id = v_project and pm.user_id = v_recipient
    ) into v_was_project_member;

    select (v_sub.assignee_id=v_recipient) or exists(
      select 1 from public.subactivity_members sm
       where sm.subactivity_id=p_subactivity_id and sm.user_id=v_recipient
    ) into v_was_sub_member;

    insert into public.project_members(project_id, user_id, added_by)
    values (v_project, v_recipient, auth.uid())
    on conflict (project_id, user_id) do nothing;

    insert into public.subactivity_members(subactivity_id,user_id,added_by)
    values (p_subactivity_id,v_recipient,auth.uid())
    on conflict (subactivity_id,user_id) do nothing;

    -- Se a subatividade estiver em análise AQS, a menção também associa o
    -- usuário às análises ativas sem torná-lo o AQS responsável.
    insert into public.aqs_review_participants(review_id,user_id,added_by)
    select ar.id,v_recipient,auth.uid()
      from public.aqs_reviews ar
     where ar.subactivity_id=p_subactivity_id
       and ar.status in ('awaiting','evaluating')
    on conflict(review_id,user_id) do nothing;

    perform public.push_notification(
      v_recipient,
      auth.uid(),
      'followup-mention',
      format('%s mencionou você no acompanhamento', coalesce(nullif(v_actor_name,''),'Alguém')),
      case
        when not v_was_sub_member and not v_was_project_member then
          format('Você foi adicionado ao projeto e à subatividade · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title)
        when not v_was_sub_member then
          format('Você foi adicionado à subatividade · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title)
        else
          format('%s · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title, v_preview)
      end,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end loop;

  if v_sub.assignee_id <> auth.uid() and not exists (
    select 1 from jsonb_array_elements(v_mentions) value
     where value->>'kind' = 'user' and value->>'id' = v_sub.assignee_id::text
  ) then
    perform public.push_notification(
      v_sub.assignee_id,auth.uid(),'subactivity-comment','Nova mensagem em sua subatividade',
      format('“%s” · “%s”', v_sub.title, v_preview),v_project,v_activity,p_subactivity_id
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.add_followup_comment(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.add_followup_comment(uuid,text,jsonb,uuid) to authenticated;

create or replace function public.add_followup_comment_v2(
  p_subactivity_id uuid,
  p_content text,
  p_mentions jsonb default '[]'::jsonb,
  p_reply jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_kind text;
  v_target_id uuid;
  v_snapshot jsonb;
  v_legacy_comment_id uuid;
  v_project_id uuid;
  v_workspace_id uuid;
  v_role text;
  v_author_id uuid;
  v_label text;
  v_content text;
  v_mentions jsonb := coalesce(p_mentions, '[]'::jsonb);
  v_is_participant boolean := false;
  v_sub public.subactivities%rowtype;
  v_actor_name text;
  v_preview text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_subactivity_id is null then raise exception 'Subatividade não informada'; end if;
  if length(btrim(coalesce(p_content,''))) = 0 then raise exception 'Comentário vazio'; end if;
  if jsonb_typeof(v_mentions) <> 'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(v_mentions) > 250 then raise exception 'Muitas menções em uma única mensagem'; end if;

  v_project_id := public.subactivity_project_id(p_subactivity_id);
  v_workspace_id := public.project_workspace_id(v_project_id);
  if v_project_id is null or v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Sem acesso ao projeto';
  end if;

  select * into v_sub
    from public.subactivities
   where id = p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;

  v_role := public.workspace_role_of(v_workspace_id, auth.uid())::text;
  v_is_participant := public.can_access_followup_subactivity(p_subactivity_id);

  if not v_is_participant then
    if v_role <> 'developer' or not public.can_view_followup_subactivity(p_subactivity_id) then
      raise exception 'Você não participa desta subatividade';
    end if;
    if p_reply is null or p_reply = 'null'::jsonb then
      raise exception 'Esta subatividade está em modo de observação. Use Responder para adicionar um comentário.';
    end if;
    if jsonb_array_length(v_mentions) > 0 then
      raise exception 'Observadores não podem mencionar usuários nesta subatividade';
    end if;
  end if;

  if p_reply is not null and p_reply <> 'null'::jsonb then
    if jsonb_typeof(p_reply) <> 'object' then
      raise exception 'Referência de resposta inválida';
    end if;

    v_kind := lower(btrim(coalesce(p_reply->>'kind', '')));
    if v_kind not in ('comment','attachment','log','session') then
      raise exception 'Tipo de item respondido inválido';
    end if;

    begin
      v_target_id := nullif(btrim(coalesce(p_reply->>'id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Item respondido inválido';
    end;

    if v_target_id is null then
      raise exception 'Item respondido inválido';
    end if;

    if v_kind = 'comment' then
      select c.author_id,
             'Mensagem',
             left(regexp_replace(c.content, '[[:space:]]+', ' ', 'g'), 180)
        into v_author_id, v_label, v_content
        from public.subactivity_comments c
       where c.id = v_target_id
         and c.subactivity_id = p_subactivity_id;
      if not found then
        raise exception 'A mensagem respondida não pertence a esta subatividade';
      end if;
      v_legacy_comment_id := v_target_id;

    elsif v_kind = 'attachment' then
      select a.uploaded_by,
             'Anexo',
             a.name
        into v_author_id, v_label, v_content
        from public.attachments a
       where a.id = v_target_id
         and a.subactivity_id = p_subactivity_id
         and a.active = true;
      if not found then
        raise exception 'O anexo respondido não pertence a esta subatividade';
      end if;

    elsif v_kind = 'session' then
      select ws.user_id,
             'Registro de trabalho',
             concat(
               lpad((ws.duration_seconds / 3600)::text, 2, '0'), ':',
               lpad(((ws.duration_seconds % 3600) / 60)::text, 2, '0'), ':',
               lpad((ws.duration_seconds % 60)::text, 2, '0'),
               ' registrados'
             )
        into v_author_id, v_label, v_content
        from public.work_sessions ws
       where ws.id = v_target_id
         and ws.subactivity_id = p_subactivity_id;
      if not found then
        raise exception 'O registro respondido não pertence a esta subatividade';
      end if;

    else
      select l.actor_id,
             'Log',
             left(
               concat_ws(' · ', nullif(btrim(l.title), ''), nullif(btrim(l.description), '')),
               220
             )
        into v_author_id, v_label, v_content
        from public.project_logs l
       where l.id = v_target_id
         and l.project_id = v_project_id;
      if not found then
        raise exception 'O log respondido não pertence a este projeto';
      end if;
    end if;

    v_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'authorId', v_author_id,
      'label', v_label,
      'content', v_content
    ));
  end if;

  if v_is_participant then
    -- Participantes/admin continuam usando a implementação consolidada, com
    -- menções, vínculo e notificações existentes.
    v_comment_id := public.add_followup_comment(
      p_subactivity_id,
      p_content,
      v_mentions,
      v_legacy_comment_id
    );

    if v_target_id is not null then
      update public.subactivity_comments
         set reply_target_kind = v_kind,
             reply_target_id = v_target_id,
             reply_snapshot = v_snapshot
       where id = v_comment_id;
    end if;

    return v_comment_id;
  end if;

  -- DEV observador: grava somente uma resposta sem transformar o usuário em
  -- participante da subatividade.
  insert into public.subactivity_comments(
    subactivity_id,
    author_id,
    content,
    mentions,
    reply_to_comment_id,
    reply_target_kind,
    reply_target_id,
    reply_snapshot
  ) values (
    p_subactivity_id,
    auth.uid(),
    btrim(p_content),
    '[]'::jsonb,
    v_legacy_comment_id,
    v_kind,
    v_target_id,
    v_snapshot
  ) returning id into v_comment_id;

  select name into v_actor_name from public.profiles where id = auth.uid();
  v_preview := left(regexp_replace(btrim(p_content), '[[:space:]]+', ' ', 'g'), 180);

  -- Mantém o responsável informado sem dar ao observador acesso de participante.
  if v_sub.assignee_id is not null and v_sub.assignee_id <> auth.uid() then
    perform public.push_notification(
      v_sub.assignee_id,
      auth.uid(),
      'subactivity-comment',
      format('%s comentou em sua subatividade', coalesce(nullif(v_actor_name,''), 'Um desenvolvedor')),
      format('“%s” · “%s”', v_sub.title, v_preview),
      v_project_id,
      v_sub.activity_id,
      p_subactivity_id
    );
  end if;

  return v_comment_id;
end;
$$;

revoke execute on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) to authenticated;

-- Chat/reunião: o cliente V80 sempre usa a assinatura com reply opcional.
-- meeting_invite_user é chamado antes do envio e inclui os alvos de uma menção
-- coletiva na reunião e no contexto correspondente.
create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_content text,
  p_mentions jsonb,
  p_reply_to_message_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_workspace uuid;
  v_kind text;
  v_conversation_name text;
  v_actor_name text;
  v_mentions jsonb := '[]'::jsonb;
  v_item jsonb;
  v_mention_kind text;
  v_mention_id uuid;
  v_label text;
  v_key text;
  v_seen text[] := '{}'::text[];
  v_recipient uuid;
  v_preview text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Você não participa desta conversa';
  end if;
  if length(btrim(coalesce(p_content,'')))=0 then raise exception 'Mensagem vazia'; end if;
  if length(p_content) > 2500 then raise exception 'Mensagem muito longa'; end if;

  select c.workspace_id, c.kind::text, c.name
    into v_workspace, v_kind, v_conversation_name
  from public.chat_conversations c
  where c.id=p_conversation_id;

  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Conversa inválida para este workspace';
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1
    from public.chat_messages m
    where m.id = p_reply_to_message_id
      and m.conversation_id = p_conversation_id
      and public.can_read_chat_message(m.conversation_id, m.created_at)
  ) then
    raise exception 'A mensagem respondida não existe ou não está disponível nesta conversa';
  end if;

  p_mentions := coalesce(p_mentions, '[]'::jsonb);
  if jsonb_typeof(p_mentions) <> 'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(p_mentions) > 250 then raise exception 'Limite de menções excedido'; end if;
  if v_kind <> 'group' and jsonb_array_length(p_mentions) > 0 then
    raise exception 'Menções estão disponíveis somente em grupos';
  end if;

  for v_item in select value from jsonb_array_elements(p_mentions)
  loop
    v_mention_kind := nullif(v_item->>'kind','');
    v_label := left(btrim(coalesce(v_item->>'label','')),120);

    begin
      v_mention_id := nullif(v_item->>'id','')::uuid;
    exception when others then
      raise exception 'Identificador de menção inválido';
    end;

    if v_mention_kind not in ('user','project') or v_mention_id is null or length(v_label)=0 then
      raise exception 'Menção inválida';
    end if;

    if position(('@' || v_label) in p_content) = 0 then
      continue;
    end if;

    v_key := v_mention_kind || ':' || v_mention_id::text;
    if v_key = any(v_seen) then continue; end if;

    if v_mention_kind='user' then
      if not exists(
        select 1 from public.chat_members cm
        where cm.conversation_id=p_conversation_id and cm.user_id=v_mention_id
      ) then
        raise exception 'O usuário mencionado não participa deste grupo';
      end if;
    else
      if public.project_workspace_id(v_mention_id) is distinct from v_workspace then
        raise exception 'Projeto mencionado não pertence a este workspace';
      end if;
    end if;

    v_seen := array_append(v_seen,v_key);
    v_mentions := v_mentions || jsonb_build_array(
      jsonb_build_object('kind',v_mention_kind,'id',v_mention_id,'label',v_label)
    );
  end loop;

  insert into public.chat_messages(
    conversation_id,
    sender_id,
    content,
    mentions,
    reply_to_message_id
  ) values (
    p_conversation_id,
    auth.uid(),
    btrim(p_content),
    v_mentions,
    p_reply_to_message_id
  )
  returning id into v_id;

  update public.chat_conversations set updated_at=now() where id=p_conversation_id;

  select p.name into v_actor_name from public.profiles p where p.id=auth.uid();
  v_preview := left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  for v_recipient in
    select distinct (value->>'id')::uuid
    from jsonb_array_elements(v_mentions)
    where value->>'kind'='user'
      and (value->>'id')::uuid <> auth.uid()
  loop
    insert into public.notifications(
      workspace_id,recipient_id,actor_id,type,title,description,conversation_id
    ) values (
      v_workspace,
      v_recipient,
      auth.uid(),
      'chat-mention',
      format('%s mencionou você',coalesce(nullif(v_actor_name,''),'Alguém')),
      format('%s · %s',coalesce(nullif(v_conversation_name,''),'Grupo'),v_preview),
      p_conversation_id
    );
  end loop;

  return v_id;
end;
$$;

revoke execute on function public.send_chat_message(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.send_chat_message(uuid,text,jsonb,uuid) to authenticated;

-- O log inicial nasce durante start_activity_meeting, quando ainda não existe
-- informação de subatividade no wrapper. Ele ganha um meeting-id estável e em
-- seguida start_context_meeting complementa o marker da subatividade.
create or replace function public.register_activity_meeting_start(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_activity uuid;
  v_project uuid;
  v_names text;
  v_count integer:=0;
  v_description text;
  v_inserted boolean:=false;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found or v_meeting.conversation_id is null then return; end if;

  select g.activity_id,a.project_id
    into v_activity,v_project
  from public.activity_meeting_groups g
  join public.activities a on a.id=g.activity_id
  where g.conversation_id=v_meeting.conversation_id;
  if v_activity is null then return; end if;

  insert into public.activity_meeting_runs(meeting_id,activity_id,project_id,request_id)
  values(p_meeting_id,v_activity,v_project,null)
  on conflict(meeting_id) do nothing;
  get diagnostics v_count = row_count;
  v_inserted:=v_count>0;
  if not v_inserted then return; end if;

  select count(*),string_agg(p.name,', ' order by p.name)
    into v_count,v_names
  from public.meeting_members mm
  join public.profiles p on p.id=mm.user_id
  where mm.meeting_id=p_meeting_id;

  v_description:=format(
    '[[meeting-id:%s]][[meeting-activity:%s]]%s convidado%s: %s.',
    p_meeting_id,
    v_activity,
    v_count,
    case when v_count=1 then '' else 's' end,
    coalesce(v_names,'—')
  );

  perform public.add_project_log(
    v_project,
    'meeting-started',
    'Ligação de reunião iniciada',
    v_description,
    v_meeting.created_by
  );
end;
$$;

revoke execute on function public.register_activity_meeting_start(uuid) from public,anon,authenticated;

create or replace function public.start_context_meeting(
  p_activity_id uuid,
  p_mode text default 'video',
  p_subactivity_id uuid default null,
  p_request_id uuid default null,
  p_aqs_review_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_launch jsonb;
  v_meeting_id uuid;
  v_review_subactivity uuid;
  v_effective_subactivity uuid:=p_subactivity_id;
  v_context_assigned boolean:=false;
  v_names text;
  v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  if p_subactivity_id is not null and not exists(
    select 1 from public.subactivities s
    where s.id=p_subactivity_id and s.activity_id=p_activity_id
  ) then
    raise exception 'A subatividade não pertence a esta atividade';
  end if;

  if p_request_id is not null and not exists(
    select 1 from public.service_requests r
    where r.id=p_request_id and r.activity_id=p_activity_id
  ) then
    raise exception 'A solicitação não pertence a esta atividade';
  end if;

  if p_aqs_review_id is not null then
    select ar.subactivity_id into v_review_subactivity
    from public.aqs_reviews ar
    where ar.id=p_aqs_review_id and ar.activity_id=p_activity_id;
    if v_review_subactivity is null then
      raise exception 'A análise AQS não pertence a esta atividade';
    end if;
    if v_effective_subactivity is null then v_effective_subactivity:=v_review_subactivity; end if;
    if v_effective_subactivity is distinct from v_review_subactivity then
      raise exception 'A análise AQS não pertence à subatividade informada';
    end if;
  end if;

  v_launch:=public.start_activity_meeting(p_activity_id,p_mode);
  begin
    v_meeting_id:=(v_launch->>'meetingId')::uuid;
  exception when others then
    raise exception 'A reunião foi criada sem identificador válido';
  end;

  -- Uma reunião ativa é reutilizada por atividade. O primeiro contexto específico
  -- que a originou permanece como contexto canônico; abrir a mesma sala por outro
  -- ponto do sistema não troca silenciosamente suas permissões.
  update public.activity_meeting_runs
  set subactivity_id=v_effective_subactivity,
      request_id=p_request_id,
      aqs_review_id=p_aqs_review_id
  where meeting_id=v_meeting_id
    and subactivity_id is null
    and request_id is null
    and aqs_review_id is null;
  get diagnostics v_count = row_count;
  v_context_assigned:=v_count>0;

  -- register_activity_meeting_start roda dentro de start_activity_meeting antes
  -- de o wrapper conhecer a subatividade. Depois de fixar o contexto, completa
  -- o log de início com a subatividade exata.
  if v_context_assigned and v_effective_subactivity is not null then
    update public.project_logs l
       set description = coalesce(l.description,'') || format('[[meeting-subactivity:%s]]',v_effective_subactivity)
     where l.project_id = (select a.project_id from public.activities a where a.id=p_activity_id)
       and l.type='meeting-started'
       and l.description like ('%[[meeting-id:' || v_meeting_id::text || ']]%')
       and l.description not like '%[[meeting-subactivity:%';
  end if;

  if v_context_assigned and p_request_id is not null then
    select count(*),string_agg(p.name,', ' order by p.name)
      into v_count,v_names
    from public.meeting_members mm
    join public.profiles p on p.id=mm.user_id
    where mm.meeting_id=v_meeting_id;

    perform public.service_request_add_event(
      p_request_id,
      'technical-meeting-started',
      'Ligação de reunião iniciada',
      format('%s convidado%s: %s.',v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      auth.uid()
    );
  end if;

  return v_launch || jsonb_build_object(
    'subactivityId',v_effective_subactivity,
    'requestId',p_request_id,
    'aqsReviewId',p_aqs_review_id
  );
end;
$$;

revoke execute on function public.start_context_meeting(uuid,text,uuid,uuid,uuid) from public,anon;
grant execute on function public.start_context_meeting(uuid,text,uuid,uuid,uuid) to authenticated;

-- O encerramento já conhece activity_meeting_runs e consegue gravar todos os
-- markers de uma vez.
create or replace function public.log_activity_meeting_end()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_context public.activity_meeting_runs%rowtype;
  v_names text;
  v_count integer:=0;
  v_seconds bigint;
  v_duration text;
  v_description text;
  v_sub_marker text := '';
begin
  if old.ended_at is not null or new.ended_at is null then return new; end if;

  select * into v_context
  from public.activity_meeting_runs
  where meeting_id=new.id;
  if not found then return new; end if;

  select count(*),string_agg(p.name,', ' order by p.name)
    into v_count,v_names
  from public.meeting_members mm
  join public.profiles p on p.id=mm.user_id
  where mm.meeting_id=new.id
    and mm.joined_at is not null;

  v_seconds:=greatest(0,extract(epoch from (new.ended_at-new.created_at))::bigint);
  v_duration:=public.format_meeting_duration(v_seconds);
  if v_context.subactivity_id is not null then
    v_sub_marker:=format('[[meeting-subactivity:%s]]',v_context.subactivity_id);
  end if;
  v_description:=format(
    '[[meeting-id:%s]][[meeting-activity:%s]]%sDuração %s · %s participante%s: %s.',
    new.id,
    v_context.activity_id,
    v_sub_marker,
    v_duration,
    v_count,
    case when v_count=1 then '' else 's' end,
    coalesce(v_names,'—')
  );

  perform public.add_project_log(
    v_context.project_id,
    'meeting-ended',
    'Ligação de reunião encerrada',
    v_description,
    new.created_by
  );

  if v_context.request_id is not null then
    perform public.service_request_add_event(
      v_context.request_id,
      'technical-meeting-ended',
      'Ligação de reunião encerrada',
      format('Duração %s · %s participante%s: %s.',v_duration,v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      new.created_by
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.log_activity_meeting_end() from public,anon,authenticated;

-- Garante que o trigger continue apontando para a implementação V80.
drop trigger if exists activity_meeting_end_log on public.meetings;
create trigger activity_meeting_end_log
after update of ended_at on public.meetings
for each row
when (old.ended_at is null and new.ended_at is not null)
execute procedure public.log_activity_meeting_end();

commit;
