-- TaskBoard V212
-- Finalização de reuniões contextuais: somente o criador encerra, e apenas depois
-- de a gravação e o PDF com o chat terem sido publicados no tópico de origem.

begin;

create table if not exists public.meeting_transcripts (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  file_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_path text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists meeting_transcripts_storage_path_uidx
  on public.meeting_transcripts(storage_path);

alter table public.meeting_transcripts enable row level security;
revoke all on public.meeting_transcripts from anon, authenticated;

create or replace function public.meeting_transcript_status(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_transcript public.meeting_transcripts%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found then raise exception 'Reunião não encontrada'; end if;

  if v_meeting.created_by<>auth.uid()
     and not exists(
       select 1 from public.meeting_members mm
       where mm.meeting_id=p_meeting_id and mm.user_id=auth.uid()
     )
     and not public.is_workspace_admin(v_meeting.workspace_id) then
    raise exception 'Sem acesso a esta reunião';
  end if;

  select * into v_transcript from public.meeting_transcripts where meeting_id=p_meeting_id;
  if not found then
    return jsonb_build_object('published',false);
  end if;

  return jsonb_build_object(
    'published',true,
    'fileName',v_transcript.file_name,
    'storagePath',v_transcript.storage_path,
    'publishedAt',v_transcript.published_at
  );
end;
$$;

create or replace function public.publish_meeting_transcript(
  p_meeting_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path=public,storage,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_context public.activity_meeting_runs%rowtype;
  v_name text:=left(btrim(coalesce(p_file_name,'')),255);
  v_mime text:=coalesce(nullif(btrim(coalesce(p_mime_type,'')),''),'application/pdf');
  v_path text:=btrim(coalesce(p_storage_path,''));
  v_bucket text;
  v_existing boolean:=false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found then raise exception 'Reunião não encontrada'; end if;
  if v_meeting.created_by<>auth.uid() then
    raise exception 'Somente o criador da reunião pode publicar o histórico do chat';
  end if;

  select * into v_context from public.activity_meeting_runs where meeting_id=p_meeting_id;
  if not found then raise exception 'Esta reunião não possui tópico de origem'; end if;

  if v_name='' then raise exception 'Nome do histórico inválido'; end if;
  if v_mime<>'application/pdf' then raise exception 'O histórico da reunião deve ser publicado em PDF'; end if;
  if p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>52428800 then
    raise exception 'O PDF do histórico deve ter no máximo 50 MB';
  end if;
  if v_path='' then raise exception 'Caminho do histórico inválido'; end if;

  select exists(select 1 from public.meeting_transcripts where meeting_id=p_meeting_id) into v_existing;
  if v_existing then return true; end if;

  if v_context.request_id is not null then
    v_bucket:='devboard-request-media';
    if split_part(v_path,'/',1)<>v_meeting.workspace_id::text
       or split_part(v_path,'/',2)<>v_context.request_id::text
       or split_part(v_path,'/',3)<>auth.uid()::text then
      raise exception 'Caminho do histórico inválido para a solicitação';
    end if;
  else
    v_bucket:='cadence-attachments';
    if v_context.project_id is null then raise exception 'Projeto da reunião não identificado'; end if;
    if split_part(v_path,'/',1)<>v_meeting.workspace_id::text
       or split_part(v_path,'/',2)<>v_context.project_id::text
       or split_part(v_path,'/',3)<>auth.uid()::text then
      raise exception 'Caminho do histórico inválido para o projeto';
    end if;
  end if;

  if not exists(
    select 1 from storage.objects o
    where o.bucket_id=v_bucket and o.name=v_path
  ) then
    raise exception 'O PDF do histórico ainda não foi enviado ao Storage';
  end if;

  perform set_config('devboard.skip_followup_notification','1',true);

  if v_context.request_id is not null then
    if not exists(select 1 from public.service_request_attachments a where a.storage_path=v_path) then
      insert into public.service_request_attachments(
        request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,uploaded_by
      ) values(
        v_context.request_id,null,'other',v_name,v_mime,p_size_bytes,'pdf'::public.attachment_kind,v_path,auth.uid()
      );

      perform public.service_request_add_event(
        v_context.request_id,
        'technical-meeting-transcript',
        'Chat da reunião disponível',
        format('%s · histórico completo do chat em PDF.',coalesce(nullif(v_meeting.title,''),'Reunião')),
        null,null,auth.uid()
      );
    end if;
  else
    if not exists(select 1 from public.attachments a where a.storage_path=v_path) then
      if v_context.subactivity_id is not null then
        insert into public.attachments(
          project_id,activity_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active
        ) values(
          null,null,v_context.subactivity_id,v_name,v_mime,p_size_bytes,'pdf'::public.attachment_kind,v_path,auth.uid(),true
        );
      else
        insert into public.attachments(
          project_id,activity_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active
        ) values(
          null,v_context.activity_id,null,v_name,v_mime,p_size_bytes,'pdf'::public.attachment_kind,v_path,auth.uid(),true
        );
      end if;
    end if;
  end if;

  insert into public.meeting_transcripts(
    meeting_id,workspace_id,uploaded_by,file_name,mime_type,size_bytes,storage_path,published_at
  ) values(
    p_meeting_id,v_meeting.workspace_id,auth.uid(),v_name,v_mime,p_size_bytes,v_path,now()
  )
  on conflict(meeting_id) do update
    set file_name=excluded.file_name,
        mime_type=excluded.mime_type,
        size_bytes=excluded.size_bytes,
        storage_path=excluded.storage_path,
        published_at=excluded.published_at,
        uploaded_by=excluded.uploaded_by;

  return true;
end;
$$;

-- Reuniões vinculadas a atividade/subatividade/solicitação/AQS só podem ser
-- encerradas pelo criador e depois que vídeo + histórico do chat estiverem publicados.
-- Reuniões comuns do Chat preservam a regra anterior (criador ou administrador).
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
    if not exists(
      select 1 from public.meeting_recordings mr
      where mr.meeting_id=p_meeting_id and mr.status='published'
    ) then
      raise exception 'A gravação precisa ser enviada antes de finalizar a reunião';
    end if;
    if not exists(
      select 1 from public.meeting_transcripts mt where mt.meeting_id=p_meeting_id
    ) then
      raise exception 'O histórico do chat precisa ser enviado antes de finalizar a reunião';
    end if;
  elsif v.created_by<>auth.uid() and not public.is_workspace_admin(v.workspace_id) then
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


-- O owner de uma reunião contextual não "abandona" a sala antes de publicar os
-- artefatos. Isso evita que pagehide/crash finalize a reunião por leave_meeting.
create or replace function public.leave_meeting(p_meeting_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_now timestamptz:=now();
  v_meeting public.meetings%rowtype;
  v_has_context boolean:=false;
  v_artifacts_ready boolean:=false;
  v_ended boolean:=false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'Reunião não encontrada'; end if;
  if v_meeting.ended_at is not null then return true; end if;

  select exists(select 1 from public.activity_meeting_runs r where r.meeting_id=p_meeting_id)
    into v_has_context;
  select (
    exists(select 1 from public.meeting_recordings mr where mr.meeting_id=p_meeting_id and mr.status='published')
    and exists(select 1 from public.meeting_transcripts mt where mt.meeting_id=p_meeting_id)
  ) into v_artifacts_ready;

  if v_has_context and v_meeting.created_by=auth.uid() and not v_artifacts_ready then
    update public.meetings set updated_at=v_now where id=p_meeting_id;
    return false;
  end if;

  update public.meeting_members
  set status='left',left_at=v_now,last_seen_at=null
  where meeting_id=p_meeting_id and user_id=auth.uid() and status='joined';

  if not exists(
    select 1 from public.meeting_members
    where meeting_id=p_meeting_id and status='joined'
  ) then
    update public.meetings
    set ended_at=coalesce(ended_at,v_now),updated_at=v_now
    where id=p_meeting_id and ended_at is null;
    v_ended:=found;
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

-- O job de limpeza continua fechando reuniões comuns e participantes abandonados,
-- mas preserva o owner de uma reunião contextual até vídeo + chat estarem salvos.
create or replace function public.close_abandoned_meetings()
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_count integer:=0;
begin
  update public.meeting_members mm
  set status='left',left_at=coalesce(left_at,now()),last_seen_at=null
  from public.meetings m
  where m.id=mm.meeting_id
    and m.ended_at is null
    and mm.status='joined'
    and coalesce(mm.last_seen_at,mm.joined_at,mm.created_at) < now() - interval '3 minutes'
    and not (
      mm.user_id=m.created_by
      and exists(select 1 from public.activity_meeting_runs r where r.meeting_id=m.id)
      and not (
        exists(select 1 from public.meeting_recordings mr where mr.meeting_id=m.id and mr.status='published')
        and exists(select 1 from public.meeting_transcripts mt where mt.meeting_id=m.id)
      )
    );

  with ended as (
    update public.meetings m
    set ended_at=now(),updated_at=now()
    where m.ended_at is null
      and not exists(
        select 1 from public.meeting_members mm
        where mm.meeting_id=m.id and mm.status='joined'
      )
      and (
        not exists(select 1 from public.activity_meeting_runs r where r.meeting_id=m.id)
        or (
          exists(select 1 from public.meeting_recordings mr where mr.meeting_id=m.id and mr.status='published')
          and exists(select 1 from public.meeting_transcripts mt where mt.meeting_id=m.id)
        )
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

revoke execute on function public.leave_meeting(uuid) from public,anon;
grant execute on function public.leave_meeting(uuid) to authenticated;
revoke execute on function public.close_abandoned_meetings() from public,anon,authenticated;

revoke execute on function public.meeting_transcript_status(uuid) from public,anon;
grant execute on function public.meeting_transcript_status(uuid) to authenticated;
revoke execute on function public.publish_meeting_transcript(uuid,text,text,bigint,text) from public,anon;
grant execute on function public.publish_meeting_transcript(uuid,text,text,bigint,text) to authenticated;
revoke execute on function public.end_meeting(uuid) from public,anon;
grant execute on function public.end_meeting(uuid) to authenticated;

commit;
