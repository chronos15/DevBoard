begin;

-- 065 · Correção final de Storage para imagens de projeto e anexos
--
-- Objetivos:
--   1) garantir que Admin possa alterar a imagem de QUALQUER projeto do workspace;
--   2) não depender de EXECUTE direto em public.is_workspace_admin(...);
--   3) tornar a migration autocontida mesmo em ambiente que não recebeu a 064;
--   4) reafirmar a policy de upload de anexos sem reabrir o helper sensível.

alter table public.projects
  add column if not exists icon_image_path text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'devboard-project-icons',
  'devboard-project-icons',
  true,
  3145728,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Helper público restrito ao usuário autenticado. Não aceita user_id arbitrário.
create or replace function public.current_user_is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and p_workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.active
        and wm.role::text = 'admin'
    );
$$;

revoke execute on function public.current_user_is_workspace_admin(uuid) from public, anon;
grant execute on function public.current_user_is_workspace_admin(uuid) to authenticated;

-- Verifica a identidade visual diretamente pelo projeto, sem chamar
-- is_workspace_admin(...) e sem exigir project_members para Admin.
create or replace function public.can_manage_project_visual(p_project_id_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null or nullif(btrim(coalesce(p_project_id_text,'')),'') is null then
    return false;
  end if;

  begin
    v_project_id := p_project_id_text::uuid;
  exception when others then
    return false;
  end;

  return exists (
    select 1
    from public.projects p
    join public.workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = auth.uid()
     and wm.active
    where p.id = v_project_id
      and (
        wm.role::text = 'admin'
        or p.created_by = auth.uid()
        or (
          wm.role::text = 'developer'
          and exists (
            select 1
            from public.project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
end;
$$;

revoke execute on function public.can_manage_project_visual(text) from public, anon;
grant execute on function public.can_manage_project_visual(text) to authenticated;

-- Valida TODO o caminho do objeto de imagem em um único SECURITY DEFINER.
-- Formato esperado: <uploader>/<project>/<arquivo>
create or replace function public.project_icon_storage_write_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if split_part(p_name,'/',1) is distinct from auth.uid()::text then return false; end if;

  begin
    v_project_id := split_part(p_name,'/',2)::uuid;
  exception when others then
    return false;
  end;

  return exists (
    select 1
    from public.projects p
    join public.workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = auth.uid()
     and wm.active
    where p.id = v_project_id
      and (
        wm.role::text = 'admin'
        or p.created_by = auth.uid()
        or (
          wm.role::text = 'developer'
          and exists (
            select 1
            from public.project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
end;
$$;

revoke execute on function public.project_icon_storage_write_allowed(text) from public, anon;
grant execute on function public.project_icon_storage_write_allowed(text) to authenticated;

-- Recria as policies do bucket. Isso também substitui versões antigas que
-- eventualmente ficaram instaladas e chamavam is_workspace_admin diretamente.
drop policy if exists devboard_project_icons_select on storage.objects;
drop policy if exists devboard_project_icons_insert on storage.objects;
drop policy if exists devboard_project_icons_update on storage.objects;
drop policy if exists devboard_project_icons_delete on storage.objects;

create policy devboard_project_icons_select
on storage.objects for select
to public
using (bucket_id = 'devboard-project-icons');

create policy devboard_project_icons_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_write_allowed(name)
);

create policy devboard_project_icons_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_write_allowed(name)
)
with check (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_write_allowed(name)
);

create policy devboard_project_icons_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_write_allowed(name)
);

-- Atualização da identidade visual também faz a checagem diretamente na função,
-- evitando qualquer dependência de função administrativa bloqueada ao cliente.
create or replace function public.set_project_visual(
  p_project_id uuid,
  p_icon text,
  p_icon_image_path text default null
)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_icon text := coalesce(nullif(btrim(p_icon),''),'folder-kanban');
  v_image_path text := nullif(btrim(coalesce(p_icon_image_path,'')),'');
  v_can_manage boolean := false;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then raise exception 'Projeto não encontrado'; end if;

  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = v_project.workspace_id
      and wm.user_id = auth.uid()
      and wm.active
      and (
        wm.role::text = 'admin'
        or v_project.created_by = auth.uid()
        or (
          wm.role::text = 'developer'
          and exists (
            select 1
            from public.project_members pm
            where pm.project_id = v_project.id
              and pm.user_id = auth.uid()
          )
        )
      )
  ) into v_can_manage;

  if not v_can_manage then
    raise exception 'Você não tem permissão para alterar a identidade visual deste projeto';
  end if;

  if v_icon not in (
    'folder-kanban','code','smartphone','monitor','server','database','globe',
    'shopping-cart','credit-card','store','package','boxes','wrench','rocket','bug','shield'
  ) then
    raise exception 'Ícone de projeto inválido';
  end if;

  if v_image_path is not null then
    -- A imagem precisa existir no bucket e pertencer ao próprio projeto.
    if split_part(v_image_path,'/',2) is distinct from p_project_id::text then
      raise exception 'Imagem personalizada inválida para este projeto';
    end if;

    if not exists (
      select 1
      from storage.objects so
      where so.bucket_id = 'devboard-project-icons'
        and so.name = v_image_path
    ) then
      raise exception 'Imagem personalizada não encontrada no Storage';
    end if;
  end if;

  if v_project.icon is distinct from v_icon
     or v_project.icon_image_path is distinct from v_image_path then
    update public.projects
       set icon = v_icon,
           icon_image_path = v_image_path,
           updated_at = now()
     where id = p_project_id;

    perform public.add_project_log(
      p_project_id,
      'updated',
      'Identidade visual do projeto atualizada',
      case when v_image_path is null then 'Ícone do TaskBoard' else 'Imagem personalizada' end,
      auth.uid()
    );
  end if;
end;
$$;

revoke execute on function public.set_project_visual(uuid,text,text) from public, anon;
grant execute on function public.set_project_visual(uuid,text,text) to authenticated;

-- Também reafirma update_project para que Admin possa editar qualquer projeto
-- do workspace sem ser inserido automaticamente em project_members.
create or replace function public.update_project(
  p_project_id uuid,
  p_name text,
  p_client text,
  p_description text,
  p_tag text,
  p_priority text,
  p_due_date date,
  p_repository text default '',
  p_member_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_workspace uuid;
  v_role text;
  v_description text := '';
  v_old_members uuid[];
  v_member uuid;
  v_requested_members uuid[];
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then raise exception 'Projeto não encontrado'; end if;

  v_workspace := v_project.workspace_id;
  select wm.role::text into v_role
  from public.workspace_members wm
  where wm.workspace_id = v_workspace
    and wm.user_id = auth.uid()
    and wm.active;

  if v_role is null then raise exception 'Sem permissão para editar projetos'; end if;

  if v_role <> 'admin' and (
    v_role <> 'developer'
    or not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
    )
  ) then
    raise exception 'Você precisa estar integrado ao projeto para editá-lo';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_due_date is null then raise exception 'Data de entrega é obrigatória'; end if;
  if p_priority not in ('low', 'medium', 'high') then raise exception 'Prioridade inválida'; end if;

  if v_project.name is distinct from btrim(p_name) then
    v_description := v_description || format('Nome: “%s” → “%s”. ', v_project.name, btrim(p_name));
  end if;
  if v_project.client is distinct from coalesce(nullif(btrim(p_client), ''), 'Projeto interno') then
    v_description := v_description || 'Cliente/área alterado. ';
  end if;
  if v_project.description is distinct from coalesce(p_description, '') then
    v_description := v_description || 'Descrição alterada. ';
  end if;
  if v_project.tag is distinct from coalesce(nullif(btrim(p_tag), ''), 'Desenvolvimento') then
    v_description := v_description || 'Categoria alterada. ';
  end if;
  if v_project.priority::text is distinct from p_priority then
    v_description := v_description || 'Prioridade alterada. ';
  end if;
  if v_project.due_date is distinct from p_due_date then
    v_description := v_description || 'Data de entrega alterada. ';
  end if;
  if v_project.repository is distinct from coalesce(p_repository, '') then
    v_description := v_description || 'Repositório/caminho alterado. ';
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    into v_old_members
  from public.project_members
  where project_id = p_project_id;

  update public.projects
     set name = btrim(p_name),
         client = coalesce(nullif(btrim(p_client), ''), 'Projeto interno'),
         description = coalesce(p_description, ''),
         tag = coalesce(nullif(btrim(p_tag), ''), 'Desenvolvimento'),
         priority = p_priority::public.project_priority,
         due_date = p_due_date,
         repository = coalesce(p_repository, '')
   where id = p_project_id;

  v_requested_members := coalesce(p_member_ids, '{}'::uuid[]);
  if v_role = 'developer' then
    v_requested_members := array_append(v_requested_members, auth.uid());
  end if;

  delete from public.project_members where project_id = p_project_id;

  insert into public.project_members(project_id, user_id, added_by)
  select p_project_id, x.user_id, auth.uid()
  from (select distinct unnest(v_requested_members) as user_id) x
  where exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = v_workspace
      and wm.user_id = x.user_id
      and wm.active
  )
  on conflict do nothing;

  if v_old_members is distinct from (
    select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    from public.project_members
    where project_id = p_project_id
  ) then
    v_description := v_description || 'Responsáveis alterados. ';
  end if;

  perform public.add_project_log(
    p_project_id,
    'updated',
    'Projeto atualizado',
    nullif(btrim(v_description), ''),
    auth.uid()
  );

  for v_member in
    select user_id
    from public.project_members
    where project_id = p_project_id
      and user_id <> auth.uid()
      and not (user_id = any(v_old_members))
  loop
    perform public.push_notification(
      v_member,
      auth.uid(),
      'project-assigned',
      'Você foi adicionado a um projeto',
      btrim(p_name),
      p_project_id,
      null,
      null
    );
  end loop;
end;
$$;

revoke execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) from public, anon;
grant execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) to authenticated;

-- Reafirma a policy de anexos atual. O helper é SECURITY DEFINER e, portanto,
-- não precisa expor is_workspace_admin para o role authenticated.
drop policy if exists cadence_attachments_storage_insert on storage.objects;
create policy cadence_attachments_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'cadence-attachments'
  and public.followup_attachment_storage_insert_allowed(name)
);

-- Mantém o helper interno sensível fechado para chamadas arbitrárias do cliente.
revoke execute on function public.is_workspace_admin(uuid,uuid) from public, anon, authenticated;

commit;
