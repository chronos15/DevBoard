-- Devboard
-- Mensagens de áudio no Chat: gravação web + Storage privado + RPC segura.

begin;

alter table public.chat_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists media_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_duration_ms integer,
  add column if not exists media_size_bytes bigint;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_message_type_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_message_type_check
      check (message_type in ('text','audio'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_audio_metadata_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_audio_metadata_check
      check (
        (message_type = 'text')
        or (
          message_type = 'audio'
          and media_path is not null
          and media_mime_type is not null
          and coalesce(media_duration_ms, 0) > 0
          and coalesce(media_size_bytes, 0) > 0
        )
      );
  end if;
end $$;

create index if not exists chat_messages_media_path_idx
  on public.chat_messages(media_path)
  where media_path is not null;

create or replace function public.safe_chat_media_conversation_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v := split_part(p_name, '/', 2);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
exception when others then return null;
end;
$$;

create or replace function public.safe_chat_media_uploader_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v := split_part(p_name, '/', 3);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
exception when others then return null;
end;
$$;

create or replace function public.send_chat_audio_message(
  p_conversation_id uuid,
  p_media_path text,
  p_mime_type text,
  p_duration_ms integer,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Você não participa desta conversa';
  end if;

  v_workspace := public.conversation_workspace_id(p_conversation_id);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Conversa inválida para este workspace';
  end if;
  if p_media_path is null
     or public.safe_path_workspace_id(p_media_path) is distinct from v_workspace
     or public.safe_chat_media_conversation_id(p_media_path) is distinct from p_conversation_id
     or public.safe_chat_media_uploader_id(p_media_path) is distinct from auth.uid() then
    raise exception 'Caminho do áudio inválido';
  end if;
  if coalesce(p_duration_ms,0) <= 0 then raise exception 'Duração do áudio inválida'; end if;
  if coalesce(p_size_bytes,0) <= 0 or p_size_bytes > 26214400 then raise exception 'Tamanho do áudio inválido'; end if;
  if coalesce(p_mime_type,'') not like 'audio/%' then raise exception 'Formato de áudio inválido'; end if;

  insert into public.chat_messages(
    conversation_id, sender_id, content, message_type,
    media_path, media_mime_type, media_duration_ms, media_size_bytes
  ) values (
    p_conversation_id, auth.uid(), 'Mensagem de áudio', 'audio',
    p_media_path, p_mime_type, p_duration_ms, p_size_bytes
  ) returning id into v_id;

  update public.chat_conversations set updated_at = now() where id = p_conversation_id;
  return v_id;
end;
$$;

revoke execute on function public.safe_chat_media_conversation_id(text) from public, anon;
revoke execute on function public.safe_chat_media_uploader_id(text) from public, anon;
revoke execute on function public.send_chat_audio_message(uuid,text,text,integer,bigint) from public, anon;
grant execute on function public.safe_chat_media_conversation_id(text), public.safe_chat_media_uploader_id(text) to authenticated;
grant execute on function public.send_chat_audio_message(uuid,text,text,integer,bigint) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'devboard-chat-media',
  'devboard-chat-media',
  false,
  26214400,
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists devboard_chat_media_select on storage.objects;
drop policy if exists devboard_chat_media_insert on storage.objects;
drop policy if exists devboard_chat_media_rollback_delete on storage.objects;

create policy devboard_chat_media_select
on storage.objects for select to authenticated
using (
  bucket_id='devboard-chat-media'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
  and public.is_conversation_member(public.safe_chat_media_conversation_id(name))
);

create policy devboard_chat_media_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='devboard-chat-media'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
  and public.is_conversation_member(public.safe_chat_media_conversation_id(name))
  and public.safe_chat_media_uploader_id(name)=auth.uid()
);

-- Permite apenas limpar um upload que ainda não foi registrado como mensagem.
create policy devboard_chat_media_rollback_delete
on storage.objects for delete to authenticated
using (
  bucket_id='devboard-chat-media'
  and public.safe_chat_media_uploader_id(name)=auth.uid()
  and not exists (
    select 1 from public.chat_messages m where m.media_path=storage.objects.name
  )
);

commit;
