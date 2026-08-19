-- Devboard · Remoção local de conversas individuais
-- Incremental: execute após 009_devboard_chat_history_profile_actions.sql.
--
-- Uma conversa individual nunca é apagada fisicamente quando um participante usa
-- a ação "Excluir/Remover conversa". Ela fica oculta somente para aquele usuário.
-- O outro participante continua vendo o histórico normalmente. Se surgir uma nova
-- mensagem, a conversa volta automaticamente para a lista de ambos.

begin;

alter table public.chat_members
  add column if not exists hidden_at timestamptz;

create index if not exists chat_members_visible_user_idx
  on public.chat_members(user_id, conversation_id)
  where hidden_at is null;

-- Mantém a noção de participação separada da visibilidade. Isso é importante para
-- preservar histórico, permissões e recebimento de novas mensagens sem remover o
-- vínculo do usuário com a conversa.
create or replace function public.is_conversation_visible(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.chat_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.hidden_at is null
  );
$$;

revoke execute on function public.is_conversation_visible(uuid,uuid) from public, anon;
grant execute on function public.is_conversation_visible(uuid,uuid) to authenticated;

-- A lista de conversas passa a respeitar a visibilidade individual. O registro da
-- conversa e as mensagens continuam intactos para os demais participantes.
drop policy if exists cadence_chat_conversations_select on public.chat_conversations;
create policy cadence_chat_conversations_select
on public.chat_conversations for select to authenticated
using (
  public.is_conversation_member(id)
  and public.is_conversation_visible(id)
);

-- Compatibilidade: mantém o nome do RPC já usado pelo front-end, mas muda sua
-- semântica para remoção local. Nenhuma mensagem, mídia ou conversa é apagada.
create or replace function public.delete_direct_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  if not exists (
    select 1
    from public.chat_conversations c
    where c.id = p_conversation_id
      and c.kind = 'direct'
  ) then
    raise exception 'Conversa individual não encontrada';
  end if;

  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Você não participa desta conversa';
  end if;

  update public.chat_members
  set hidden_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
end;
$$;

revoke execute on function public.delete_direct_conversation(uuid) from public, anon;
grant execute on function public.delete_direct_conversation(uuid) to authenticated;

-- Ao iniciar novamente uma conversa pelo perfil/usuários, apenas quem iniciou volta
-- a enxergá-la imediatamente. O outro participante não sofre qualquer alteração.
create or replace function public.ensure_direct_conversation(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.current_workspace_id();
  v_id uuid;
  v_direct_key text;
begin
  if p_member_id=auth.uid() or not public.is_workspace_member(v_workspace,p_member_id) then return null; end if;
  v_direct_key:=least(auth.uid()::text,p_member_id::text)||':'||greatest(auth.uid()::text,p_member_id::text);

  select c.id into v_id
  from public.chat_conversations c
  where c.workspace_id=v_workspace and c.kind='direct' and c.direct_key=v_direct_key
  limit 1;

  if v_id is null then
    begin
      insert into public.chat_conversations(workspace_id,kind,direct_key,created_by)
      values(v_workspace,'direct',v_direct_key,auth.uid()) returning id into v_id;
    exception when unique_violation then
      select c.id into v_id from public.chat_conversations c
      where c.workspace_id=v_workspace and c.kind='direct' and c.direct_key=v_direct_key limit 1;
    end;
  end if;

  insert into public.chat_members(conversation_id,user_id)
  values(v_id,auth.uid()),(v_id,p_member_id)
  on conflict(conversation_id,user_id) do nothing;

  update public.chat_members
  set hidden_at = null
  where conversation_id = v_id
    and user_id = auth.uid()
    and hidden_at is not null;

  return v_id;
end;
$$;

revoke execute on function public.ensure_direct_conversation(uuid) from public, anon;
grant execute on function public.ensure_direct_conversation(uuid) to authenticated;

-- Qualquer mensagem nova em conversa individual faz o chat reaparecer para quem o
-- havia removido. O trigger cobre texto, áudio, imagens, documentos e futuros tipos
-- de mensagem sem duplicar essa regra em cada RPC de envio.
create or replace function public.reveal_direct_conversation_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.chat_conversations c
    where c.id = new.conversation_id
      and c.kind = 'direct'
  ) then
    update public.chat_members
    set hidden_at = null
    where conversation_id = new.conversation_id
      and hidden_at is not null;
  end if;

  return new;
end;
$$;

revoke execute on function public.reveal_direct_conversation_on_new_message() from public, anon, authenticated;

drop trigger if exists chat_messages_reveal_direct_conversation on public.chat_messages;
create trigger chat_messages_reveal_direct_conversation
after insert on public.chat_messages
for each row execute function public.reveal_direct_conversation_on_new_message();

-- Conversas individuais não precisam mais de permissão para apagar arquivos do
-- bucket, pois a remoção é apenas local. A exclusão física de mídia fica restrita à
-- exclusão real de grupos pelo criador/administrador.
drop policy if exists devboard_chat_media_conversation_delete on storage.objects;
create policy devboard_chat_media_conversation_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'devboard-chat-media'
  and exists (
    select 1
    from public.chat_conversations c
    where c.id = public.safe_chat_media_conversation_id(storage.objects.name)
      and c.kind = 'group'
      and public.is_conversation_member(c.id)
      and (
        c.created_by = auth.uid()
        or public.is_workspace_admin(c.workspace_id)
      )
  )
);

commit;
