-- Devboard · Migration 018
-- Integração Windows para o Painel Dev.
-- O agente roda no perfil do usuário (não como Windows Service), pois precisa
-- receber atalhos globais e abrir aplicações/janelas na sessão interativa.

begin;

create table if not exists public.developer_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  secret_hash text not null,
  machine_name text,
  agent_version text,
  os_name text,
  hotkey_ok boolean,
  installed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists developer_agents_user_created_idx
  on public.developer_agents(user_id, created_at desc);
create index if not exists developer_agents_user_seen_idx
  on public.developer_agents(user_id, last_seen_at desc nulls last);

alter table public.developer_agents enable row level security;

-- Não concedemos SELECT/INSERT/UPDATE/DELETE direto. O segredo do agente nunca
-- é exposto pela API; toda interação passa pelas funções abaixo.
revoke all on public.developer_agents from anon, authenticated;

create or replace function public.register_developer_agent()
returns table(agent_id uuid, agent_secret text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão necessária';
  end if;

  if not public.has_workspace_role(array['developer'::public.workspace_role]) then
    raise exception 'Apenas developers podem instalar o Devboard Agent';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');
  v_id := gen_random_uuid();

  insert into public.developer_agents(id, user_id, secret_hash)
  values (v_id, auth.uid(), encode(digest(v_secret, 'sha256'), 'hex'));

  agent_id := v_id;
  agent_secret := v_secret;
  return next;
end;
$$;

create or replace function public.developer_agent_heartbeat(
  p_agent_id uuid,
  p_agent_secret text,
  p_agent_version text default null,
  p_machine_name text default null,
  p_os_name text default null,
  p_hotkey_ok boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_agent_id is null or coalesce(length(p_agent_secret), 0) < 32 then
    return false;
  end if;

  update public.developer_agents a
  set
    agent_version = left(nullif(btrim(p_agent_version), ''), 40),
    machine_name = left(nullif(btrim(p_machine_name), ''), 120),
    os_name = left(nullif(btrim(p_os_name), ''), 120),
    hotkey_ok = p_hotkey_ok,
    installed_at = coalesce(a.installed_at, now()),
    last_seen_at = now()
  where a.id = p_agent_id
    and a.revoked_at is null
    and a.secret_hash = encode(digest(p_agent_secret, 'sha256'), 'hex');

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.developer_agent_status()
returns table(
  id uuid,
  machine_name text,
  agent_version text,
  os_name text,
  hotkey_ok boolean,
  installed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not public.has_workspace_role(array['developer'::public.workspace_role]) then
    return;
  end if;

  return query
  select
    a.id,
    a.machine_name,
    a.agent_version,
    a.os_name,
    a.hotkey_ok,
    a.installed_at,
    a.last_seen_at,
    a.created_at
  from public.developer_agents a
  where a.user_id = auth.uid()
    and a.revoked_at is null
  order by
    (a.last_seen_at is not null) desc,
    a.last_seen_at desc nulls last,
    a.created_at desc
  limit 8;
end;
$$;

create or replace function public.revoke_developer_agent(p_agent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.developer_agents
  set revoked_at = now()
  where id = p_agent_id
    and user_id = auth.uid()
    and revoked_at is null;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.register_developer_agent() from public;
grant execute on function public.register_developer_agent() to authenticated;

revoke all on function public.developer_agent_status() from public;
grant execute on function public.developer_agent_status() to authenticated;

revoke all on function public.revoke_developer_agent(uuid) from public;
grant execute on function public.revoke_developer_agent(uuid) to authenticated;

-- O heartbeat precisa funcionar sem sessão do navegador. A autenticação do
-- dispositivo é feita pelo segredo aleatório de 256 bits emitido no download.
revoke all on function public.developer_agent_heartbeat(uuid,text,text,text,text,boolean) from public;
grant execute on function public.developer_agent_heartbeat(uuid,text,text,text,text,boolean) to anon, authenticated;

commit;
