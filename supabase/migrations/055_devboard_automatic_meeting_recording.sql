-- Devboard · V48 · Gravação automática de reuniões contextuais
-- Execute após 054_devboard_persistent_meeting_chat.sql.
--
-- Objetivos:
--  * uma única gravação automática por reunião/contexto;
--  * o criador da sala é o gravador preferencial;
--  * publicação agrupada no tópico de origem ao encerrar;
--  * nenhuma parte publicada pode ultrapassar 50 MB;
--  * evita uma notificação por parte da gravação.

begin;

create table if not exists public.meeting_recordings (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recorder_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'recording' check(status in ('recording','finalizing','published','failed')),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  published_at timestamptz,
  part_count integer not null default 0 check(part_count>=0),
  total_size_bytes bigint not null default 0 check(total_size_bytes>=0),
  error_text text,
  updated_at timestamptz not null default now()
);

create index if not exists meeting_recordings_workspace_idx
  on public.meeting_recordings(workspace_id,updated_at desc);

alter table public.meeting_recordings enable row level security;
alter table public.meeting_recordings replica identity full;

drop policy if exists meeting_recordings_select on public.meeting_recordings;
create policy meeting_recordings_select
  on public.meeting_recordings for select to authenticated
  using (
    exists(
      select 1 from public.meeting_members mm
      where mm.meeting_id=meeting_recordings.meeting_id
        and mm.user_id=auth.uid()
    )
  );

revoke all on public.meeting_recordings from anon,authenticated;
grant select on public.meeting_recordings to authenticated;

-- Durante a finalização, o item de origem pode ter acabado de mudar para um
-- status final. O gravador ainda precisa conseguir subir os objetos que serão
-- publicados pela RPC abaixo; por isso as policies aceitam também o gravador
-- oficial de uma reunião contextual ainda não publicada.
create or replace function public.followup_attachment_storage_insert_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_project uuid;
begin
  if auth.uid() is null then return false; end if;
  if split_part(p_name,'/',3) is distinct from auth.uid()::text then return false; end if;
  begin
    v_project:=split_part(p_name,'/',2)::uuid;
  exception when others then
    return false;
  end;
  if public.safe_path_workspace_id(p_name) is distinct from public.project_workspace_id(v_project) then return false; end if;
  if public.can_share_project_target(v_project,null,null) then return true; end if;
  return exists(
    select 1
    from public.meeting_recordings mr
    join public.activity_meeting_runs ar on ar.meeting_id=mr.meeting_id
    where ar.project_id=v_project
      and mr.recorder_user_id=auth.uid()
      and mr.status in ('recording','finalizing','failed')
  );
end;
$$;

create or replace function public.service_request_storage_insert_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.service_requests r
    where r.id=public.service_request_storage_request_id(p_name)
      and r.workspace_id::text=split_part(p_name,'/',1)
      and auth.uid()::text=split_part(p_name,'/',3)
      and (
        public.can_contribute_service_request(r.id)
        or exists(
          select 1
          from public.meeting_recordings mr
          join public.activity_meeting_runs ar on ar.meeting_id=mr.meeting_id
          where ar.request_id=r.id
            and mr.recorder_user_id=auth.uid()
            and mr.status in ('recording','finalizing','failed')
        )
      )
  );
$$;

revoke execute on function public.followup_attachment_storage_insert_allowed(text) from public,anon;
grant execute on function public.followup_attachment_storage_insert_allowed(text) to authenticated;
revoke execute on function public.service_request_storage_insert_allowed(text) from public,anon;
grant execute on function public.service_request_storage_insert_allowed(text) to authenticated;

