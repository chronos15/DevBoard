begin;

-- Permite que evidências tenham como pai direto uma atividade, mantendo os
-- destinos já existentes (projeto ou subatividade) intactos.
alter table public.attachments
  add column if not exists activity_id uuid references public.activities(id) on delete cascade;

alter table public.attachments
  drop constraint if exists attachments_one_parent;

alter table public.attachments
  add constraint attachments_one_parent check (
    num_nonnulls(project_id, activity_id, subactivity_id) = 1
  );

create index if not exists attachments_activity_idx
  on public.attachments(activity_id, created_at desc)
  where activity_id is not null;

-- A leitura precisa considerar o novo pai activity_id.
drop policy if exists cadence_attachments_select on public.attachments;
create policy cadence_attachments_select
  on public.attachments for select to authenticated
  using (
    public.is_workspace_member(
      public.project_workspace_id(
        coalesce(
          project_id,
          public.activity_project_id(activity_id),
          public.subactivity_project_id(subactivity_id)
        )
      )
    )
  );

-- RPC separado evita alterar/ambiguar a assinatura de add_attachment(), usada
-- em todo o restante do projeto.
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
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_project uuid;
  v_workspace uuid;
begin
  if p_activity_id is null then
    raise exception 'Atividade não informada';
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

  v_project := public.activity_project_id(p_activity_id);
  if v_project is null then
    raise exception 'Atividade não encontrada';
  end if;

  v_workspace := public.project_workspace_id(v_project);
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
    activity_id,name,mime_type,size_bytes,kind,storage_path,text_content,uploaded_by
  ) values (
    p_activity_id,btrim(p_name),coalesce(p_mime_type,'application/octet-stream'),
    greatest(coalesce(p_size_bytes,0),0),p_kind::public.attachment_kind,
    p_storage_path,p_text_content,auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

-- set_attachment_active() também passa a reconhecer anexos de atividade.
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

  update public.attachments
     set active=p_active,status_changed_at=now(),status_changed_by=auth.uid()
   where id=p_attachment_id;
end;
$$;

revoke execute on function public.add_activity_attachment(uuid,text,text,bigint,text,text,text) from public, anon;
grant execute on function public.add_activity_attachment(uuid,text,text,bigint,text,text,text) to authenticated;

revoke execute on function public.set_attachment_active(uuid,boolean) from public, anon;
grant execute on function public.set_attachment_active(uuid,boolean) to authenticated;

commit;
