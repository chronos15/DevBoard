-- V214 — encerramento visual imediato da reunião contextual.
-- A sala é encerrada para todos em uma RPC curta; gravação e PDF do chat podem
-- continuar sendo publicados pelo owner depois de meetings.ended_at ser preenchido.

begin;

create or replace function public.meeting_artifact_context(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_context public.activity_meeting_runs%rowtype;
  v_recording public.meeting_recordings%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found then raise exception 'Reunião não encontrada'; end if;

  if v_meeting.created_by<>auth.uid()
     and not public.is_workspace_admin(v_meeting.workspace_id)
     and not exists(
       select 1 from public.meeting_members mm
       where mm.meeting_id=p_meeting_id and mm.user_id=auth.uid()
     ) then
    raise exception 'Sem acesso a esta reunião';
  end if;

  select * into v_context from public.activity_meeting_runs where meeting_id=p_meeting_id;
  if not found then
    return jsonb_build_object(
      'hasContext',false,
      'workspaceId',v_meeting.workspace_id,
      'status',case when v_meeting.ended_at is null then 'active' else 'ended' end
    );
  end if;

  select * into v_recording from public.meeting_recordings where meeting_id=p_meeting_id;

  return jsonb_build_object(
    'hasContext',true,
    'workspaceId',v_meeting.workspace_id,
    'projectId',v_context.project_id,
    'activityId',v_context.activity_id,
    'subactivityId',v_context.subactivity_id,
    'requestId',v_context.request_id,
    'aqsReviewId',v_context.aqs_review_id,
    'recorderId',coalesce(v_recording.recorder_user_id,v_meeting.created_by),
    'status',coalesce(v_recording.status,case when v_meeting.ended_at is null then 'recording' else 'finalizing' end)
  );
end;
$$;

-- Explicitamente finalizar é diferente de abandonar a sala. Para reuniões
-- contextuais, somente o criador continua podendo executar esta ação, porém não
-- aguardamos mais vídeo/PDF. Esses artefatos são publicados após o ended_at.
create or replace function public.end_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v public.meetings%rowtype;
  v_now timestamptz:=now();
  v_has_context boolean:=false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'Reunião não encontrada'; end if;
  if v.ended_at is not null then return; end if;

  select exists(
    select 1 from public.activity_meeting_runs r where r.meeting_id=p_meeting_id
  ) into v_has_context;

  if v_has_context then
    if v.created_by<>auth.uid() then
      raise exception 'Somente o criador da reunião pode finalizá-la';
    end if;

    -- Sinaliza no banco que o artefato entrou em finalização, sem exigir que o
    -- upload esteja concluído antes de liberar os participantes da chamada.
    update public.meeting_recordings
       set status=case when status='published' then status else 'finalizing' end,
           heartbeat_at=v_now,
           updated_at=v_now,
           error_text=case when status='published' then error_text else null end
     where meeting_id=p_meeting_id
       and recorder_user_id=auth.uid();
  elsif v.created_by<>auth.uid() and not public.is_workspace_admin(v.workspace_id) then
    raise exception 'Somente o criador ou administrador pode encerrar a reunião';
  end if;

  update public.meeting_members
  set status=case when status='joined' then 'left' else status end,
      left_at=case when status='joined' then v_now else left_at end,
      last_seen_at=null
  where meeting_id=p_meeting_id;

  update public.meetings
  set ended_at=v_now,updated_at=v_now
  where id=p_meeting_id;

  update public.notifications
  set read_at=coalesce(read_at,v_now)
  where meeting_id=p_meeting_id and type='meeting-invite';
end;
$$;

revoke execute on function public.meeting_artifact_context(uuid) from public,anon;
grant execute on function public.meeting_artifact_context(uuid) to authenticated;
revoke execute on function public.end_meeting(uuid) from public,anon;
grant execute on function public.end_meeting(uuid) to authenticated;

commit;
