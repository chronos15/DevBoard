-- Devboard
-- Chamadas com convite/aceite explícito, encerramento automático e notificações.

begin;

update public.workspaces
set name = 'Devboard'
where id = '00000000-0000-0000-0000-000000000001';

alter table public.notifications
  add column if not exists meeting_id uuid references public.meetings(id) on delete cascade;
create index if not exists notifications_meeting_idx
  on public.notifications(meeting_id, recipient_id, created_at desc)
  where meeting_id is not null;

alter table public.meeting_members add column if not exists status text;
alter table public.meeting_members add column if not exists invited_at timestamptz;
alter table public.meeting_members add column if not exists answered_at timestamptz;
alter table public.meeting_members add column if not exists joined_at timestamptz;
alter table public.meeting_members add column if not exists left_at timestamptz;
alter table public.meeting_members add column if not exists last_seen_at timestamptz;

update public.meeting_members mm
set
  status = case
    when m.ended_at is not null then 'left'
    when mm.user_id = m.created_by then 'joined'
    else 'pending'
  end,
  invited_at = coalesce(mm.invited_at, mm.created_at),
  answered_at = case
    when mm.user_id = m.created_by then coalesce(mm.answered_at, mm.created_at)
    else mm.answered_at
  end,
  joined_at = case
    when mm.user_id = m.created_by then coalesce(mm.joined_at, mm.created_at)
    else mm.joined_at
  end,
  last_seen_at = case
    when m.ended_at is null and mm.user_id = m.created_by then coalesce(mm.last_seen_at, now())
    else mm.last_seen_at
  end
from public.meetings m
where m.id = mm.meeting_id
  and (mm.status is null or mm.invited_at is null);

alter table public.meeting_members alter column status set default 'pending';
alter table public.meeting_members alter column status set not null;
alter table public.meeting_members alter column invited_at set default now();
update public.meeting_members set invited_at = coalesce(invited_at, created_at, now()) where invited_at is null;
alter table public.meeting_members alter column invited_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meeting_members_status_check'
      and conrelid = 'public.meeting_members'::regclass
  ) then
    alter table public.meeting_members
      add constraint meeting_members_status_check
      check (status in ('pending','joined','declined','left'));
  end if;
end $$;

create index if not exists meeting_members_status_idx
  on public.meeting_members(meeting_id, status, last_seen_at);

-- Somente quem efetivamente entrou na sala pode usar o canal privado WebRTC.
create or replace function public.can_access_meeting_realtime(p_topic text, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.meetings m
    join public.meeting_members mm on mm.meeting_id = m.id
    where m.id = public.safe_topic_meeting_id(p_topic)
      and m.ended_at is null
      and mm.user_id = p_user_id
      and mm.status = 'joined'
  );
$$;

