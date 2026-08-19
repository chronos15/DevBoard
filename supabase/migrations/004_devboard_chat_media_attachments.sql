-- Devboard
-- Mídias e anexos no Chat: preview no cliente + Storage privado + RPC segura.
-- Incremental: execute após 003_devboard_chat_audio.sql.

begin;

alter table public.chat_messages
  add column if not exists media_name text,
  add column if not exists media_kind text;

-- O check original de content exigia texto não vazio para qualquer mensagem.
-- Mídia pode ser enviada sem legenda; texto comum continua obrigatório.
alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages drop constraint if exists chat_messages_content_by_type_check;
alter table public.chat_messages
  add constraint chat_messages_content_by_type_check
  check (message_type <> 'text' or length(btrim(content)) > 0);

alter table public.chat_messages drop constraint if exists chat_messages_message_type_check;
alter table public.chat_messages
  add constraint chat_messages_message_type_check
  check (message_type in ('text','audio','media'));

alter table public.chat_messages drop constraint if exists chat_messages_audio_metadata_check;
alter table public.chat_messages
  add constraint chat_messages_audio_metadata_check
  check (
    message_type <> 'audio'
    or (
      media_path is not null
      and media_mime_type is not null
      and coalesce(media_duration_ms, 0) > 0
      and coalesce(media_size_bytes, 0) > 0
    )
  );

alter table public.chat_messages drop constraint if exists chat_messages_media_metadata_check;
alter table public.chat_messages
  add constraint chat_messages_media_metadata_check
  check (
    message_type <> 'media'
    or (
      media_path is not null
      and length(btrim(coalesce(media_name,''))) > 0
      and media_mime_type is not null
      and coalesce(media_size_bytes, 0) > 0
      and media_kind in ('image','pdf','text','document','video','audio','other')
    )
  );

create or replace function public.send_chat_media_message(
  p_conversation_id uuid,
  p_media_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_media_kind text,
  p_caption text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_workspace uuid;
  v_caption text := left(btrim(coalesce(p_caption,'')), 1200);
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
    raise exception 'Caminho do arquivo inválido';
  end if;

  if length(btrim(coalesce(p_file_name,''))) = 0 then raise exception 'Nome do arquivo inválido'; end if;
  if coalesce(p_size_bytes,0) <= 0 or p_size_bytes > 52428800 then raise exception 'Arquivo deve ter no máximo 50 MB'; end if;
  if length(btrim(coalesce(p_mime_type,''))) = 0 then p_mime_type := 'application/octet-stream'; end if;
  if p_media_kind not in ('image','pdf','text','document','video','audio','other') then raise exception 'Tipo de mídia inválido'; end if;

  insert into public.chat_messages(
    conversation_id, sender_id, content, message_type,
    media_path, media_mime_type, media_size_bytes, media_name, media_kind
  ) values (
    p_conversation_id, auth.uid(), v_caption, 'media',
    p_media_path, p_mime_type, p_size_bytes, left(btrim(p_file_name),255), p_media_kind
  ) returning id into v_id;

  update public.chat_conversations set updated_at=now() where id=p_conversation_id;
  return v_id;
end;
$$;

revoke execute on function public.send_chat_media_message(uuid,text,text,text,bigint,text,text) from public, anon;
grant execute on function public.send_chat_media_message(uuid,text,text,text,bigint,text,text) to authenticated;

-- O mesmo bucket privado do áudio passa a aceitar anexos gerais do Chat.
update storage.buckets
set public=false,
    file_size_limit=52428800,
    allowed_mime_types=null
where id='devboard-chat-media';

commit;
