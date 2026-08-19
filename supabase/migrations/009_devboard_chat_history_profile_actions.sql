-- Devboard · Histórico paginado + ações seguras de conversa
-- Incremental: execute após 008_devboard_deeplinks_chat_mentions.sql.

begin;

-- Otimiza a leitura da página mais recente e o carregamento incremental para trás.
create index if not exists chat_messages_conversation_created_desc_idx
  on public.chat_messages(conversation_id, created_at desc, id desc);

-- A remoção física precisa passar pela Storage API. A policy abaixo libera DELETE
-- somente para quem pode apagar a conversa: qualquer participante em conversa
-- individual; criador/admin em grupo. Sair de um grupo não remove mídias.
drop policy if exists devboard_chat_media_conversation_delete on storage.objects;
create policy devboard_chat_media_conversation_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'devboard-chat-media'
  and exists (
    select 1
    from public.chat_conversations c
    where c.id = public.safe_chat_media_conversation_id(storage.objects.name)
      and public.is_conversation_member(c.id)
      and (
        c.kind = 'direct'
        or c.created_by = auth.uid()
        or public.is_workspace_admin(c.workspace_id)
      )
  )
);

create or replace function public.delete_direct_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_conversation public.chat_conversations%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_conversation
  from public.chat_conversations
  where id = p_conversation_id and kind = 'direct'
  for update;

  if not found then raise exception 'Conversa individual não encontrada'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Você não participa desta conversa';
  end if;

  -- O front-end remove primeiro as mídias pela Storage API. Bloqueia a exclusão
  -- se ainda existir metadata de algum arquivo registrado, evitando órfãos no bucket.
  if exists (
    select 1
    from storage.objects o
    join public.chat_messages m on m.media_path = o.name
    where o.bucket_id = 'devboard-chat-media'
      and m.conversation_id = p_conversation_id
  ) then
    raise exception 'Ainda existem mídias no Storage para esta conversa';
  end if;

  delete from public.chat_conversations where id = p_conversation_id;
end;
$$;

create or replace function public.delete_chat_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_conversation public.chat_conversations%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_conversation
  from public.chat_conversations
  where id = p_conversation_id and kind = 'group'
  for update;

  if not found then raise exception 'Grupo não encontrado'; end if;
  if v_conversation.created_by <> auth.uid() and not public.is_workspace_admin(v_conversation.workspace_id) then
    raise exception 'Somente o criador ou administrador pode excluir o grupo';
  end if;

  if exists (
    select 1
    from storage.objects o
    join public.chat_messages m on m.media_path = o.name
    where o.bucket_id = 'devboard-chat-media'
      and m.conversation_id = p_conversation_id
  ) then
    raise exception 'Ainda existem mídias no Storage para este grupo';
  end if;

  delete from public.chat_conversations where id = p_conversation_id;
end;
$$;

create or replace function public.leave_chat_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_conversation public.chat_conversations%rowtype;
  v_member_count integer;
  v_next_owner uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_conversation
  from public.chat_conversations
  where id = p_conversation_id and kind = 'group'
  for update;

  if not found then raise exception 'Grupo não encontrado'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Você não participa deste grupo';
  end if;

  select count(*) into v_member_count
  from public.chat_members
  where conversation_id = p_conversation_id;

  -- O último participante não pode simplesmente sair, pois isso deixaria um
  -- grupo sem membros. Nesse caso ele deve usar a ação explícita de excluir grupo.
  if v_member_count <= 1 then
    raise exception 'Você é o último participante. Exclua o grupo para encerrá-lo.';
  end if;

  -- O grupo continua existindo. Se o criador sair, transfere a gestão para o
  -- participante mais antigo remanescente para não quebrar update_chat_group.
  if v_conversation.created_by = auth.uid() then
    select cm.user_id into v_next_owner
    from public.chat_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id <> auth.uid()
    order by cm.joined_at asc, cm.user_id asc
    limit 1;

    if v_next_owner is null then raise exception 'Não foi possível transferir a gestão do grupo'; end if;
    update public.chat_conversations
      set created_by = v_next_owner, updated_at = now()
      where id = p_conversation_id;
  end if;

  -- Remove também a participação do usuário em salas ligadas ao grupo.
  delete from public.meeting_members mm
  using public.meetings m
  where mm.meeting_id = m.id
    and m.conversation_id = p_conversation_id
    and mm.user_id = auth.uid();

  delete from public.chat_members
  where conversation_id = p_conversation_id
    and user_id = auth.uid();

  delete from public.notifications
  where recipient_id = auth.uid()
    and conversation_id = p_conversation_id;

  update public.chat_conversations
    set updated_at = now()
    where id = p_conversation_id;
end;
$$;

revoke execute on function public.delete_direct_conversation(uuid) from public, anon;
revoke execute on function public.delete_chat_group(uuid) from public, anon;
revoke execute on function public.leave_chat_group(uuid) from public, anon;
grant execute on function public.delete_direct_conversation(uuid) to authenticated;
grant execute on function public.delete_chat_group(uuid) to authenticated;
grant execute on function public.leave_chat_group(uuid) to authenticated;

commit;
