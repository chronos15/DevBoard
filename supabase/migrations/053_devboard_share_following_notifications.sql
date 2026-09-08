begin;

-- 053 · Compartilhamento por acompanhamento + notificações reais
--
-- Regras principais:
--   • Admin pode compartilhar em qualquer contexto ABERTO do workspace.
--   • Demais usuários só podem contribuir em contextos que acompanham.
--   • Mensagem, anexo e mudança de status em subatividade acompanhada continuam
--     consolidados como não lidos, mas cada atualização renova created_at para o
--     cliente emitir um novo aviso do Android/Chrome.
--   • Anexos em nível de atividade/projeto passam a notificar os participantes.

-- ---------------------------------------------------------------------------
-- Projetos / atividades / subatividades: quem realmente acompanha o contexto.
-- ---------------------------------------------------------------------------
create or replace function public.can_share_project_target(
  p_project_id uuid,
  p_activity_id uuid default null,
  p_subactivity_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid;
  v_role text;
begin
  if auth.uid() is null or p_project_id is null then return false; end if;
  v_workspace:=public.project_workspace_id(p_project_id);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then return false; end if;
  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role='admin' then return true; end if;

  if p_subactivity_id is not null then
    if public.subactivity_project_id(p_subactivity_id) is distinct from p_project_id then return false; end if;
    if p_activity_id is not null and not exists(
      select 1 from public.subactivities s where s.id=p_subactivity_id and s.activity_id=p_activity_id
    ) then return false; end if;

    return exists(
      select 1 from public.subactivities s
      where s.id=p_subactivity_id
        and (
          s.assignee_id=auth.uid()
          or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=auth.uid())
          or exists(
            select 1 from public.aqs_reviews r
            where r.subactivity_id=s.id
              and r.status in ('awaiting','evaluating')
              and (r.assigned_aqs_id=auth.uid() or r.created_by=auth.uid())
          )
        )
    );
  end if;

  if p_activity_id is not null then
    if public.activity_project_id(p_activity_id) is distinct from p_project_id then return false; end if;
    return exists(select 1 from public.activity_assignees aa where aa.activity_id=p_activity_id and aa.user_id=auth.uid())
      or exists(
        select 1
        from public.subactivities s
        where s.activity_id=p_activity_id
          and (
            s.assignee_id=auth.uid()
            or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=auth.uid())
          )
      )
      or exists(
        select 1 from public.aqs_reviews r
        where r.activity_id=p_activity_id
          and r.status in ('awaiting','evaluating')
          and (r.assigned_aqs_id=auth.uid() or r.created_by=auth.uid())
      );
  end if;

  return exists(
      select 1 from public.activities a
      join public.activity_assignees aa on aa.activity_id=a.id
      where a.project_id=p_project_id and aa.user_id=auth.uid()
    )
    or exists(
      select 1
      from public.activities a
      join public.subactivities s on s.activity_id=a.id
      where a.project_id=p_project_id
        and (
          s.assignee_id=auth.uid()
          or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=s.id and sm.user_id=auth.uid())
        )
    )
    or exists(
      select 1 from public.aqs_reviews r
      where r.project_id=p_project_id
        and r.status in ('awaiting','evaluating')
        and (r.assigned_aqs_id=auth.uid() or r.created_by=auth.uid())
    );
end;
$$;

revoke execute on function public.can_share_project_target(uuid,uuid,uuid) from public,anon;
grant execute on function public.can_share_project_target(uuid,uuid,uuid) to authenticated;

-- O objeto também só entra no bucket quando o usuário acompanha algum contexto
-- do projeto presente no caminho workspace/projeto/usuario/arquivo. A validação
-- exata de atividade/subatividade continua no RPC que registra os metadados.
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
  return public.can_share_project_target(v_project,null,null);
end;
$$;

revoke execute on function public.followup_attachment_storage_insert_allowed(text) from public,anon;
grant execute on function public.followup_attachment_storage_insert_allowed(text) to authenticated;

