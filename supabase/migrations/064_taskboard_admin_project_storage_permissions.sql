begin;

-- 064 · Administração de projetos + hardening das policies de Storage
--
-- Corrige o erro:
--   permission denied for function is_workspace_admin
--
-- Motivo: is_workspace_admin(uuid,uuid) é propositalmente fechada para chamadas
-- diretas do role authenticated (migration 024). Policies de storage.objects não
-- podem depender diretamente dela. Os helpers abaixo respondem apenas sobre o
-- usuário autenticado e são seguros para uso em RLS.

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

-- Qualquer administrador ativo do workspace pode alterar a identidade visual de
-- qualquer projeto do workspace, mesmo sem constar em project_members.
create or replace function public.can_manage_project_visual(p_project_id_text text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.projects p
      join public.workspace_members wm
        on wm.workspace_id = p.workspace_id
       and wm.user_id = auth.uid()
       and wm.active
      where p.id::text = p_project_id_text
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
$$;

revoke execute on function public.can_manage_project_visual(text) from public, anon;
grant execute on function public.can_manage_project_visual(text) to authenticated;

-- Reafirma as policies do bucket de imagens de projeto sem qualquer chamada
-- direta a is_workspace_admin(...).
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
  and split_part(name, '/', 1) = auth.uid()::text
  and public.can_manage_project_visual(split_part(name, '/', 2))
);

create policy devboard_project_icons_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.can_manage_project_visual(split_part(name, '/', 2))
)
with check (
  bucket_id = 'devboard-project-icons'
  and public.can_manage_project_visual(split_part(name, '/', 2))
);

create policy devboard_project_icons_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.can_manage_project_visual(split_part(name, '/', 2))
);

-- A migration 061 introduziu o mesmo problema no bucket de arquivos dos comandos.
-- Corrigimos junto para não deixar outro ponto administrativo quebrado.
drop policy if exists taskboard_command_files_select on storage.objects;
drop policy if exists taskboard_command_files_insert on storage.objects;
drop policy if exists taskboard_command_files_delete on storage.objects;

create policy taskboard_command_files_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'taskboard-command-files'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
);

create policy taskboard_command_files_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'taskboard-command-files'
  and public.current_user_is_workspace_admin(public.safe_path_workspace_id(name))
  and split_part(name, '/', 3) = auth.uid()::text
);

create policy taskboard_command_files_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'taskboard-command-files'
  and public.current_user_is_workspace_admin(public.safe_path_workspace_id(name))
);

-- Administração do projeto não depende de participação em project_members.
-- Desenvolvedores continuam precisando estar integrados. Ao editar como admin,
-- não adicionamos o próprio admin automaticamente ao projeto.
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

  if v_role is null then
    raise exception 'Sem permissão para editar projetos';
  end if;

  if v_role <> 'admin' and (
    v_role <> 'developer'
    or not exists (
      select 1
      from public.project_members pm
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

  -- Admin edita sem precisar se tornar membro do projeto. Para DEV preservamos
  -- o próprio vínculo, que é a condição que permite a edição.
  v_requested_members := coalesce(p_member_ids, '{}'::uuid[]);
  if v_role = 'developer' then
    v_requested_members := array_append(v_requested_members, auth.uid());
  end if;

  delete from public.project_members where project_id = p_project_id;

  insert into public.project_members(project_id, user_id, added_by)
  select p_project_id, x.user_id, auth.uid()
  from (
    select distinct unnest(v_requested_members) as user_id
  ) x
  where exists (
    select 1
    from public.workspace_members wm
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

-- Mantém o helper interno sensível fechado para chamadas arbitrárias do cliente.
revoke execute on function public.is_workspace_admin(uuid,uuid) from public, anon, authenticated;

commit;
