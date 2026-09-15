-- TaskBoard V143 · fallback confiável de sinalização WebRTC
-- Execute após 089_taskboard_share_inbox_fallback.sql.
--
-- O Supabase Realtime Broadcast continua sendo o caminho principal da chamada.
-- Esta tabela é somente um fallback curto/deduplicado para offer/answer/ICE quando
-- um Broadcast se perde durante entrada, reconexão ou troca de rede.

begin;

create table if not exists public.meeting_webrtc_signals (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  signal_key text not null,
  from_user_id uuid not null,
  from_session text not null,
  to_session text not null,
  signal_type text not null,
  sdp jsonb,
  candidate jsonb,
  created_at timestamptz not null default now(),
  constraint meeting_webrtc_signals_key_unique unique (signal_key),
  constraint meeting_webrtc_signals_type_check check (
    signal_type in ('offer','answer','ice','restart-request','ready')
  ),
  constraint meeting_webrtc_signals_sessions_check check (
    length(from_session) between 8 and 160
    and length(to_session) between 8 and 160
  )
);

create index if not exists meeting_webrtc_signals_receiver_idx
  on public.meeting_webrtc_signals(meeting_id, to_session, id);

create index if not exists meeting_webrtc_signals_created_idx
  on public.meeting_webrtc_signals(created_at);

alter table public.meeting_webrtc_signals enable row level security;

-- O cliente não acessa a tabela diretamente. Toda validação passa pelas RPCs
-- SECURITY DEFINER abaixo, que exigem status=joined na reunião.
revoke all on public.meeting_webrtc_signals from public, anon, authenticated;

create or replace function public.meeting_webrtc_signal_send(
  p_meeting_id uuid,
  p_signal_key text,
  p_from_session text,
  p_to_session text,
  p_signal_type text,
  p_sdp jsonb default null,
  p_candidate jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_meeting_id is null
     or nullif(btrim(p_signal_key),'') is null
     or nullif(btrim(p_from_session),'') is null
     or nullif(btrim(p_to_session),'') is null
     or p_signal_type not in ('offer','answer','ice','restart-request','ready') then
    raise exception 'Sinal WebRTC inválido';
  end if;

  if not exists (
    select 1
      from public.meetings m
      join public.meeting_members mm on mm.meeting_id = m.id
     where m.id = p_meeting_id
       and m.ended_at is null
       and mm.user_id = auth.uid()
       and mm.status = 'joined'
  ) then
    raise exception 'Entre na reunião antes de sinalizar a mídia';
  end if;

  insert into public.meeting_webrtc_signals(
    meeting_id, signal_key, from_user_id, from_session, to_session,
    signal_type, sdp, candidate
  ) values (
    p_meeting_id, btrim(p_signal_key), auth.uid(), btrim(p_from_session),
    btrim(p_to_session), p_signal_type, p_sdp, p_candidate
  )
  on conflict (signal_key) do nothing
  returning id into v_id;

  if v_id is null then
    select s.id into v_id
      from public.meeting_webrtc_signals s
     where s.signal_key = btrim(p_signal_key)
       and s.meeting_id = p_meeting_id
       and s.from_user_id = auth.uid();
  end if;

  -- Limpeza oportunista: sinais são efêmeros e não fazem parte do histórico.
  delete from public.meeting_webrtc_signals
   where created_at < now() - interval '15 minutes';

  return v_id;
end;
$$;

create or replace function public.meeting_webrtc_signal_pull(
  p_meeting_id uuid,
  p_to_session text,
  p_after_id bigint default 0
)
returns table (
  id bigint,
  signal_key text,
  signal_type text,
  from_session text,
  from_user_id uuid,
  to_session text,
  sdp jsonb,
  candidate jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_meeting_id is null or nullif(btrim(p_to_session),'') is null then
    raise exception 'Destino WebRTC inválido';
  end if;

  if not exists (
    select 1
      from public.meetings m
      join public.meeting_members mm on mm.meeting_id = m.id
     where m.id = p_meeting_id
       and m.ended_at is null
       and mm.user_id = auth.uid()
       and mm.status = 'joined'
  ) then
    raise exception 'Entre na reunião antes de receber mídia';
  end if;

  return query
  select
    s.id,
    s.signal_key,
    s.signal_type,
    s.from_session,
    s.from_user_id,
    s.to_session,
    s.sdp,
    s.candidate,
    s.created_at
  from public.meeting_webrtc_signals s
  where s.meeting_id = p_meeting_id
    and s.to_session = btrim(p_to_session)
    and s.id > greatest(coalesce(p_after_id,0),0)
    and s.created_at >= now() - interval '15 minutes'
  order by s.id
  limit 200;
end;
$$;

revoke all on function public.meeting_webrtc_signal_send(uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.meeting_webrtc_signal_pull(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.meeting_webrtc_signal_send(uuid,text,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.meeting_webrtc_signal_pull(uuid,text,bigint) to authenticated;

commit;
