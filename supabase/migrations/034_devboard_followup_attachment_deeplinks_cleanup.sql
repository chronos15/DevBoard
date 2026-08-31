begin;

-- O próprio anexo já aparece na timeline do acompanhamento. Estes logs duplicavam
-- o mesmo evento e deixavam resíduos visuais depois de remover um arquivo.
delete from public.project_logs
where type in ('attachment-added','attachment-status');

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
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_project uuid;
  v_workspace uuid;
begin
  if (p_project_id is null)=(p_subactivity_id is null) then
    raise exception 'Informe projeto ou subatividade, exclusivamente';
  end if;
  if length(btrim(coalesce(p_name,'')))=0 then
    raise exception 'Nome do anexo é obrigatório';
  end if;
  if p_kind not in ('image','pdf','text','document','video','audio','other') then
    raise exception 'Tipo de anexo inválido';
  end if;
  if p_storage_path is null and p_text_content is null then
    raise exception 'Anexo sem conteúdo';
  end if;

  v_project:=coalesce(p_project_id,public.subactivity_project_id(p_subactivity_id));
  v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if p_storage_path is not null and (
    public.safe_path_workspace_id(p_storage_path) is distinct from v_workspace
    or split_part(p_storage_path,'/',3) is distinct from auth.uid()::text
  ) then
    raise exception 'Caminho de Storage inválido para este usuário/workspace';
  end if;

  insert into public.attachments(
    project_id,subactivity_id,name,mime_type,size_bytes,kind,storage_path,text_content,uploaded_by
  ) values (
    p_project_id,p_subactivity_id,btrim(p_name),coalesce(p_mime_type,'application/octet-stream'),
    greatest(coalesce(p_size_bytes,0),0),p_kind::public.attachment_kind,p_storage_path,p_text_content,auth.uid()
  ) returning id into v_id;

  -- Intencionalmente não cria project_log: o anexo já é um item da timeline.
  return v_id;
end;
$$;

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

  v_project:=coalesce(v.project_id,public.subactivity_project_id(v.subactivity_id));
  v_workspace:=public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;

  update public.attachments
     set active=p_active,status_changed_at=now(),status_changed_by=auth.uid()
   where id=p_attachment_id;

  -- Alterações de estado do anexo também não geram log redundante.
end;
$$;

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

-- Após a metadata ser removida, o autor já pode apagar seu próprio objeto pela
-- policy de rollback existente. Esta policy permite o mesmo ao Admin quando o
-- arquivo foi enviado por outro usuário, sem depender de is_workspace_admin().
drop policy if exists cadence_attachments_storage_admin_delete on storage.objects;
create policy cadence_attachments_storage_admin_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cadence-attachments'
    and not exists(select 1 from public.attachments a where a.storage_path = storage.objects.name)
    and exists(
      select 1
        from public.workspace_members wm
       where wm.workspace_id = public.safe_path_workspace_id(storage.objects.name)
         and wm.user_id = auth.uid()
         and wm.active = true
         and wm.role = 'admin'::public.workspace_role
    )
  );

revoke execute on function public.add_attachment(uuid,uuid,text,text,bigint,text,text,text) from public, anon;
grant execute on function public.add_attachment(uuid,uuid,text,text,bigint,text,text,text) to authenticated;
revoke execute on function public.set_attachment_active(uuid,boolean) from public, anon;
grant execute on function public.set_attachment_active(uuid,boolean) to authenticated;
revoke execute on function public.delete_followup_attachment(uuid) from public, anon;
grant execute on function public.delete_followup_attachment(uuid) to authenticated;

commit;
