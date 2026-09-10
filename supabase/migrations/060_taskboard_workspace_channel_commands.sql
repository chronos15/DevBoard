-- TaskBoard V68 - Comandos ricos por canal do Modo Resumido
-- Admin cadastra /comandos em canais gerais. A execução publica um snapshot rico no chat.

begin;

create table if not exists public.workspace_channel_commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null references public.workspace_channels(id) on delete cascade,
  command text not null,
  title text not null,
  description text,
  body jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  usage_count bigint not null default 0,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_channel_commands_command_format check (command ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  constraint workspace_channel_commands_title_length check (length(btrim(title)) between 1 and 100),
  constraint workspace_channel_commands_description_length check (description is null or length(description) <= 300),
  constraint workspace_channel_commands_body_array check (jsonb_typeof(body) = 'array' and jsonb_array_length(body) <= 30),
  constraint workspace_channel_commands_body_size check (octet_length(body::text) <= 262144)
);

create unique index if not exists workspace_channel_commands_channel_command_uidx
  on public.workspace_channel_commands(channel_id, lower(command));
create index if not exists workspace_channel_commands_channel_active_idx
  on public.workspace_channel_commands(channel_id, active, command);

create or replace function public.workspace_channel_command_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_channel_commands_set_updated_at on public.workspace_channel_commands;
create trigger workspace_channel_commands_set_updated_at
before update on public.workspace_channel_commands
for each row execute procedure public.workspace_channel_command_set_updated_at();

alter table public.workspace_channel_commands enable row level security;
drop policy if exists workspace_channel_commands_select on public.workspace_channel_commands;
create policy workspace_channel_commands_select
on public.workspace_channel_commands for select to authenticated
using (public.is_workspace_member(workspace_id));

revoke all on public.workspace_channel_commands from anon, authenticated;
grant select on public.workspace_channel_commands to authenticated;

-- Snapshot do comando no próprio chat: mensagens antigas não mudam quando o admin edita o comando depois.
alter table public.chat_messages
  add column if not exists command_name text,
  add column if not exists command_payload jsonb;

alter table public.chat_messages drop constraint if exists chat_messages_command_payload_check;
alter table public.chat_messages
  add constraint chat_messages_command_payload_check check (
    (command_name is null and command_payload is null)
    or
    (command_name ~ '^[a-z0-9][a-z0-9_-]{0,31}$' and jsonb_typeof(command_payload) = 'object')
  );

create or replace function public.save_workspace_channel_command(
  p_channel_id uuid,
  p_command text,
  p_title text,
  p_description text default null,
  p_body jsonb default '[]'::jsonb,
  p_command_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.workspace_channels%rowtype;
  v_id uuid;
  v_command text := lower(trim(leading '/' from btrim(coalesce(p_command, ''))));
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_body jsonb := coalesce(p_body, '[]'::jsonb);
begin
  select * into v_channel
  from public.workspace_channels
  where id = p_channel_id;

  if not found then raise exception 'Canal não encontrado'; end if;
  if not public.is_workspace_admin(v_channel.workspace_id) then
    raise exception 'Somente administradores podem cadastrar comandos';
  end if;
  if v_command !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then
    raise exception 'Use um comando com até 32 caracteres: letras minúsculas, números, - ou _';
  end if;
  if length(v_title) < 1 or length(v_title) > 100 then
    raise exception 'Informe um título com até 100 caracteres';
  end if;
  if v_description is not null and length(v_description) > 300 then
    raise exception 'A descrição pode ter no máximo 300 caracteres';
  end if;
  if jsonb_typeof(v_body) <> 'array' then
    raise exception 'O conteúdo do comando é inválido';
  end if;
  if jsonb_array_length(v_body) > 30 then
    raise exception 'O conteúdo do comando deve possuir no máximo 30 blocos';
  end if;
  if octet_length(v_body::text) > 262144 then
    raise exception 'O conteúdo do comando excede o limite permitido';
  end if;

  if p_command_id is null then
    insert into public.workspace_channel_commands(
      workspace_id, channel_id, command, title, description, body, created_by, updated_by
    ) values (
      v_channel.workspace_id, v_channel.id, v_command, v_title, v_description, v_body, auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.workspace_channel_commands
    set command = v_command,
        title = v_title,
        description = v_description,
        body = v_body,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_command_id
      and channel_id = v_channel.id
    returning id into v_id;
    if v_id is null then raise exception 'Comando não encontrado neste canal'; end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe /% neste canal', v_command;
end;
$$;

create or replace function public.delete_workspace_channel_command(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_command public.workspace_channel_commands%rowtype;
begin
  select * into v_command from public.workspace_channel_commands where id = p_command_id;
  if not found then raise exception 'Comando não encontrado'; end if;
  if not public.is_workspace_admin(v_command.workspace_id) then
    raise exception 'Somente administradores podem excluir comandos';
  end if;
  delete from public.workspace_channel_commands where id = p_command_id;
end;
$$;

create or replace function public.execute_workspace_channel_command(
  p_channel_id uuid,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel public.workspace_channels%rowtype;
  v_command public.workspace_channel_commands%rowtype;
  v_message_id uuid;
  v_payload jsonb;
begin
  select * into v_channel from public.workspace_channels where id = p_channel_id;
  if not found then raise exception 'Canal não encontrado'; end if;
  if v_channel.closed_at is not null then raise exception 'Este canal está fechado'; end if;
  if not public.is_workspace_member(v_channel.workspace_id) then raise exception 'Você não participa deste workspace'; end if;
  if not public.is_conversation_member(v_channel.conversation_id) then raise exception 'Você não participa deste canal'; end if;

  select * into v_command
  from public.workspace_channel_commands
  where id = p_command_id and channel_id = v_channel.id and active;
  if not found then raise exception 'Comando não encontrado ou indisponível'; end if;

  v_payload := jsonb_build_object(
    'commandId', v_command.id,
    'command', v_command.command,
    'title', v_command.title,
    'description', v_command.description,
    'body', v_command.body
  );

  insert into public.chat_messages(
    conversation_id, sender_id, content, message_type, mentions, command_name, command_payload
  ) values (
    v_channel.conversation_id,
    auth.uid(),
    '/' || v_command.command,
    'text',
    '[]'::jsonb,
    v_command.command,
    v_payload
  ) returning id into v_message_id;

  update public.workspace_channel_commands
  set usage_count = usage_count + 1, updated_at = updated_at
  where id = v_command.id;

  update public.chat_conversations
  set updated_at = now()
  where id = v_channel.conversation_id;

  return v_message_id;
end;
$$;

-- Realtime para alterações administrativas dos comandos.
do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_channel_commands'
     ) then
    alter publication supabase_realtime add table public.workspace_channel_commands;
  end if;
end $$;

revoke execute on function public.save_workspace_channel_command(uuid,text,text,text,jsonb,uuid) from public, anon;
revoke execute on function public.delete_workspace_channel_command(uuid) from public, anon;
revoke execute on function public.execute_workspace_channel_command(uuid,uuid) from public, anon;
grant execute on function public.save_workspace_channel_command(uuid,text,text,text,jsonb,uuid) to authenticated;
grant execute on function public.delete_workspace_channel_command(uuid) to authenticated;
grant execute on function public.execute_workspace_channel_command(uuid,uuid) to authenticated;

commit;
