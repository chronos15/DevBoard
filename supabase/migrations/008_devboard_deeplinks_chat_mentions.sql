-- Devboard · Links diretos + menções persistentes no Chat
-- Incremental: execute após 007_devboard_new_accounts_member.sql.
-- Links de atividade/subatividade são client-side e não exigem schema novo.

begin;

-- Metadados persistentes permitem distinguir uma menção selecionada no autocomplete
-- de um texto comum que apenas contenha '@'.
alter table public.chat_messages
  add column if not exists mentions jsonb not null default '[]'::jsonb;

alter table public.chat_messages
  drop constraint if exists chat_messages_mentions_array_check;
alter table public.chat_messages
  add constraint chat_messages_mentions_array_check
  check (
    jsonb_typeof(mentions) = 'array'
    and jsonb_array_length(mentions) <= 20
  );

-- Permite que a central de notificações leve o usuário de volta à conversa exata.
alter table public.notifications
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete set null;

create index if not exists notifications_conversation_idx
  on public.notifications(conversation_id, created_at desc)
  where conversation_id is not null;

-- A assinatura antiga com 2 argumentos precisa sair para não ficar ambígua com
-- a nova função (o terceiro parâmetro possui default).
drop function if exists public.send_chat_message(uuid,text);

create or replace function public.send_chat_message(
  p_conversation_id uuid,
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

  p_mentions := coalesce(p_mentions, '[]'::jsonb);
  if jsonb_typeof(p_mentions) <> 'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(p_mentions) > 20 then raise exception 'Limite de menções excedido'; end if;
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

    -- Só persiste o metadata se o texto enviado ainda contiver aquela menção.
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

  insert into public.chat_messages(conversation_id,sender_id,content,mentions)
  values(p_conversation_id,auth.uid(),btrim(p_content),v_mentions)
  returning id into v_id;

  update public.chat_conversations set updated_at=now() where id=p_conversation_id;

  select p.name into v_actor_name from public.profiles p where p.id=auth.uid();
  v_preview := left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  -- Notifica uma única vez cada usuário realmente mencionado, mesmo que ele
  -- apareça mais de uma vez no texto.
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

revoke execute on function public.send_chat_message(uuid,text,jsonb) from public,anon;
grant execute on function public.send_chat_message(uuid,text,jsonb) to authenticated;

commit;
