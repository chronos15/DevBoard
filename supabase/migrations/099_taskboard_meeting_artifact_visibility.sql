-- TaskBoard V226 · proteção e visibilidade administrativa dos artefatos de reunião.
--
-- Objetivos:
--   * gravações e PDFs automáticos de reunião não podem ser excluídos pelo owner;
--   * somente ADMIN pode ocultar/exibir esses registros;
--   * ocultar preserva o arquivo no Storage e pode ser revertido a qualquer momento;
--   * a regra vale para subatividade/análise (attachments) e solicitações.

begin;

-- Solicitações não possuíam estado ativo/inativo nos anexos. O default true
-- mantém 100% do comportamento anterior para documentos comuns.
alter table public.service_request_attachments
  add column if not exists active boolean not null default true;
alter table public.service_request_attachments
  add column if not exists status_changed_at timestamptz;
alter table public.service_request_attachments
  add column if not exists status_changed_by uuid references public.profiles(id) on delete set null;

create or replace function public.is_taskboard_meeting_artifact_name(p_name text)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select
    lower(coalesce(p_name,'')) like 'gravacao - %'
    or lower(coalesce(p_name,'')) like 'gravação - %'
    or lower(coalesce(p_name,'')) like 'chat da reunião - %.pdf'
    or lower(coalesce(p_name,'')) like 'chat da reuniao - %.pdf';
$$;

