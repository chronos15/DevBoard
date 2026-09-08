-- Devboard · V46 · Reunião persistente + chat contextual completo
-- Execute após 053_devboard_share_following_notifications.sql.
--
-- Esta migration:
--  * preserva o contexto exato que originou a reunião (subatividade/solicitação/AQS);
--  * permite convidar/mencionar usuários durante a reunião e incluí-los no contexto;
--  * adiciona reações às mensagens do chat;
--  * mantém as regras de compartilhamento AQS coerentes com participantes adicionados.

begin;

-- ---------------------------------------------------------------------------
-- Contexto exato da reunião
-- ---------------------------------------------------------------------------
alter table public.activity_meeting_runs
  add column if not exists subactivity_id uuid references public.subactivities(id) on delete set null,
  add column if not exists aqs_review_id uuid references public.aqs_reviews(id) on delete set null;

create index if not exists activity_meeting_runs_subactivity_idx
  on public.activity_meeting_runs(subactivity_id,created_at desc)
  where subactivity_id is not null;

create index if not exists activity_meeting_runs_aqs_review_idx
  on public.activity_meeting_runs(aqs_review_id,created_at desc)
  where aqs_review_id is not null;

-- Colaboradores explícitos de uma análise AQS. Não substitui assigned_aqs_id;
-- representa quem foi puxado para acompanhar/colaborar naquela análise.
create table if not exists public.aqs_review_participants (
  review_id uuid not null references public.aqs_reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(review_id,user_id)
);

create index if not exists aqs_review_participants_user_idx
  on public.aqs_review_participants(user_id,review_id);

alter table public.aqs_review_participants enable row level security;
alter table public.aqs_review_participants replica identity full;

drop policy if exists devboard_aqs_review_participants_select on public.aqs_review_participants;
create policy devboard_aqs_review_participants_select
  on public.aqs_review_participants for select to authenticated
  using (
    exists(
      select 1
      from public.aqs_reviews ar
      where ar.id=review_id
        and public.is_workspace_member(ar.workspace_id)
    )
  );

revoke all on public.aqs_review_participants from anon,authenticated;
grant select on public.aqs_review_participants to authenticated;

-- A versão anterior inferia automaticamente a solicitação mais recente da atividade.
-- Isso fica ambíguo quando a mesma atividade possui reunião iniciada pela subatividade
-- ou por uma análise AQS. A partir da V46 o contexto exato é aplicado pelo wrapper
-- start_context_meeting; reuniões abertas pelo Chat continuam apenas no nível da atividade.
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

  insert into public.activity_meeting_runs(meeting_id,activity_id,project_id,request_id)
  values(p_meeting_id,v_activity,v_project,null)
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
end;
$$;

revoke execute on function public.register_activity_meeting_start(uuid) from public,anon,authenticated;