-- A inserção em attachments normalmente notifica a cada arquivo. Gravações são
-- publicadas em várias partes; durante a transação de publicação suprimimos o
-- trigger individual e emitimos somente uma notificação agrupada ao final.
create or replace function public.followup_attachment_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_title text;
begin
  if current_setting('devboard.skip_followup_notification',true)='1' then
    return new;
  end if;

  if new.subactivity_id is not null then
    select s.title into v_title from public.subactivities s where s.id=new.subactivity_id;
    perform public.notify_followup_subactivity_participants(
      new.subactivity_id,new.uploaded_by,'Novo anexo no acompanhamento',
      format('“%s” · %s',coalesce(v_title,'Subatividade'),new.name)
    );
    return new;
  end if;

  if new.activity_id is not null then
    select a.title into v_title from public.activities a where a.id=new.activity_id;
    perform public.notify_followup_activity_participants(
      new.activity_id,new.uploaded_by,'Novo anexo na atividade',
      format('“%s” · %s',coalesce(v_title,'Atividade'),new.name)
    );
    return new;
  end if;

  if new.project_id is not null then
    select p.name into v_title from public.projects p where p.id=new.project_id;
    perform public.notify_followup_project_participants(
      new.project_id,new.uploaded_by,'Novo anexo no projeto',
      format('“%s” · %s',coalesce(v_title,'Projeto'),new.name)
    );
  end if;
  return new;
end;
$$;