drop policy if exists cadence_attachments_storage_insert on storage.objects;
create policy cadence_attachments_storage_insert on storage.objects for insert to authenticated
with check(
  bucket_id='cadence-attachments'
  and public.followup_attachment_storage_insert_allowed(name)
);

-- Mantém o RPC histórico, mas impede que um usuário apenas pertencente ao
-- workspace envie evidência para um contexto que não acompanha.
create or replace function public.add_attachment(
  p_project_id uuid default null,
  p_subactivity_id uuid default null,
  p_name text default '',
  p_mime_type text default 'application/octet-stream',
  p_size_bytes bigint default 0,
  p_kind text default 'other',
  p_storage_path text default null,
  p_text_content text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_project uuid;
  v_workspace uuid;
begin
  if (p_project_id is null)=(p_subactivity_id is null) then
    raise exception 'Informe projeto ou subatividade, exclusivamente';
  end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do anexo é obrigatório'; end if;
  if p_kind not in ('image','pdf','text','document','video','audio','other') then raise exception 'Tipo de anexo inválido'; end if;
  if p_storage_path is null and p_text_content is null then raise exception 'Anexo sem conteúdo'; end if;
  if greatest(coalesce(p_size_bytes,0),0)>52428800 then raise exception 'O arquivo deve ter no máximo 50 MB'; end if;

  v_project:=coalesce(p_project_id,public.subactivity_project_id(p_subactivity_id));
  v_workspace:=public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if not public.can_share_project_target(v_project,null,p_subactivity_id) then
    raise exception 'Você só pode enviar evidências para itens que acompanha';
  end if;

  if p_storage_path is not null and (
    public.safe_path_workspace_id(p_storage_path) is distinct from v_workspace
    or split_part(p_storage_path,'/',3) is distinct from auth.uid()::text
  ) then raise exception 'Caminho de Storage inválido para este usuário/workspace'; end if;

  insert into public.attachments(
    project_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,text_content,uploaded_by
  ) values(
    p_project_id,p_subactivity_id,btrim(p_name),coalesce(p_mime_type,'application/octet-stream'),
    greatest(coalesce(p_size_bytes,0),0),p_kind::public.attachment_kind,p_storage_path,p_text_content,auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_activity_attachment(
  p_activity_id uuid,
  p_name text default '',
  p_mime_type text default 'application/octet-stream',
  p_size_bytes bigint default 0,
  p_kind text default 'other',
  p_storage_path text default null,
  p_text_content text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_project uuid;
  v_workspace uuid;
begin
  if p_activity_id is null then raise exception 'Atividade não informada'; end if;
  if length(btrim(coalesce(p_name,'')))=0 then raise exception 'Nome do anexo é obrigatório'; end if;
  if p_kind not in ('image','pdf','text','document','video','audio','other') then raise exception 'Tipo de anexo inválido'; end if;
  if p_storage_path is null and p_text_content is null then raise exception 'Anexo sem conteúdo'; end if;
  if greatest(coalesce(p_size_bytes,0),0)>52428800 then raise exception 'O arquivo deve ter no máximo 50 MB'; end if;

  v_project:=public.activity_project_id(p_activity_id);
  if v_project is null then raise exception 'Atividade não encontrada'; end if;
  v_workspace:=public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;
  if not public.can_share_project_target(v_project,p_activity_id,null) then
    raise exception 'Você só pode enviar evidências para atividades que acompanha';
  end if;

  if p_storage_path is not null and (
    public.safe_path_workspace_id(p_storage_path) is distinct from v_workspace
    or split_part(p_storage_path,'/',3) is distinct from auth.uid()::text
  ) then raise exception 'Caminho de Storage inválido para este usuário/workspace'; end if;

  insert into public.attachments(
    activity_id,name,mime_type,size_bytes,kind,storage_path,text_content,uploaded_by
  ) values(
    p_activity_id,btrim(p_name),coalesce(p_mime_type,'application/octet-stream'),
    greatest(coalesce(p_size_bytes,0),0),p_kind::public.attachment_kind,p_storage_path,p_text_content,auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_attachment(uuid,uuid,text,text,bigint,text,text,text) from public,anon;
grant execute on function public.add_attachment(uuid,uuid,text,text,bigint,text,text,text) to authenticated;
revoke execute on function public.add_activity_attachment(uuid,text,text,bigint,text,text,text) from public,anon;
grant execute on function public.add_activity_attachment(uuid,text,text,bigint,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- AQS: destino explícito do compartilhamento PWA.
-- ---------------------------------------------------------------------------
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
    or exists(select 1 from public.subactivities s where s.id=v.subactivity_id and s.assignee_id=auth.uid())
    or exists(select 1 from public.subactivity_members sm where sm.subactivity_id=v.subactivity_id and sm.user_id=auth.uid());
end;
$$;

create or replace function public.add_aqs_review_attachment(
  p_review_id uuid,
  p_name text default '',
  p_mime_type text default 'application/octet-stream',
  p_size_bytes bigint default 0,
  p_kind text default 'other',
  p_storage_path text default null,
  p_text_content text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v public.aqs_reviews%rowtype;
  v_attachment_id uuid;
begin
  if not public.can_contribute_aqs_review(p_review_id) then
    raise exception 'Esta análise AQS não está disponível para o seu usuário';
  end if;
  select * into v from public.aqs_reviews where id=p_review_id;
  select public.add_attachment(
    null,v.subactivity_id,p_name,p_mime_type,p_size_bytes,p_kind,p_storage_path,p_text_content
  ) into v_attachment_id;
  return v_attachment_id;
end;
$$;

revoke execute on function public.can_contribute_aqs_review(uuid) from public,anon;
grant execute on function public.can_contribute_aqs_review(uuid) to authenticated;
revoke execute on function public.add_aqs_review_attachment(uuid,text,text,bigint,text,text,text) from public,anon;
grant execute on function public.add_aqs_review_attachment(uuid,text,text,bigint,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Solicitações: em aberto + participação real (Admin continua vendo todas).
-- ---------------------------------------------------------------------------
create or replace function public.can_contribute_service_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.service_requests r
    join public.workspace_members me
      on me.workspace_id=r.workspace_id and me.user_id=auth.uid() and me.active
    where r.id=p_request_id
      and r.status not in ('completed','rejected','cancelled')
      and (
        me.role::text='admin'
        or r.created_by=auth.uid()
        or r.assigned_aqs_id=auth.uid()
        or r.responsible_dev_id=auth.uid()
        or r.executor_id=auth.uid()
        or exists(
          select 1 from public.service_request_participants rp
          where rp.request_id=r.id and rp.user_id=auth.uid()
        )
      )
  );
$$;

revoke execute on function public.can_contribute_service_request(uuid) from public,anon;
grant execute on function public.can_contribute_service_request(uuid) to authenticated;

create or replace function public.add_service_request_attachment(
  p_request_id uuid,
  p_message_id uuid default null,
  p_category text default 'other',
  p_name text default 'arquivo',
  p_mime_type text default 'application/octet-stream',
  p_size_bytes bigint default 0,
  p_kind public.attachment_kind default 'other',
  p_storage_path text default ''
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid; v_workspace uuid;
begin
  if not public.can_contribute_service_request(p_request_id) then
    raise exception 'Você só pode enviar arquivos para solicitações em aberto que acompanha';
  end if;
  if p_category not in ('order-pdf','analysis-video','database','certificate','other') then raise exception 'Categoria de arquivo inválida'; end if;
  if p_size_bytes<=0 or p_size_bytes>209715200 then raise exception 'Arquivo fora do limite permitido'; end if;
  if p_message_id is not null and not exists(
    select 1 from public.service_request_messages m where m.id=p_message_id and m.request_id=p_request_id
  ) then raise exception 'Mensagem inválida'; end if;
  select workspace_id into v_workspace from public.service_requests where id=p_request_id;
  if split_part(p_storage_path,'/',1)<>v_workspace::text
     or split_part(p_storage_path,'/',2)<>p_request_id::text
     or split_part(p_storage_path,'/',3)<>auth.uid()::text then
    raise exception 'Caminho de armazenamento inválido';
  end if;
  insert into public.service_request_attachments(
    request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,uploaded_by
  ) values(
    p_request_id,p_message_id,p_category,btrim(p_name),coalesce(nullif(p_mime_type,''),'application/octet-stream'),
    p_size_bytes,p_kind,p_storage_path,auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_service_request_message(
  p_request_id uuid,
  p_content text default '',
  p_mentions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid; v_workspace uuid; v_item jsonb; v_user uuid; v_label text;
begin
  if not public.can_contribute_service_request(p_request_id) then
    raise exception 'Você só pode enviar mensagens em solicitações em aberto que acompanha';
  end if;
  if jsonb_typeof(coalesce(p_mentions,'[]'::jsonb))<>'array' then raise exception 'Menções inválidas'; end if;
  if length(btrim(coalesce(p_content,'')))>8000 then raise exception 'Mensagem muito longa'; end if;
  select workspace_id into v_workspace from public.service_requests where id=p_request_id;
  insert into public.service_request_messages(request_id,author_id,content,mentions)
  values(p_request_id,auth.uid(),coalesce(p_content,''),coalesce(p_mentions,'[]'::jsonb)) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_mentions,'[]'::jsonb)) loop
    if coalesce(v_item->>'kind','')<>'user' then continue; end if;
    begin v_user:=(v_item->>'id')::uuid; exception when others then continue; end;
    if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=v_user and wm.active) then continue; end if;
    insert into public.service_request_participants(request_id,user_id,source,added_by)
    values(p_request_id,v_user,'mention',auth.uid()) on conflict(request_id,user_id) do nothing;
    v_label:=coalesce(nullif(v_item->>'label',''),'Usuário');
    perform public.service_request_notify(
      p_request_id,v_user,'request-mention','Você foi mencionado em uma solicitação',
      coalesce(nullif(left(btrim(p_content),180),''),'Novo anexo ou mensagem no protocolo.')
    );
  end loop;
  return v_id;
end;
$$;

create or replace function public.add_service_request_external_resource(
  p_request_id uuid,
  p_message_id uuid default null,
  p_category text default 'other',
  p_url text default '',
  p_name text default 'Link externo'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_url text:=btrim(coalesce(p_url,''));
  v_name text:=btrim(coalesce(p_name,''));
begin
  if not public.can_contribute_service_request(p_request_id) then
    raise exception 'Você só pode enviar links para solicitações em aberto que acompanha';
  end if;
  if p_category not in ('order-pdf','analysis-video','database','certificate','other') then raise exception 'Categoria inválida'; end if;
  if v_url !~* '^(ftp|ftps|https?)://' or length(v_url)>2000 then raise exception 'Informe uma URL FTP/HTTP válida'; end if;
  if length(v_name)<1 then v_name:='Link externo'; end if;
  if length(v_name)>180 then raise exception 'O nome do recurso deve ter no máximo 180 caracteres'; end if;
  if p_message_id is not null and not exists(
    select 1 from public.service_request_messages m where m.id=p_message_id and m.request_id=p_request_id
  ) then raise exception 'Mensagem inválida'; end if;

  insert into public.service_request_attachments(
    request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,uploaded_by,source_type,external_url
  ) values(
    p_request_id,p_message_id,p_category,v_name,'text/uri-list',0,'other',null,auth.uid(),'external-url',v_url
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_service_request_attachment(uuid,uuid,text,text,text,bigint,public.attachment_kind,text) from public,anon;
grant execute on function public.add_service_request_attachment(uuid,uuid,text,text,text,bigint,public.attachment_kind,text) to authenticated;
revoke execute on function public.add_service_request_message(uuid,text,jsonb) from public,anon;
grant execute on function public.add_service_request_message(uuid,text,jsonb) to authenticated;
revoke execute on function public.add_service_request_external_resource(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.add_service_request_external_resource(uuid,uuid,text,text,text) to authenticated;

-- Upload direto no bucket também respeita o mesmo vínculo. A remoção continua
-- usando a policy histórica para permitir rollback/limpeza de objetos já enviados.
create or replace function public.service_request_storage_insert_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.service_requests r
    where r.id=public.service_request_storage_request_id(p_name)
      and r.workspace_id::text=split_part(p_name,'/',1)
      and auth.uid()::text=split_part(p_name,'/',3)
      and public.can_contribute_service_request(r.id)
  );
$$;

revoke execute on function public.service_request_storage_insert_allowed(text) from public,anon;
grant execute on function public.service_request_storage_insert_allowed(text) to authenticated;

drop policy if exists service_request_media_insert on storage.objects;
create policy service_request_media_insert on storage.objects for insert to authenticated
with check(
  bucket_id='devboard-request-media'
  and public.service_request_storage_insert_allowed(name)
);

-- ---------------------------------------------------------------------------
-- Acompanhamento: notificação real em projeto/atividade/subatividade.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_followup_update_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_project_id uuid,
  p_activity_id uuid,
  p_subactivity_id uuid
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_existing uuid;
begin
  if p_recipient_id is null or p_actor_id is null or p_recipient_id=p_actor_id then return; end if;
  if v_workspace is null or not public.is_workspace_member(v_workspace,p_recipient_id) then return; end if;

  select n.id into v_existing
  from public.notifications n
  where n.recipient_id=p_recipient_id
    and n.type='followup-update'
    and n.project_id=p_project_id
    and n.activity_id is not distinct from p_activity_id
    and n.subactivity_id is not distinct from p_subactivity_id
    and n.read_at is null
  order by n.created_at desc
  limit 1;

  if v_existing is not null then
    update public.notifications
    set actor_id=p_actor_id,
        title=p_title,
        description=p_description,
        activity_id=p_activity_id,
        created_at=now()
    where id=v_existing;
    return;
  end if;

  insert into public.notifications(
    workspace_id,recipient_id,actor_id,type,title,description,project_id,activity_id,subactivity_id
  ) values(
    v_workspace,p_recipient_id,p_actor_id,'followup-update',p_title,p_description,
    p_project_id,p_activity_id,p_subactivity_id
  );
end;
$$;

revoke execute on function public.upsert_followup_update_notification(uuid,uuid,text,text,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.notify_followup_activity_participants(
  p_activity_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_recipient uuid;
begin
  select a.project_id,p.workspace_id into v_project,v_workspace
  from public.activities a join public.projects p on p.id=a.project_id
  where a.id=p_activity_id;
  if v_project is null then return; end if;

  for v_recipient in
    select distinct candidate.user_id
    from (
      select aa.user_id from public.activity_assignees aa where aa.activity_id=p_activity_id
      union all
      select s.assignee_id from public.subactivities s where s.activity_id=p_activity_id
      union all
      select sm.user_id
      from public.subactivities s join public.subactivity_members sm on sm.subactivity_id=s.id
      where s.activity_id=p_activity_id
      union all
      select r.assigned_aqs_id from public.aqs_reviews r
      where r.activity_id=p_activity_id and r.status in ('awaiting','evaluating') and r.assigned_aqs_id is not null
      union all
      select wm.user_id from public.workspace_members wm
      where wm.workspace_id=v_workspace and wm.active and wm.role='admin'::public.workspace_role
    ) candidate
    where candidate.user_id is not null and candidate.user_id is distinct from p_actor_id
  loop
    perform public.upsert_followup_update_notification(
      v_recipient,p_actor_id,p_title,p_description,v_project,p_activity_id,null
    );
  end loop;
end;
$$;

create or replace function public.notify_followup_project_participants(
  p_project_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_recipient uuid;
begin
  if v_workspace is null then return; end if;
  for v_recipient in
    select distinct candidate.user_id
    from (
      select aa.user_id
      from public.activities a join public.activity_assignees aa on aa.activity_id=a.id
      where a.project_id=p_project_id
      union all
      select s.assignee_id
      from public.activities a join public.subactivities s on s.activity_id=a.id
      where a.project_id=p_project_id
      union all
      select sm.user_id
      from public.activities a
      join public.subactivities s on s.activity_id=a.id
      join public.subactivity_members sm on sm.subactivity_id=s.id
      where a.project_id=p_project_id
      union all
      select r.assigned_aqs_id from public.aqs_reviews r
      where r.project_id=p_project_id and r.status in ('awaiting','evaluating') and r.assigned_aqs_id is not null
      union all
      select wm.user_id from public.workspace_members wm
      where wm.workspace_id=v_workspace and wm.active and wm.role='admin'::public.workspace_role
    ) candidate
    where candidate.user_id is not null and candidate.user_id is distinct from p_actor_id
  loop
    perform public.upsert_followup_update_notification(
      v_recipient,p_actor_id,p_title,p_description,p_project_id,null,null
    );
  end loop;
end;
$$;

revoke execute on function public.notify_followup_activity_participants(uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.notify_followup_project_participants(uuid,uuid,text,text) from public,anon,authenticated;

-- O helper de subatividade da migration 038 continua sendo a fonte para
-- mensagem/status/anexo interno. Acrescentamos AQS responsável à lista para que
-- quem assumiu uma análise também seja avisado das novas evidências/mensagens.
create or replace function public.notify_followup_subactivity_participants(
  p_subactivity_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text default null,
  p_excluded_user_ids uuid[] default '{}'::uuid[],
  p_exclude_assignee boolean default false
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_project uuid;
  v_activity uuid;
  v_workspace uuid;
  v_assignee uuid;
  v_recipient uuid;
begin
  select a.project_id,s.activity_id,p.workspace_id,s.assignee_id
  into v_project,v_activity,v_workspace,v_assignee
  from public.subactivities s
  join public.activities a on a.id=s.activity_id
  join public.projects p on p.id=a.project_id
  where s.id=p_subactivity_id;
  if v_project is null then return; end if;

  for v_recipient in
    select distinct candidate.user_id
    from (
      select sm.user_id from public.subactivity_members sm where sm.subactivity_id=p_subactivity_id
      union all
      select v_assignee
      union all
      select r.assigned_aqs_id from public.aqs_reviews r
      where r.subactivity_id=p_subactivity_id and r.status in ('awaiting','evaluating') and r.assigned_aqs_id is not null
      union all
      select wm.user_id from public.workspace_members wm
      where wm.workspace_id=v_workspace and wm.active and wm.role='admin'::public.workspace_role
    ) candidate
    where candidate.user_id is not null
      and candidate.user_id is distinct from p_actor_id
      and not (candidate.user_id=any(coalesce(p_excluded_user_ids,'{}'::uuid[])))
      and (not p_exclude_assignee or candidate.user_id is distinct from v_assignee)
  loop
    perform public.upsert_followup_update_notification(
      v_recipient,p_actor_id,p_title,p_description,v_project,v_activity,p_subactivity_id
    );
  end loop;
end;
$$;

revoke execute on function public.notify_followup_subactivity_participants(uuid,uuid,text,text,uuid[],boolean) from public,anon,authenticated;

-- Mensagens: o responsável já recebe a notificação específica
-- subactivity-comment pelo RPC. Para ele não receber duas entradas iguais, o
-- marcador followup-update fica reservado aos demais participantes. Menções
-- continuam tendo prioridade própria.
create or replace function public.followup_comment_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_excluded uuid[]:='{}'::uuid[];
  v_sub_title text;
begin
  select s.title into v_sub_title from public.subactivities s where s.id=new.subactivity_id;

  select coalesce(array_agg(distinct (m.value->>'id')::uuid),'{}'::uuid[])
  into v_excluded
  from jsonb_array_elements(coalesce(new.mentions,'[]'::jsonb)) m(value)
  where m.value->>'kind'='user'
    and (m.value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  perform public.notify_followup_subactivity_participants(
    new.subactivity_id,new.author_id,'Nova mensagem no acompanhamento',
    format('“%s” · %s',coalesce(v_sub_title,'Subatividade'),left(regexp_replace(new.content,'[[:space:]]+',' ','g'),180)),
    v_excluded,true
  );
  return new;
end;
$$;

drop trigger if exists followup_comment_unread on public.subactivity_comments;
create trigger followup_comment_unread
  after insert on public.subactivity_comments
  for each row execute function public.followup_comment_unread_trigger();

-- Status e demais alterações da subatividade também geram aviso para quem
-- acompanha. Os nomes são apresentados em PT-BR para a notificação nunca
-- expor os valores técnicos do enum ao usuário.
create or replace function public.followup_subactivity_update_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_description text;
  v_old_status text;
  v_new_status text;
begin
  if new.title is not distinct from old.title
     and new.status is not distinct from old.status
     and new.assignee_id is not distinct from old.assignee_id
     and new.estimated_hours is not distinct from old.estimated_hours then
    return new;
  end if;

  if new.status is distinct from old.status then
    v_old_status := case old.status::text
      when 'backlog' then 'Backlog'
      when 'waiting' then 'Aguardando'
      when 'waiting-aqs' then 'Aguardando AQS'
      when 'in-progress' then 'Executando'
      when 'paused' then 'Pausada'
      when 'done' then 'Concluída'
      when 'cancelled' then 'Cancelada'
      else 'Status anterior'
    end;
    v_new_status := case new.status::text
      when 'backlog' then 'Backlog'
      when 'waiting' then 'Aguardando'
      when 'waiting-aqs' then 'Aguardando AQS'
      when 'in-progress' then 'Executando'
      when 'paused' then 'Pausada'
      when 'done' then 'Concluída'
      when 'cancelled' then 'Cancelada'
      else 'Status atualizado'
    end;
    v_description := format('“%s” · %s → %s',new.title,v_old_status,v_new_status);
  elsif new.title is distinct from old.title then
    v_description := format('“%s” agora se chama “%s”.',old.title,new.title);
  elsif new.assignee_id is distinct from old.assignee_id then
    v_description := format('O responsável por “%s” foi alterado.',new.title);
  else
    v_description := format('A estimativa de “%s” foi alterada.',new.title);
  end if;

  perform public.notify_followup_subactivity_participants(
    new.id,auth.uid(),
    case when new.status is distinct from old.status then 'Status atualizado' else 'Subatividade atualizada' end,
    v_description
  );
  return new;
end;
$$;

drop trigger if exists followup_subactivity_update_unread on public.subactivities;
create trigger followup_subactivity_update_unread
  after update on public.subactivities
  for each row execute function public.followup_subactivity_update_unread_trigger();

-- Um único trigger cobre os três níveis. Subatividade preserva o comportamento
-- da migration 038; atividade/projeto passam a receber o mesmo tipo de aviso.
create or replace function public.followup_attachment_unread_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_title text;
  v_project uuid;
begin
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

drop trigger if exists followup_attachment_unread on public.attachments;
create trigger followup_attachment_unread
  after insert on public.attachments
  for each row execute function public.followup_attachment_unread_trigger();

commit;
