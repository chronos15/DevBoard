-- Devboard · Reuniões contextuais V36
-- Um único grupo de chat é reutilizado por atividade. Reuniões iniciadas pelo
-- Acompanhamento, Solicitações, Análise AQS ou pelo próprio grupo do Chat usam
-- a mesma conversa, convidam os participantes atuais do trabalho e registram
-- início/fim no histórico técnico e no protocolo vinculado.

begin;

create table if not exists public.activity_meeting_groups (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null unique references public.chat_conversations(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activity_meeting_groups_workspace_idx
  on public.activity_meeting_groups(workspace_id,updated_at desc);

create table if not exists public.activity_meeting_runs (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid references public.service_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_meeting_runs_activity_idx
  on public.activity_meeting_runs(activity_id,created_at desc);

create or replace function public.sync_activity_meeting_group_name()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if old.title is distinct from new.title then
    update public.chat_conversations c
    set name=new.title,updated_at=now()
    from public.activity_meeting_groups g
    where g.activity_id=new.id and c.id=g.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists activity_meeting_group_name_sync on public.activities;
create trigger activity_meeting_group_name_sync
after update of title on public.activities
for each row
when (old.title is distinct from new.title)
execute procedure public.sync_activity_meeting_group_name();

alter table public.activity_meeting_groups enable row level security;
alter table public.activity_meeting_runs enable row level security;

-- As tabelas acima são de infraestrutura. O cliente não precisa lê-las
-- diretamente; toda a operação passa pelas RPCs security definer abaixo.
revoke all on public.activity_meeting_groups,public.activity_meeting_runs from anon,authenticated;

create or replace function public.activity_meeting_participants(p_activity_id uuid)
returns table(user_id uuid)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with activity_scope as (
    select a.id,a.project_id,p.workspace_id
    from public.activities a
    join public.projects p on p.id=a.project_id
    where a.id=p_activity_id
  ), candidates as (
    select aa.user_id
    from public.activity_assignees aa
    where aa.activity_id=p_activity_id

    union
    select s.assignee_id
    from public.subactivities s
    where s.activity_id=p_activity_id

    union
    select sm.user_id
    from public.subactivity_members sm
    join public.subactivities s on s.id=sm.subactivity_id
    where s.activity_id=p_activity_id

    union
    select ar.assigned_aqs_id
    from public.aqs_reviews ar
    join public.subactivities s on s.id=ar.subactivity_id
    where s.activity_id=p_activity_id and ar.assigned_aqs_id is not null

    union
    select sr.created_by
    from public.service_requests sr
    where sr.activity_id=p_activity_id

    union
    select sr.assigned_aqs_id
    from public.service_requests sr
    where sr.activity_id=p_activity_id and sr.assigned_aqs_id is not null

    union
    select sr.responsible_dev_id
    from public.service_requests sr
    where sr.activity_id=p_activity_id and sr.responsible_dev_id is not null

    union
    select sr.executor_id
    from public.service_requests sr
    where sr.activity_id=p_activity_id and sr.executor_id is not null

    union
    select srp.user_id
    from public.service_request_participants srp
    join public.service_requests sr on sr.id=srp.request_id
    where sr.activity_id=p_activity_id
  )
  select distinct c.user_id
  from candidates c
  join activity_scope scope on true
  join public.workspace_members wm
    on wm.workspace_id=scope.workspace_id
   and wm.user_id=c.user_id
   and wm.active
  where c.user_id is not null;
$$;

create or replace function public.format_meeting_duration(p_seconds bigint)
returns text
language plpgsql
immutable
as $$
declare
  v_seconds bigint:=greatest(coalesce(p_seconds,0),0);
  v_hours bigint;
  v_minutes bigint;
  v_rest bigint;
begin
  v_hours:=v_seconds/3600;
  v_minutes:=(v_seconds%3600)/60;
  v_rest:=v_seconds%60;
  if v_hours>0 then
    return format('%sh %smin %ss',v_hours,lpad(v_minutes::text,2,'0'),lpad(v_rest::text,2,'0'));
  end if;
  if v_minutes>0 then
    return format('%smin %ss',v_minutes,lpad(v_rest::text,2,'0'));
  end if;
  return format('%ss',v_rest);
end;
$$;

create or replace function public.register_activity_meeting_start(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_activity uuid;
  v_project uuid;
  v_request uuid;
  v_names text;
  v_count integer:=0;
  v_description text;
  v_inserted boolean:=false;
begin
  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found or v_meeting.conversation_id is null then return; end if;

  select g.activity_id,a.project_id
    into v_activity,v_project
  from public.activity_meeting_groups g
  join public.activities a on a.id=g.activity_id
  where g.conversation_id=v_meeting.conversation_id;
  if v_activity is null then return; end if;

  select sr.id into v_request
  from public.service_requests sr
  where sr.activity_id=v_activity
  order by sr.created_at desc
  limit 1;

  insert into public.activity_meeting_runs(meeting_id,activity_id,project_id,request_id)
  values(p_meeting_id,v_activity,v_project,v_request)
  on conflict(meeting_id) do nothing;
  get diagnostics v_count = row_count;
  v_inserted:=v_count>0;
  if not v_inserted then return; end if;

  select count(*),string_agg(p.name,', ' order by p.name)
    into v_count,v_names
  from public.meeting_members mm
  join public.profiles p on p.id=mm.user_id
  where mm.meeting_id=p_meeting_id;

  v_description:=format(
    '[[meeting-activity:%s]]%s convidado%s: %s.',
    v_activity,
    v_count,
    case when v_count=1 then '' else 's' end,
    coalesce(v_names,'—')
  );

  perform public.add_project_log(
    v_project,
    'meeting-started',
    'Ligação de reunião iniciada',
    v_description,
    v_meeting.created_by
  );

  if v_request is not null then
    perform public.service_request_add_event(
      v_request,
      'technical-meeting-started',
      'Ligação de reunião iniciada',
      format('%s convidado%s: %s.',v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      v_meeting.created_by
    );
  end if;
end;
$$;

create or replace function public.log_activity_meeting_end()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_context public.activity_meeting_runs%rowtype;
  v_names text;
  v_count integer:=0;
  v_seconds bigint;
  v_duration text;
  v_description text;
begin
  if old.ended_at is not null or new.ended_at is null then return new; end if;

  select * into v_context
  from public.activity_meeting_runs
  where meeting_id=new.id;
  if not found then return new; end if;

  select count(*),string_agg(p.name,', ' order by p.name)
    into v_count,v_names
  from public.meeting_members mm
  join public.profiles p on p.id=mm.user_id
  where mm.meeting_id=new.id
    and mm.joined_at is not null;

  v_seconds:=greatest(0,extract(epoch from (new.ended_at-new.created_at))::bigint);
  v_duration:=public.format_meeting_duration(v_seconds);
  v_description:=format(
    '[[meeting-activity:%s]]Duração %s · %s participante%s: %s.',
    v_context.activity_id,
    v_duration,
    v_count,
    case when v_count=1 then '' else 's' end,
    coalesce(v_names,'—')
  );

  perform public.add_project_log(
    v_context.project_id,
    'meeting-ended',
    'Ligação de reunião encerrada',
    v_description,
    new.created_by
  );

  if v_context.request_id is not null then
    perform public.service_request_add_event(
      v_context.request_id,
      'technical-meeting-ended',
      'Ligação de reunião encerrada',
      format('Duração %s · %s participante%s: %s.',v_duration,v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      new.created_by
    );
  end if;

  return new;
end;
$$;

drop trigger if exists activity_meeting_end_log on public.meetings;
create trigger activity_meeting_end_log
after update of ended_at on public.meetings
for each row
when (old.ended_at is null and new.ended_at is not null)
execute procedure public.log_activity_meeting_end();

-- Recria a RPC padrão preservando todo o comportamento do Chat, mas quando a
-- conversa é o grupo contextual de uma atividade os convidados são calculados
-- a partir dos responsáveis/participantes atuais do trabalho.
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
  v_activity_id uuid;
begin
  if v_workspace is null or auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_mode not in ('audio','video') then raise exception 'Modo inválido'; end if;

  if p_conversation_id is not null then
    if not public.is_conversation_member(p_conversation_id) then raise exception 'Você não participa desta conversa'; end if;
    if public.conversation_workspace_id(p_conversation_id) is distinct from v_workspace then raise exception 'Conversa inválida para este workspace'; end if;

    select g.activity_id into v_activity_id
    from public.activity_meeting_groups g
    where g.conversation_id=p_conversation_id;

    if v_activity_id is not null then
      insert into public.chat_members(conversation_id,user_id)
      select p_conversation_id,x.user_id
      from (
        select distinct user_id from public.activity_meeting_participants(v_activity_id)
        union select auth.uid()
      ) x
      where public.is_workspace_member(v_workspace,x.user_id)
      on conflict(conversation_id,user_id) do nothing;
    end if;

    select id into v_id
    from public.meetings
    where conversation_id = p_conversation_id and ended_at is null
    order by created_at desc limit 1;

    if v_id is not null then
      if v_activity_id is not null then
        insert into public.meeting_members(
          meeting_id,user_id,status,invited_at,answered_at,joined_at,last_seen_at
        ) values (v_id,auth.uid(),'joined',now(),now(),now(),now())
        on conflict(meeting_id,user_id) do nothing;
      end if;
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
        if v_activity_id is not null then
          insert into public.meeting_members(
            meeting_id,user_id,status,invited_at,answered_at,joined_at,last_seen_at
          ) values (v_id,auth.uid(),'joined',now(),now(),now(),now())
          on conflict(meeting_id,user_id) do nothing;
        end if;
        perform public.join_meeting(v_id);
        return v_id;
      end if;
    end if;
    raise;
  end;

  if p_conversation_id is not null and v_activity_id is not null then
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
      select distinct user_id from public.activity_meeting_participants(v_activity_id)
      union select auth.uid()
    ) x
    where public.is_workspace_member(v_workspace,x.user_id)
    on conflict(meeting_id,user_id) do update set
      status = excluded.status,
      invited_at = excluded.invited_at,
      answered_at = excluded.answered_at,
      joined_at = excluded.joined_at,
      left_at = null,
      last_seen_at = excluded.last_seen_at;
  elsif p_conversation_id is not null then
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

  perform public.register_activity_meeting_start(v_id);
  return v_id;
end;
$$;

create or replace function public.start_activity_meeting(
  p_activity_id uuid,
  p_mode text default 'video'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_activity public.activities%rowtype;
  v_workspace uuid;
  v_conversation uuid;
  v_meeting uuid;
  v_member_count integer;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_mode not in ('audio','video') then raise exception 'Modo inválido'; end if;

  select a.* into v_activity
  from public.activities a
  where a.id=p_activity_id;
  if not found then raise exception 'Atividade não encontrada'; end if;

  v_workspace:=public.project_workspace_id(v_activity.project_id);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Você não possui acesso a esta atividade';
  end if;

  if not public.is_workspace_admin(v_workspace)
     and not exists(select 1 from public.project_members pm where pm.project_id=v_activity.project_id and pm.user_id=auth.uid())
     and not exists(select 1 from public.activity_assignees aa where aa.activity_id=p_activity_id and aa.user_id=auth.uid())
     and not exists(select 1 from public.subactivities s where s.activity_id=p_activity_id and s.assignee_id=auth.uid())
     and not exists(
       select 1
       from public.subactivity_members sm
       join public.subactivities s on s.id=sm.subactivity_id
       where s.activity_id=p_activity_id and sm.user_id=auth.uid()
     )
     and not exists(
       select 1
       from public.aqs_reviews ar
       join public.subactivities s on s.id=ar.subactivity_id
       where s.activity_id=p_activity_id and ar.assigned_aqs_id=auth.uid()
     )
     and not exists(
       select 1
       from public.service_requests sr
       left join public.service_request_participants srp on srp.request_id=sr.id and srp.user_id=auth.uid()
       where sr.activity_id=p_activity_id
         and (
           sr.created_by=auth.uid()
           or sr.assigned_aqs_id=auth.uid()
           or sr.responsible_dev_id=auth.uid()
           or sr.executor_id=auth.uid()
           or srp.user_id is not null
         )
     ) then
    raise exception 'Você não participa desta atividade';
  end if;

  select g.conversation_id into v_conversation
  from public.activity_meeting_groups g
  where g.activity_id=p_activity_id;

  if v_conversation is null then
    begin
      insert into public.chat_conversations(workspace_id,kind,name,created_by)
      values(v_workspace,'group',v_activity.title,auth.uid())
      returning id into v_conversation;

      insert into public.activity_meeting_groups(activity_id,workspace_id,conversation_id,created_by)
      values(p_activity_id,v_workspace,v_conversation,auth.uid());
    exception when unique_violation then
      select g.conversation_id into v_conversation
      from public.activity_meeting_groups g
      where g.activity_id=p_activity_id;
      if v_conversation is null then raise; end if;
    end;
  end if;

  update public.chat_conversations
  set name=v_activity.title,updated_at=now()
  where id=v_conversation;
  update public.activity_meeting_groups
  set updated_at=now()
  where activity_id=p_activity_id;

  -- Mantém o grupo como memória persistente do tópico. Participantes atuais são
  -- adicionados sem apagar quem já participou de reuniões anteriores.
  insert into public.chat_members(conversation_id,user_id)
  select v_conversation,x.user_id
  from (
    select distinct user_id from public.activity_meeting_participants(p_activity_id)
    union select auth.uid()
  ) x
  where public.is_workspace_member(v_workspace,x.user_id)
  on conflict(conversation_id,user_id) do nothing;

  select count(*) into v_member_count
  from (
    select distinct user_id from public.activity_meeting_participants(p_activity_id)
    union select auth.uid()
  ) x
  where public.is_workspace_member(v_workspace,x.user_id);

  if v_member_count<2 then
    raise exception 'Adicione pelo menos mais um participante à atividade antes de iniciar a reunião';
  end if;

  v_meeting:=public.create_meeting(
    v_activity.title,
    array(select user_id from public.activity_meeting_participants(p_activity_id)),
    p_mode,
    v_conversation
  );

  return jsonb_build_object(
    'meetingId',v_meeting,
    'conversationId',v_conversation,
    'participantCount',v_member_count
  );
end;
$$;


revoke execute on function public.activity_meeting_participants(uuid) from public,anon,authenticated;
revoke execute on function public.format_meeting_duration(bigint) from public,anon,authenticated;
revoke execute on function public.register_activity_meeting_start(uuid) from public,anon,authenticated;
revoke execute on function public.log_activity_meeting_end() from public,anon,authenticated;
revoke execute on function public.sync_activity_meeting_group_name() from public,anon,authenticated;
revoke execute on function public.start_activity_meeting(uuid,text) from public,anon;
revoke execute on function public.create_meeting(text,uuid[],text,uuid) from public,anon;

grant execute on function public.start_activity_meeting(uuid,text) to authenticated;
grant execute on function public.create_meeting(text,uuid[],text,uuid) to authenticated;

commit;
