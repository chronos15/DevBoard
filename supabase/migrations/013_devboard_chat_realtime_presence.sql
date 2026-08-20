-- Devboard · 013 · Presença online em tempo real no Chat
--
-- Usa Supabase Realtime Presence em um canal privado por workspace:
--   devboard-presence:<workspace_uuid>
--
-- Nenhum heartbeat é gravado no Postgres. O estado online/offline é efêmero e
-- sincronizado pelo próprio Realtime, evitando writes periódicos e carga extra.

begin;

create or replace function public.safe_topic_presence_workspace_id(p_topic text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  if p_topic is null
     or p_topic !~* '^devboard-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return null;
  end if;

  v := split_part(p_topic, ':', 2);
  return v::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.can_access_presence_realtime(
  p_topic text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
     and public.is_workspace_member(public.safe_topic_presence_workspace_id(p_topic), p_user_id);
$$;

-- O cliente não chama o parser diretamente. Apenas o helper usado pela policy
-- precisa estar disponível para o papel authenticated.
revoke execute on function public.safe_topic_presence_workspace_id(text) from public, anon, authenticated;
revoke execute on function public.can_access_presence_realtime(text,uuid) from public, anon, authenticated;
grant execute on function public.can_access_presence_realtime(text,uuid) to authenticated;

-- RLS em realtime.messages já é gerenciado pelo Supabase. Não executar ALTER TABLE.
drop policy if exists devboard_presence_realtime_select on realtime.messages;
drop policy if exists devboard_presence_realtime_insert on realtime.messages;

create policy devboard_presence_realtime_select
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'presence'
  and public.can_access_presence_realtime((select realtime.topic()))
);

create policy devboard_presence_realtime_insert
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and public.can_access_presence_realtime((select realtime.topic()))
);

commit;