-- Retorna o contexto exato e tenta assumir o papel de gravador. O criador da
-- reunião tem preferência. Se ele nunca inicializar a gravação, outro usuário
-- que já esteja na sala pode assumir após 20 s. Uma gravação abandonada só pode
-- ser retomada após 90 s sem heartbeat.
create or replace function public.claim_meeting_recording(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_context public.activity_meeting_runs%rowtype;
  v_recording public.meeting_recordings%rowtype;
  v_can_record boolean:=false;
  v_has_context boolean:=false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found or v_meeting.ended_at is not null then
    raise exception 'Esta reunião não está mais em andamento';
  end if;

  if not exists(
    select 1 from public.meeting_members mm
    where mm.meeting_id=p_meeting_id
      and mm.user_id=auth.uid()
      and mm.status='joined'
  ) then
    raise exception 'Entre na reunião antes de iniciar a gravação';
  end if;

  select * into v_context
  from public.activity_meeting_runs
  where meeting_id=p_meeting_id;
  v_has_context:=found;

  if not v_has_context then
    return jsonb_build_object(
      'canRecord',false,
      'hasContext',false,
      'status','unavailable'
    );
  end if;

  select * into v_recording
  from public.meeting_recordings
  where meeting_id=p_meeting_id
  for update;

  if not found then
    if auth.uid()=v_meeting.created_by or now()>=v_meeting.created_at+interval '20 seconds' then
      insert into public.meeting_recordings(meeting_id,workspace_id,recorder_user_id,status)
      values(p_meeting_id,v_meeting.workspace_id,auth.uid(),'recording')
      on conflict(meeting_id) do nothing;

      select * into v_recording
      from public.meeting_recordings
      where meeting_id=p_meeting_id
      for update;
    end if;
  elsif v_recording.status<>'published'
        and v_recording.recorder_user_id<>auth.uid()
        and (v_recording.status='failed' or v_recording.heartbeat_at<now()-interval '90 seconds') then
    update public.meeting_recordings
    set recorder_user_id=auth.uid(),
        status='recording',
        heartbeat_at=now(),
        error_text=null,
        updated_at=now()
    where meeting_id=p_meeting_id
    returning * into v_recording;
  end if;

  if v_recording.meeting_id is not null and v_recording.recorder_user_id=auth.uid() and v_recording.status<>'published' then
    update public.meeting_recordings
    set heartbeat_at=now(),updated_at=now(),status=case when status='failed' then 'recording' else status end,error_text=null
    where meeting_id=p_meeting_id;
    v_can_record:=true;
  end if;

  return jsonb_build_object(
    'canRecord',v_can_record,
    'hasContext',true,
    'status',coalesce(v_recording.status,'waiting'),
    'recorderId',v_recording.recorder_user_id,
    'workspaceId',v_meeting.workspace_id,
    'projectId',v_context.project_id,
    'activityId',v_context.activity_id,
    'subactivityId',v_context.subactivity_id,
    'requestId',v_context.request_id,
    'aqsReviewId',v_context.aqs_review_id
  );
end;
$$;

create or replace function public.meeting_recording_status(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v public.meeting_recordings%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not exists(
    select 1 from public.meeting_members mm
    where mm.meeting_id=p_meeting_id and mm.user_id=auth.uid()
  ) then raise exception 'Sem acesso à reunião'; end if;

  select * into v from public.meeting_recordings where meeting_id=p_meeting_id;
  if not found then return jsonb_build_object('status','waiting','recorderId',null); end if;
  return jsonb_build_object(
    'status',v.status,
    'recorderId',v.recorder_user_id,
    'partCount',v.part_count,
    'publishedAt',v.published_at,
    'error',v.error_text
  );
end;
$$;

create or replace function public.meeting_recording_heartbeat(p_meeting_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.meeting_recordings
  set heartbeat_at=now(),updated_at=now()
  where meeting_id=p_meeting_id
    and recorder_user_id=auth.uid()
    and status in ('recording','finalizing','failed');
  return found;
end;
$$;

create or replace function public.meeting_recording_mark_finalizing(p_meeting_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.meeting_recordings
  set status='finalizing',heartbeat_at=now(),updated_at=now(),error_text=null
  where meeting_id=p_meeting_id and recorder_user_id=auth.uid() and status<>'published';
  return found;
end;
$$;

create or replace function public.meeting_recording_mark_failed(p_meeting_id uuid,p_error text default null)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.meeting_recordings
  set status='failed',heartbeat_at=now(),updated_at=now(),error_text=left(nullif(btrim(coalesce(p_error,'')),''),500)
  where meeting_id=p_meeting_id and recorder_user_id=auth.uid() and status<>'published';
  return found;
end;
$$;

-- Publica os objetos já enviados pelo navegador no destino original. O Storage
-- continua usando os buckets existentes; esta RPC somente registra os metadados
-- depois de validar paths/tamanhos e cria um único aviso para toda a gravação.
create or replace function public.publish_meeting_recording(p_meeting_id uuid,p_parts jsonb)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_meeting public.meetings%rowtype;
  v_context public.activity_meeting_runs%rowtype;
  v_recording public.meeting_recordings%rowtype;
  v_item jsonb;
  v_name text;
  v_mime text;
  v_path text;
  v_size bigint;
  v_count integer:=0;
  v_total bigint:=0;
  v_description text;
  v_rec record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if jsonb_typeof(coalesce(p_parts,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_parts,'[]'::jsonb))=0 then
    raise exception 'A gravação não possui partes para publicar';
  end if;
  if jsonb_array_length(p_parts)>120 then raise exception 'Quantidade de partes da gravação inválida'; end if;

  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found then raise exception 'Reunião não encontrada'; end if;
  select * into v_context from public.activity_meeting_runs where meeting_id=p_meeting_id;
  if not found then raise exception 'Esta reunião não possui tópico de origem'; end if;
  select * into v_recording from public.meeting_recordings where meeting_id=p_meeting_id for update;
  if not found or v_recording.recorder_user_id<>auth.uid() then raise exception 'Este dispositivo não é responsável pela gravação'; end if;
  if v_recording.status='published' then return true; end if;

  perform set_config('devboard.skip_followup_notification','1',true);

  for v_item in select * from jsonb_array_elements(p_parts) loop
    v_name:=btrim(coalesce(v_item->>'name',''));
    v_mime:=coalesce(nullif(btrim(v_item->>'mimeType'),''),'video/webm');
    v_path:=btrim(coalesce(v_item->>'storagePath',''));
    begin
      v_size:=(v_item->>'size')::bigint;
    exception when others then
      raise exception 'Tamanho de uma parte da gravação é inválido';
    end;

    if v_name='' or v_path='' then raise exception 'Parte da gravação sem nome ou caminho'; end if;
    if v_size<=0 or v_size>52428800 then raise exception 'Cada parte da gravação deve ter no máximo 50 MB'; end if;

    if v_context.request_id is not null then
      if split_part(v_path,'/',1)<>v_meeting.workspace_id::text
         or split_part(v_path,'/',2)<>v_context.request_id::text
         or split_part(v_path,'/',3)<>auth.uid()::text then
        raise exception 'Caminho da gravação inválido para a solicitação';
      end if;

      if not exists(select 1 from public.service_request_attachments a where a.storage_path=v_path) then
        insert into public.service_request_attachments(
          request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,uploaded_by
        ) values(
          v_context.request_id,null,'analysis-video',v_name,v_mime,v_size,'video'::public.attachment_kind,v_path,auth.uid()
        );
      end if;
    else
      if split_part(v_path,'/',1)<>v_meeting.workspace_id::text
         or split_part(v_path,'/',2)<>v_context.project_id::text
         or split_part(v_path,'/',3)<>auth.uid()::text then
        raise exception 'Caminho da gravação inválido para o projeto';
      end if;

      if not exists(select 1 from public.attachments a where a.storage_path=v_path) then
        if v_context.subactivity_id is not null then
          insert into public.attachments(
            project_id,activity_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active
          ) values(
            null,null,v_context.subactivity_id,v_name,v_mime,v_size,'video'::public.attachment_kind,v_path,auth.uid(),true
          );
        else
          insert into public.attachments(
            project_id,activity_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active
          ) values(
            null,v_context.activity_id,null,v_name,v_mime,v_size,'video'::public.attachment_kind,v_path,auth.uid(),true
          );
        end if;
      end if;
    end if;

    v_count:=v_count+1;
    v_total:=v_total+v_size;
  end loop;

  v_description:=format(
    '%s · %s parte%s da gravação.',
    coalesce(nullif(v_meeting.title,''),'Reunião'),
    v_count,
    case when v_count=1 then '' else 's' end
  );

  if v_context.request_id is not null then
    perform public.service_request_add_event(
      v_context.request_id,
      'technical-meeting-recording',
      'Gravação da reunião disponível',
      v_description,
      null,null,auth.uid()
    );

    for v_rec in
      select distinct user_id from (
        select r.created_by as user_id from public.service_requests r where r.id=v_context.request_id
        union select r.assigned_aqs_id from public.service_requests r where r.id=v_context.request_id and r.assigned_aqs_id is not null
        union select r.responsible_dev_id from public.service_requests r where r.id=v_context.request_id and r.responsible_dev_id is not null
        union select r.executor_id from public.service_requests r where r.id=v_context.request_id and r.executor_id is not null
        union select p.user_id from public.service_request_participants p where p.request_id=v_context.request_id
      ) q where user_id is not null
    loop
      perform public.service_request_notify(
        v_context.request_id,v_rec.user_id,'request-meeting-recording',
        'Gravação da reunião disponível',v_description,auth.uid()
      );
    end loop;
  elsif v_context.subactivity_id is not null then
    perform public.notify_followup_subactivity_participants(
      v_context.subactivity_id,auth.uid(),'Gravação da reunião disponível',v_description
    );
  else
    perform public.notify_followup_activity_participants(
      v_context.activity_id,auth.uid(),'Gravação da reunião disponível',v_description
    );
  end if;

  update public.meeting_recordings
  set status='published',
      published_at=now(),
      heartbeat_at=now(),
      part_count=v_count,
      total_size_bytes=v_total,
      error_text=null,
      updated_at=now()
  where meeting_id=p_meeting_id;

  return true;
end;
$$;

revoke execute on function public.claim_meeting_recording(uuid) from public,anon;
grant execute on function public.claim_meeting_recording(uuid) to authenticated;
revoke execute on function public.meeting_recording_status(uuid) from public,anon;
grant execute on function public.meeting_recording_status(uuid) to authenticated;
revoke execute on function public.meeting_recording_heartbeat(uuid) from public,anon;
grant execute on function public.meeting_recording_heartbeat(uuid) to authenticated;
revoke execute on function public.meeting_recording_mark_finalizing(uuid) from public,anon;
grant execute on function public.meeting_recording_mark_finalizing(uuid) to authenticated;
revoke execute on function public.meeting_recording_mark_failed(uuid,text) from public,anon;
grant execute on function public.meeting_recording_mark_failed(uuid,text) to authenticated;
revoke execute on function public.publish_meeting_recording(uuid,jsonb) from public,anon;
grant execute on function public.publish_meeting_recording(uuid,jsonb) to authenticated;

commit;