-- Anexos de projeto/atividade/subatividade continuam usando o mesmo RPC.
-- A única regra nova é: artefato automático de reunião só pode ter a
-- visibilidade alterada por ADMIN.
create or replace function public.set_attachment_active(p_attachment_id uuid,p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.attachments%rowtype;
  v_project uuid;
  v_workspace uuid;
begin
  select * into v from public.attachments where id=p_attachment_id for update;
  if not found then raise exception 'Anexo não encontrado'; end if;
  if v.active=p_active then return; end if;

  v_project := coalesce(
    v.project_id,
    public.activity_project_id(v.activity_id),
    public.subactivity_project_id(v.subactivity_id)
  );
  v_workspace := public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if public.is_taskboard_meeting_artifact_name(v.name)
     and not public.current_user_is_workspace_admin(v_workspace) then
    raise exception 'Somente ADMIN pode ocultar ou exibir registros de reunião';
  end if;

  update public.attachments
     set active=p_active,status_changed_at=now(),status_changed_by=auth.uid()
   where id=p_attachment_id;
end;
$$;

-- O registro automático da reunião é histórico técnico. Nem o owner nem o
-- ADMIN apagam a metadata/arquivo; ADMIN usa o estado ativo para ocultar/exibir.
create or replace function public.delete_followup_attachment(p_attachment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.attachments%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_is_admin boolean := false;
begin
  select * into v
    from public.attachments
   where id = p_attachment_id
   for update;

  if not found then return true; end if;
  if v.subactivity_id is null then
    raise exception 'Este anexo não pertence a uma subatividade';
  end if;

  v_project := public.subactivity_project_id(v.subactivity_id);
  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if public.is_taskboard_meeting_artifact_name(v.name) then
    raise exception 'Registros de reunião não podem ser excluídos; ADMIN pode ocultar a visualização';
  end if;

  select exists(
    select 1
      from public.workspace_members wm
     where wm.workspace_id = v_workspace
       and wm.user_id = auth.uid()
       and wm.active = true
       and wm.role = 'admin'::public.workspace_role
  ) into v_is_admin;

  if not v_is_admin
     and not (v.uploaded_by = auth.uid() and v.created_at >= now() - interval '30 minutes') then
    raise exception 'O anexo só pode ser excluído pelo autor nos primeiros 30 minutos';
  end if;

  delete from public.attachments where id = p_attachment_id;
  return true;
end;
$$;

create or replace function public.set_service_request_attachment_active(
  p_attachment_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v public.service_request_attachments%rowtype;
  v_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v
  from public.service_request_attachments
  where id=p_attachment_id
  for update;

  if not found then raise exception 'Anexo não encontrado'; end if;
  if not public.is_taskboard_meeting_artifact_name(v.name) then
    raise exception 'Somente registros automáticos de reunião podem ser controlados por esta ação';
  end if;

  v_workspace:=public.service_request_workspace_id(v.request_id);
  if v_workspace is null or not public.current_user_is_workspace_admin(v_workspace) then
    raise exception 'Somente ADMIN pode ocultar ou exibir registros de reunião';
  end if;

  if v.active is distinct from p_active then
    update public.service_request_attachments
       set active=p_active,
           status_changed_at=now(),
           status_changed_by=auth.uid()
     where id=p_attachment_id;
  end if;

  return true;
end;
$$;

-- Mantemos as policies SELECT das tabelas exatamente como já estavam. Assim, o UPDATE
-- de active chega via Realtime aos clientes e a UI remove o registro imediatamente;
-- a proteção efetiva do conteúdo fica também no Storage abaixo.

-- As policies de Storage também respeitam o estado oculto. Os helpers são
-- SECURITY DEFINER para consultar com segurança o estado da metadata usada
-- na decisão de acesso ao objeto.
create or replace function public.can_view_followup_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    public.is_workspace_member(public.safe_path_workspace_id(p_name))
    and (
      public.current_user_is_workspace_admin(public.safe_path_workspace_id(p_name))
      or not exists(
        select 1
        from public.attachments a
        where a.storage_path=p_name
          and public.is_taskboard_meeting_artifact_name(a.name)
          and a.active=false
      )
    );
$$;

create or replace function public.can_view_service_request_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    public.can_view_service_request(public.service_request_storage_request_id(p_name))
    and (
      public.current_user_is_workspace_admin(public.safe_path_workspace_id(p_name))
      or not exists(
        select 1
        from public.service_request_attachments a
        where a.storage_path=p_name
          and public.is_taskboard_meeting_artifact_name(a.name)
          and a.active=false
      )
    );
$$;

create or replace function public.can_delete_service_request_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    public.service_request_storage_write_allowed(p_name)
    and not exists(
      select 1
      from public.service_request_attachments a
      where a.storage_path=p_name
        and public.is_taskboard_meeting_artifact_name(a.name)
    );
$$;

drop policy if exists cadence_attachments_storage_select on storage.objects;
create policy cadence_attachments_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id='cadence-attachments'
  and public.can_view_followup_storage_object(name)
);

drop policy if exists service_request_media_select on storage.objects;
create policy service_request_media_select
on storage.objects for select
to authenticated
using (
  bucket_id='devboard-request-media'
  and public.can_view_service_request_media_object(name)
);

drop policy if exists service_request_media_delete on storage.objects;
create policy service_request_media_delete
on storage.objects for delete
to authenticated
using (
  bucket_id='devboard-request-media'
  and public.can_delete_service_request_media_object(name)
);

revoke execute on function public.set_attachment_active(uuid,boolean) from public,anon;
grant execute on function public.set_attachment_active(uuid,boolean) to authenticated;
revoke execute on function public.delete_followup_attachment(uuid) from public,anon;
grant execute on function public.delete_followup_attachment(uuid) to authenticated;
revoke execute on function public.set_service_request_attachment_active(uuid,boolean) from public,anon;
grant execute on function public.set_service_request_attachment_active(uuid,boolean) to authenticated;

-- Helpers usados pelas policies precisam ser executáveis pelo role que lê o Storage.
revoke execute on function public.can_view_followup_storage_object(text) from public,anon;
grant execute on function public.can_view_followup_storage_object(text) to authenticated;
revoke execute on function public.can_view_service_request_media_object(text) from public,anon;
grant execute on function public.can_view_service_request_media_object(text) to authenticated;
revoke execute on function public.can_delete_service_request_media_object(text) from public,anon;
grant execute on function public.can_delete_service_request_media_object(text) to authenticated;

-- A identificação pelo nome não expõe dados e é usada internamente pelas RPCs/policies.
revoke execute on function public.is_taskboard_meeting_artifact_name(text) from public,anon;
grant execute on function public.is_taskboard_meeting_artifact_name(text) to authenticated;

commit;
