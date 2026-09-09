-- Devboard V51 - Canais personalizados do Modo Discord
-- Admin pode criar canais globais do workspace, fechar/reabrir e manter histórico pesquisável.

begin;

create table if not exists public.workspace_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null unique references public.chat_conversations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_channels_name_nonempty check (length(btrim(name)) between 1 and 80),
  constraint workspace_channels_description_length check (description is null or length(description) <= 300)
);

create unique index if not exists workspace_channels_workspace_name_uidx
  on public.workspace_channels(workspace_id, lower(btrim(name)));
create index if not exists workspace_channels_workspace_open_idx
  on public.workspace_channels(workspace_id, closed_at, updated_at desc);

create or replace function public.workspace_channel_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_channels_set_updated_at on public.workspace_channels;
create trigger workspace_channels_set_updated_at
before update on public.workspace_channels
for each row execute procedure public.workspace_channel_set_updated_at();

alter table public.workspace_channels enable row level security;

drop policy if exists workspace_channels_select on public.workspace_channels;
create policy workspace_channels_select
on public.workspace_channels for select to authenticated
using (public.is_workspace_member(workspace_id));

-- Escrita fica exclusivamente via RPC administrativa.
revoke all on public.workspace_channels from anon, authenticated;
grant select on public.workspace_channels to authenticated;

create or replace function public.create_workspace_channel(
  p_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_channel_id uuid;
  v_conversation_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não autenticado';
  end if;
  if not public.is_workspace_admin(v_workspace) then
    raise exception 'Somente administradores podem criar canais';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Informe um nome de canal com até 80 caracteres';
  end if;
  if v_description is not null and length(v_description) > 300 then
    raise exception 'A descrição pode ter no máximo 300 caracteres';
  end if;

  insert into public.chat_conversations(workspace_id, kind, name, created_by)
  values(v_workspace, 'group', v_name, auth.uid())
  returning id into v_conversation_id;

  insert into public.workspace_channels(workspace_id, conversation_id, name, description, created_by)
  values(v_workspace, v_conversation_id, v_name, v_description, auth.uid())
  returning id into v_channel_id;

  -- Canais do workspace pertencem a todos os membros ativos, como um canal do Discord.
  insert into public.chat_members(conversation_id, user_id)
  select v_conversation_id, wm.user_id
  from public.workspace_members wm
  where wm.workspace_id = v_workspace and wm.active
  on conflict(conversation_id, user_id) do nothing;

  return v_channel_id;
exception
  when unique_violation then
    -- Se o nome já existir, remove a conversa criada na mesma transação antes de falhar.
    if v_conversation_id is not null then
      delete from public.chat_conversations where id = v_conversation_id;
    end if;
    raise exception 'Já existe um canal com esse nome';
end;
$$;

create or replace function public.set_workspace_channel_closed(
  p_channel_id uuid,
  p_closed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.workspace_channels%rowtype;
begin
  select * into v_channel
  from public.workspace_channels
  where id = p_channel_id
  for update;

  if not found then
    raise exception 'Canal não encontrado';
  end if;
  if not public.is_workspace_admin(v_channel.workspace_id) then
    raise exception 'Somente administradores podem fechar ou reabrir canais';
  end if;

  update public.workspace_channels
  set closed_at = case when coalesce(p_closed, false) then coalesce(closed_at, now()) else null end,
      closed_by = case when coalesce(p_closed, false) then auth.uid() else null end,
      updated_at = now()
  where id = p_channel_id;
end;
$$;

-- Quando um usuário entra/sai do workspace, sincroniza sua participação nos canais globais.
create or replace function public.sync_workspace_channel_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.active then
    insert into public.chat_members(conversation_id, user_id)
    select wc.conversation_id, new.user_id
    from public.workspace_channels wc
    where wc.workspace_id = new.workspace_id
    on conflict(conversation_id, user_id) do nothing;
  else
    delete from public.chat_members cm
    using public.workspace_channels wc
    where wc.conversation_id = cm.conversation_id
      and wc.workspace_id = new.workspace_id
      and cm.user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_sync_channels on public.workspace_members;
create trigger workspace_members_sync_channels
after insert or update of active on public.workspace_members
for each row execute procedure public.sync_workspace_channel_membership();

-- Reforça membros de canais existentes, útil em ambientes atualizados/reexecutados.
insert into public.chat_members(conversation_id, user_id)
select wc.conversation_id, wm.user_id
from public.workspace_channels wc
join public.workspace_members wm on wm.workspace_id = wc.workspace_id and wm.active
on conflict(conversation_id, user_id) do nothing;

-- Realtime apenas para metadados do canal; mensagens já usam o realtime do chat.
do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_channels'
     ) then
    alter publication supabase_realtime add table public.workspace_channels;
  end if;
end $$;

revoke execute on function public.create_workspace_channel(text,text) from public, anon;
revoke execute on function public.set_workspace_channel_closed(uuid,boolean) from public, anon;
grant execute on function public.create_workspace_channel(text,text) to authenticated;
grant execute on function public.set_workspace_channel_closed(uuid,boolean) to authenticated;

commit;