-- Cria a sala, deixa apenas o criador dentro dela e convida os demais.
create or replace function public.create_meeting(
  p_title text,
  p_member_ids uuid[],
  p_mode text,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_id uuid;
  v_title text := coalesce(nullif(btrim(p_title),''),'Reunião');
  v_recipient uuid;
begin
  if v_workspace is null or auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_mode not in ('audio','video') then raise exception 'Modo inválido'; end if;

  if p_conversation_id is not null then
    if not public.is_conversation_member(p_conversation_id) then raise exception 'Você não participa desta conversa'; end if;
    if public.conversation_workspace_id(p_conversation_id) is distinct from v_workspace then raise exception 'Conversa inválida para este workspace'; end if;

    select id into v_id
    from public.meetings
    where conversation_id = p_conversation_id and ended_at is null
    order by created_at desc limit 1;

    if v_id is not null then
      perform public.join_meeting(v_id);
      return v_id;
    end if;
  end if;

  begin
    insert into public.meetings(workspace_id,conversation_id,title,mode,created_by)
    values(v_workspace,p_conversation_id,v_title,p_mode::public.meeting_mode,auth.uid())
    returning id into v_id;
  exception when unique_violation then
    if p_conversation_id is not null then
      select id into v_id
      from public.meetings
      where conversation_id = p_conversation_id and ended_at is null
      order by created_at desc limit 1;
      if v_id is not null then
        perform public.join_meeting(v_id);
        return v_id;
      end if;
    end if;
    raise;
  end;

  if p_conversation_id is not null then
    insert into public.meeting_members(
      meeting_id,user_id,status,invited_at,answered_at,joined_at,last_seen_at
    )
    select
      v_id,
      cm.user_id,
      case when cm.user_id = auth.uid() then 'joined' else 'pending' end,
      now(),
      case when cm.user_id = auth.uid() then now() else null end,
      case when cm.user_id = auth.uid() then now() else null end,
      case when cm.user_id = auth.uid() then now() else null end
    from public.chat_members cm
    where cm.conversation_id = p_conversation_id
    on conflict(meeting_id,user_id) do update set
      status = excluded.status,
      invited_at = excluded.invited_at,
      answered_at = excluded.answered_at,
      joined_at = excluded.joined_at,
      left_at = null,
      last_seen_at = excluded.last_seen_at;
  else
    insert into public.meeting_members(
      meeting_id,user_id,status,invited_at,answered_at,joined_at,last_seen_at
    )
    select
      v_id,
      x.user_id,
      case when x.user_id = auth.uid() then 'joined' else 'pending' end,
      now(),
      case when x.user_id = auth.uid() then now() else null end,
      case when x.user_id = auth.uid() then now() else null end,
      case when x.user_id = auth.uid() then now() else null end
    from (
      select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id
    ) x
    where public.is_workspace_member(v_workspace,x.user_id)
    on conflict(meeting_id,user_id) do update set
      status = excluded.status,
      invited_at = excluded.invited_at,
      answered_at = excluded.answered_at,
      joined_at = excluded.joined_at,
      left_at = null,
      last_seen_at = excluded.last_seen_at;
  end if;

  if (select count(*) from public.meeting_members where meeting_id = v_id) < 2 then
    raise exception 'A reunião precisa de pelo menos dois participantes';
  end if;

  for v_recipient in
    select user_id
    from public.meeting_members
    where meeting_id = v_id
      and user_id <> auth.uid()
      and status = 'pending'
  loop
    insert into public.notifications(
      workspace_id,recipient_id,actor_id,type,title,description,meeting_id
    ) values (
      v_workspace,
      v_recipient,
      auth.uid(),
      'meeting-invite',
      case when p_mode='video' then 'Chamada de vídeo recebida' else 'Chamada de áudio recebida' end,
      v_title,
      v_id
    );
  end loop;

  return v_id;
end;
$$;

create or replace function public.answer_meeting_invite(p_meeting_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_member public.meeting_members%rowtype;
  v_now timestamptz := now();
  v_status text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if not found then raise exception 'Reunião não encontrada'; end if;
  if v_meeting.ended_at is not null then raise exception 'Esta reunião já foi encerrada'; end if;

  select * into v_member
  from public.meeting_members
  where meeting_id = p_meeting_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Você não foi convidado para esta reunião'; end if;

  if p_accept then
    v_status := 'joined';
    update public.meeting_members
    set status='joined',
        answered_at=coalesce(answered_at,v_now),
        joined_at=v_now,
        left_at=null,
        last_seen_at=v_now
    where meeting_id=p_meeting_id and user_id=auth.uid();
  else
    v_status := 'declined';
    update public.meeting_members
    set status='declined',
        answered_at=coalesce(answered_at,v_now),
        left_at=v_now,
        last_seen_at=null
    where meeting_id=p_meeting_id and user_id=auth.uid();
  end if;

  update public.notifications
  set read_at=coalesce(read_at,v_now)
  where recipient_id=auth.uid()
    and meeting_id=p_meeting_id
    and type='meeting-invite';

  update public.meetings set updated_at=v_now where id=p_meeting_id;

  if not p_accept and not exists (
    select 1 from public.meeting_members
    where meeting_id=p_meeting_id and status='joined'
  ) then
    update public.meetings set ended_at=v_now,updated_at=v_now where id=p_meeting_id and ended_at is null;
  end if;

  return v_status;
end;
$$;

create or replace function public.join_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not exists(select 1 from public.meetings where id=p_meeting_id and ended_at is null) then
    raise exception 'Esta reunião não está mais ativa';
  end if;
  if not exists(select 1 from public.meeting_members where meeting_id=p_meeting_id and user_id=auth.uid()) then
    raise exception 'Você não participa desta reunião';
  end if;

  update public.meeting_members
  set status='joined',
      answered_at=coalesce(answered_at,v_now),
      joined_at=v_now,
      left_at=null,
      last_seen_at=v_now
  where meeting_id=p_meeting_id and user_id=auth.uid();

  update public.notifications
  set read_at=coalesce(read_at,v_now)
  where recipient_id=auth.uid() and meeting_id=p_meeting_id and type='meeting-invite';

  update public.meetings set updated_at=v_now where id=p_meeting_id;
end;
$$;

create or replace function public.heartbeat_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.meeting_members mm
  set last_seen_at=now()
  from public.meetings m
  where mm.meeting_id=p_meeting_id
    and mm.user_id=auth.uid()
    and mm.status='joined'
    and m.id=mm.meeting_id
    and m.ended_at is null;
end;
$$;

create or replace function public.leave_meeting(p_meeting_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_ended boolean := false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  -- Serializa saídas simultâneas. Sem esse lock, dois últimos participantes
  -- poderiam sair ao mesmo tempo e ambos ainda enxergarem o outro como joined.
  perform 1 from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'Reunião não encontrada'; end if;

  update public.meeting_members
  set status='left',left_at=v_now,last_seen_at=null
  where meeting_id=p_meeting_id and user_id=auth.uid() and status='joined';

  if not exists (
    select 1 from public.meeting_members
    where meeting_id=p_meeting_id and status='joined'
  ) then
    update public.meetings
    set ended_at=coalesce(ended_at,v_now),updated_at=v_now
    where id=p_meeting_id and ended_at is null;
    v_ended := found;
    if v_ended then
      update public.notifications
      set read_at=coalesce(read_at,v_now)
      where meeting_id=p_meeting_id and type='meeting-invite';
    end if;
  else
    update public.meetings set updated_at=v_now where id=p_meeting_id and ended_at is null;
  end if;

  return v_ended;
end;
$$;

create or replace function public.end_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.meetings%rowtype; v_now timestamptz:=now();
begin
  select * into v from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'Reunião não encontrada'; end if;
  if v.ended_at is not null then return; end if;
  if v.created_by<>auth.uid() and not public.is_workspace_admin(v.workspace_id) then
    raise exception 'Somente o criador ou administrador pode encerrar a reunião';
  end if;

  update public.meeting_members
  set status=case when status='joined' then 'left' else status end,
      left_at=case when status='joined' then v_now else left_at end,
      last_seen_at=null
  where meeting_id=p_meeting_id;

  update public.meetings set ended_at=v_now,updated_at=v_now where id=p_meeting_id;
  update public.notifications
  set read_at=coalesce(read_at,v_now)
  where meeting_id=p_meeting_id and type='meeting-invite';
end;
$$;

-- Recupera salas abandonadas quando o navegador fecha sem conseguir enviar o RPC de saída.
create or replace function public.close_abandoned_meetings()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer := 0;
begin
  update public.meeting_members mm
  set status='left',left_at=coalesce(left_at,now()),last_seen_at=null
  from public.meetings m
  where m.id=mm.meeting_id
    and m.ended_at is null
    and mm.status='joined'
    and coalesce(mm.last_seen_at,mm.joined_at,mm.created_at) < now() - interval '3 minutes';

  with ended as (
    update public.meetings m
    set ended_at=now(),updated_at=now()
    where m.ended_at is null
      and not exists (
        select 1 from public.meeting_members mm
        where mm.meeting_id=m.id and mm.status='joined'
      )
    returning 1
  )
  select count(*) into v_count from ended;

  update public.notifications n
  set read_at=coalesce(n.read_at,now())
  where n.type='meeting-invite'
    and n.meeting_id is not null
    and exists(select 1 from public.meetings m where m.id=n.meeting_id and m.ended_at is not null);

  return v_count;
end;
$$;

-- Segurança e acesso às novas RPCs.
revoke execute on function public.answer_meeting_invite(uuid,boolean) from public,anon;
revoke execute on function public.join_meeting(uuid) from public,anon;
revoke execute on function public.heartbeat_meeting(uuid) from public,anon;
revoke execute on function public.leave_meeting(uuid) from public,anon;
revoke execute on function public.close_abandoned_meetings() from public,anon,authenticated;

grant execute on function public.answer_meeting_invite(uuid,boolean) to authenticated;
grant execute on function public.join_meeting(uuid) to authenticated;
grant execute on function public.heartbeat_meeting(uuid) to authenticated;
grant execute on function public.leave_meeting(uuid) to authenticated;

-- create_meeting/end_meeting já existiam e são recriadas acima; reafirma os grants.
revoke execute on function public.create_meeting(text,uuid[],text,uuid) from public,anon;
revoke execute on function public.end_meeting(uuid) from public,anon;
grant execute on function public.create_meeting(text,uuid[],text,uuid) to authenticated;
grant execute on function public.end_meeting(uuid) to authenticated;

-- Tenta habilitar o reconciliador automático de salas abandonadas. O fluxo normal
-- encerra imediatamente via leave_meeting; este job é a proteção para crash/rede.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron não pôde ser habilitado automaticamente. Ative Supabase Cron para a reconciliação de salas abandonadas.';
  end;

  if exists(select 1 from pg_namespace where nspname='cron') then
    begin
      perform cron.unschedule('devboard-close-abandoned-meetings');
    exception when others then null;
    end;
    perform cron.schedule(
      'devboard-close-abandoned-meetings',
      '* * * * *',
      'select public.close_abandoned_meetings();'
    );
  end if;
end $$;

commit;