-- Wrapper contextual. Mantém start_activity_meeting intacta para clientes antigos.
create or replace function public.start_context_meeting(
  p_activity_id uuid,
  p_mode text default 'video',
  p_subactivity_id uuid default null,
  p_request_id uuid default null,
  p_aqs_review_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_launch jsonb;
  v_meeting_id uuid;
  v_review_subactivity uuid;
  v_effective_subactivity uuid:=p_subactivity_id;
  v_context_assigned boolean:=false;
  v_names text;
  v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  if p_subactivity_id is not null and not exists(
    select 1 from public.subactivities s
    where s.id=p_subactivity_id and s.activity_id=p_activity_id
  ) then
    raise exception 'A subatividade não pertence a esta atividade';
  end if;

  if p_request_id is not null and not exists(
    select 1 from public.service_requests r
    where r.id=p_request_id and r.activity_id=p_activity_id
  ) then
    raise exception 'A solicitação não pertence a esta atividade';
  end if;

  if p_aqs_review_id is not null then
    select ar.subactivity_id into v_review_subactivity
    from public.aqs_reviews ar
    where ar.id=p_aqs_review_id and ar.activity_id=p_activity_id;
    if v_review_subactivity is null then
      raise exception 'A análise AQS não pertence a esta atividade';
    end if;
    if v_effective_subactivity is null then v_effective_subactivity:=v_review_subactivity; end if;
    if v_effective_subactivity is distinct from v_review_subactivity then
      raise exception 'A análise AQS não pertence à subatividade informada';
    end if;
  end if;

  v_launch:=public.start_activity_meeting(p_activity_id,p_mode);
  begin
    v_meeting_id:=(v_launch->>'meetingId')::uuid;
  exception when others then
    raise exception 'A reunião foi criada sem identificador válido';
  end;

  -- Uma reunião ativa é reutilizada por atividade. O primeiro contexto específico
  -- que a originou permanece como contexto canônico; abrir a mesma sala por outro
  -- ponto do sistema não troca silenciosamente suas permissões.
  update public.activity_meeting_runs
  set subactivity_id=v_effective_subactivity,
      request_id=p_request_id,
      aqs_review_id=p_aqs_review_id
  where meeting_id=v_meeting_id
    and subactivity_id is null
    and request_id is null
    and aqs_review_id is null;
  get diagnostics v_count = row_count;
  v_context_assigned:=v_count>0;

  if v_context_assigned and p_request_id is not null then
    select count(*),string_agg(p.name,', ' order by p.name)
      into v_count,v_names
    from public.meeting_members mm
    join public.profiles p on p.id=mm.user_id
    where mm.meeting_id=v_meeting_id;

    perform public.service_request_add_event(
      p_request_id,
      'technical-meeting-started',
      'Ligação de reunião iniciada',
      format('%s convidado%s: %s.',v_count,case when v_count=1 then '' else 's' end,coalesce(v_names,'—')),
      null,
      null,
      auth.uid()
    );
  end if;

  return v_launch || jsonb_build_object(
    'subactivityId',v_effective_subactivity,
    'requestId',p_request_id,
    'aqsReviewId',p_aqs_review_id
  );
end;
$$;

revoke execute on function public.start_context_meeting(uuid,text,uuid,uuid,uuid) from public,anon;
grant execute on function public.start_context_meeting(uuid,text,uuid,uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Adicionar/chamar usuário durante uma reunião
-- ---------------------------------------------------------------------------
create or replace function public.meeting_invite_user(
  p_meeting_id uuid,
  p_user_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_context public.activity_meeting_runs%rowtype;
  v_existing_status text;
  v_role text;
  v_context_label text:='reunião';
  v_subactivity uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_meeting_id is null or p_user_id is null then raise exception 'Usuário ou reunião não informado'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found or v_meeting.ended_at is not null then raise exception 'Esta reunião já foi encerrada'; end if;
  if not public.is_workspace_member(v_meeting.workspace_id,p_user_id) then
    raise exception 'Este usuário não pertence ao workspace';
  end if;

  v_role:=public.workspace_role_of(v_meeting.workspace_id,auth.uid())::text;
  if v_role<>'admin' and not exists(
    select 1 from public.meeting_members mm
    where mm.meeting_id=p_meeting_id and mm.user_id=auth.uid() and mm.status='joined'
  ) then
    raise exception 'Somente participantes da reunião podem chamar outras pessoas';
  end if;

  select * into v_context
  from public.activity_meeting_runs
  where meeting_id=p_meeting_id;

  if found then
    -- Todo convidado contextual passa a fazer parte do projeto para conseguir
    -- navegar no trabalho depois da chamada.
    insert into public.project_members(project_id,user_id,added_by)
    values(v_context.project_id,p_user_id,auth.uid())
    on conflict(project_id,user_id) do nothing;

    if v_context.request_id is not null then
      insert into public.service_request_participants as srp(request_id,user_id,source,added_by)
      values(v_context.request_id,p_user_id,'mention',auth.uid())
      on conflict(request_id,user_id) do update
        set source=case
          when srp.source in ('creator','aqs','dev','executor')
            then srp.source
          else 'mention'
        end,
        added_by=coalesce(srp.added_by,excluded.added_by);
      v_context_label:='solicitação';
    end if;

    if v_context.aqs_review_id is not null then
      select ar.subactivity_id into v_subactivity
      from public.aqs_reviews ar where ar.id=v_context.aqs_review_id;

      insert into public.aqs_review_participants(review_id,user_id,added_by)
      values(v_context.aqs_review_id,p_user_id,auth.uid())
      on conflict(review_id,user_id) do nothing;

      if v_subactivity is not null then
        insert into public.subactivity_members(subactivity_id,user_id,added_by)
        values(v_subactivity,p_user_id,auth.uid())
        on conflict(subactivity_id,user_id) do nothing;
      end if;
      v_context_label:='análise AQS';
    elsif v_context.subactivity_id is not null then
      insert into public.subactivity_members(subactivity_id,user_id,added_by)
      values(v_context.subactivity_id,p_user_id,auth.uid())
      on conflict(subactivity_id,user_id) do nothing;
      if v_context.request_id is null then v_context_label:='subatividade'; end if;
    elsif v_context.request_id is null then
      -- Reunião iniciada diretamente na atividade: o usuário passa a acompanhá-la.
      insert into public.activity_assignees(activity_id,user_id)
      values(v_context.activity_id,p_user_id)
      on conflict(activity_id,user_id) do nothing;
      v_context_label:='atividade';
    end if;
  end if;

  if v_meeting.conversation_id is not null then
    insert into public.chat_members(conversation_id,user_id)
    values(v_meeting.conversation_id,p_user_id)
    on conflict(conversation_id,user_id) do nothing;
  end if;

  select mm.status::text into v_existing_status
  from public.meeting_members mm
  where mm.meeting_id=p_meeting_id and mm.user_id=p_user_id;

  if v_existing_status='joined' then
    return jsonb_build_object('status','joined','context',v_context_label,'alreadyJoined',true);
  end if;

  -- Menções sempre passam por esta RPC para garantir o vínculo com o contexto,
  -- mas não devem tocar novamente se o usuário já recebeu um convite pendente.
  -- O botão explícito de telefone usa p_force=true para rechamar.
  if v_existing_status='pending' and not coalesce(p_force,false) then
    return jsonb_build_object('status','pending','context',v_context_label,'alreadyPending',true);
  end if;

  insert into public.meeting_members(
    meeting_id,user_id,status,invited_at,answered_at,joined_at,left_at,last_seen_at
  ) values(
    p_meeting_id,p_user_id,'pending',now(),null,null,null,null
  )
  on conflict(meeting_id,user_id) do update set
    status='pending',
    invited_at=now(),
    answered_at=null,
    joined_at=null,
    left_at=null,
    last_seen_at=null;

  -- Rechamar substitui o convite pendente anterior para não poluir a central.
  delete from public.notifications
  where recipient_id=p_user_id
    and meeting_id=p_meeting_id
    and type='meeting-invite'
    and read_at is null;

  insert into public.notifications(
    workspace_id,recipient_id,actor_id,type,title,description,meeting_id,conversation_id
  ) values(
    v_meeting.workspace_id,
    p_user_id,
    auth.uid(),
    'meeting-invite',
    case when v_meeting.mode='video' then 'Chamada de vídeo recebida' else 'Chamada de áudio recebida' end,
    v_meeting.title,
    p_meeting_id,
    v_meeting.conversation_id
  );

  update public.meetings set updated_at=now() where id=p_meeting_id;

  return jsonb_build_object(
    'status','pending',
    'context',v_context_label,
    'alreadyJoined',false
  );
end;
$$;

revoke execute on function public.meeting_invite_user(uuid,uuid,boolean) from public,anon;
grant execute on function public.meeting_invite_user(uuid,uuid,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Reações no chat (uma reação ativa por usuário/mensagem, igual ao Acompanhamento)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check(length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

create index if not exists chat_message_reactions_user_idx
  on public.chat_message_reactions(user_id,created_at desc);

alter table public.chat_message_reactions enable row level security;
alter table public.chat_message_reactions replica identity full;

drop policy if exists devboard_chat_message_reactions_select on public.chat_message_reactions;
create policy devboard_chat_message_reactions_select
  on public.chat_message_reactions for select to authenticated
  using (
    exists(
      select 1
      from public.chat_messages m
      where m.id=message_id
        and public.can_read_chat_message(m.conversation_id,m.created_at)
    )
  );

revoke all on public.chat_message_reactions from anon,authenticated;
grant select on public.chat_message_reactions to authenticated;

create or replace function public.set_chat_message_reaction(
  p_message_id uuid,
  p_emoji text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_message public.chat_messages%rowtype;
  v_emoji text:=nullif(btrim(coalesce(p_emoji,'')),'');
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_message
  from public.chat_messages
  where id=p_message_id;
  if not found or not public.can_read_chat_message(v_message.conversation_id,v_message.created_at) then
    raise exception 'Mensagem indisponível';
  end if;
  if not public.is_conversation_member(v_message.conversation_id) then
    raise exception 'Você não participa desta conversa';
  end if;

  if v_emoji is null then
    delete from public.chat_message_reactions
    where message_id=p_message_id and user_id=auth.uid();
    return;
  end if;

  if v_emoji not in ('👍','❤️','😂','🎉','👀','✅') then
    raise exception 'Reação inválida';
  end if;

  insert into public.chat_message_reactions(message_id,user_id,emoji)
  values(p_message_id,auth.uid(),v_emoji)
  on conflict(message_id,user_id) do update
    set emoji=excluded.emoji,created_at=now();
end;
$$;

revoke execute on function public.set_chat_message_reaction(uuid,text) from public,anon;
grant execute on function public.set_chat_message_reaction(uuid,text) to authenticated;

-- Usuários puxados para uma análise passam a ser colaboradores reais também no
-- compartilhamento PWA da V45.
create or replace function public.can_contribute_aqs_review(p_review_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v public.aqs_reviews%rowtype;
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  select * into v from public.aqs_reviews where id=p_review_id;
  if not found or v.status not in ('awaiting','evaluating') then return false; end if;
  if not public.is_workspace_member(v.workspace_id) then return false; end if;
  v_role:=public.workspace_role_of(v.workspace_id,auth.uid());
  if v_role='admin' then return true; end if;
  return v.assigned_aqs_id=auth.uid()
    or v.created_by=auth.uid()
    or exists(select 1 from public.aqs_review_participants arp where arp.review_id=v.id and arp.user_id=auth.uid())
    or exists(select 1 from public.subactivities s where s.id=v.subactivity_id and s.assignee_id=auth.uid())
    or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=v.subactivity_id and sm.user_id=auth.uid());
end;
$$;

revoke execute on function public.can_contribute_aqs_review(uuid) from public,anon;
grant execute on function public.can_contribute_aqs_review(uuid) to authenticated;

-- Realtime para atualização imediata de convite/contexto/reação.
do $$ begin
  alter publication supabase_realtime add table public.aqs_review_participants;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.chat_message_reactions;
exception when duplicate_object then null; end $$;

commit;
