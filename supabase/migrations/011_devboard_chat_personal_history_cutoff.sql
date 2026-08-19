-- Devboard · Corte individual de histórico em conversas diretas
-- Incremental: execute após 010_devboard_chat_local_delete.sql.
--
-- "Remover conversa" continua sem apagar a conversa física nem as mensagens do
-- outro participante. Para quem removeu, porém, o histórico anterior deixa de
-- fazer parte daquela conversa. Se o chat for reaberto depois, ele começa vazio e
-- passa a mostrar apenas mensagens criadas após o corte individual.

begin;

alter table public.chat_members
  add column if not exists cleared_at timestamptz;

-- Preserva corretamente chats que estavam ocultos no momento em que esta migration
-- for aplicada. hidden_at já representa o instante em que aquele usuário removeu o chat.
update public.chat_members
set cleared_at = hidden_at
where cleared_at is null
  and hidden_at is not null;

comment on column public.chat_members.cleared_at is
  'Corte individual do histórico em chat direto. Mensagens anteriores a este instante permanecem no banco para os demais participantes, mas não são mais exibidas a este usuário.';

-- Centraliza a regra para SELECT/realtime/storage. Em grupos, o comportamento não
-- muda. Em conversa direta, cada usuário possui seu próprio ponto de corte.
create or replace function public.can_read_chat_message(
  p_conversation_id uuid,
  p_created_at timestamptz
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
    join public.chat_conversations c on c.id = cm.conversation_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = auth.uid()
      and (
        c.kind <> 'direct'
        or cm.cleared_at is null
        or p_created_at > cm.cleared_at
      )
  );
$$;

revoke execute on function public.can_read_chat_message(uuid,timestamptz) from public, anon;
grant execute on function public.can_read_chat_message(uuid,timestamptz) to authenticated;

-- Mantém o mesmo RPC usado pelo front-end. A exclusão continua local, porém agora
-- registra também o corte de histórico do participante atual.
create or replace function public.delete_direct_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := clock_timestamp();
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
  set hidden_at = v_cutoff,
      cleared_at = v_cutoff
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
end;
$$;

revoke execute on function public.delete_direct_conversation(uuid) from public, anon;
grant execute on function public.delete_direct_conversation(uuid) to authenticated;

-- Impede que o histórico anterior ao corte volte por paginação, refresh ou acesso
-- direto à tabela. O outro participante continua com o histórico completo, pois o
-- seu chat_members.cleared_at é independente.
drop policy if exists cadence_chat_messages_select on public.chat_messages;
create policy cadence_chat_messages_select
on public.chat_messages for select to authenticated
using (
  public.can_read_chat_message(conversation_id, created_at)
);

-- A UI não recebe mais mensagens antigas e, por consequência, não conhece seus
-- media_path. Esta policy também fecha o acesso direto a mídias antigas para o
-- usuário que limpou seu histórico, sem afetar o outro participante.
drop policy if exists devboard_chat_media_select on storage.objects;
create policy devboard_chat_media_select
on storage.objects for select to authenticated
using (
  bucket_id = 'devboard-chat-media'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
  and exists (
    select 1
    from public.chat_messages m
    where m.media_path = storage.objects.name
      and public.can_read_chat_message(m.conversation_id, m.created_at)
  )
);

commit;
