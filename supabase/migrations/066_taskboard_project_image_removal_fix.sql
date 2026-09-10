begin;

-- 066 · Remoção/troca definitiva da imagem do projeto
--
-- Corrige dois comportamentos:
--   1) a UI marcava a imagem como removida, mas ao voltar para a aba "Imagem"
--      a foto antiga reaparecia silenciosamente;
--   2) a policy DELETE da migration 065 exigia que o primeiro segmento do
--      caminho fosse o auth.uid() atual. Isso impedia um Admin de apagar uma
--      imagem originalmente enviada por outro usuário.
--
-- O INSERT continua exigindo que o upload seja gravado na pasta do usuário
-- autenticado. UPDATE/DELETE de objetos existentes passam a validar o projeto
-- contido no segundo segmento do caminho, permitindo administração legítima do
-- projeto independentemente de quem fez o upload original.

create or replace function public.project_icon_storage_manage_existing_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null or nullif(btrim(coalesce(p_name, '')), '') is null then
    return false;
  end if;

  begin
    v_project_id := split_part(p_name, '/', 2)::uuid;
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

revoke execute on function public.project_icon_storage_manage_existing_allowed(text) from public, anon;
grant execute on function public.project_icon_storage_manage_existing_allowed(text) to authenticated;

-- Recria somente as policies necessárias. INSERT mantém a proteção da 065:
-- o usuário só pode criar objetos dentro da própria pasta.
drop policy if exists devboard_project_icons_insert on storage.objects;
drop policy if exists devboard_project_icons_update on storage.objects;
drop policy if exists devboard_project_icons_delete on storage.objects;

create policy devboard_project_icons_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'devboard-project-icons'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.project_icon_storage_manage_existing_allowed(name)
);

create policy devboard_project_icons_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_manage_existing_allowed(name)
)
with check (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_manage_existing_allowed(name)
);

create policy devboard_project_icons_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.project_icon_storage_manage_existing_allowed(name)
);

-- Reafirma a RPC visual sem qualquer dependência de is_workspace_admin e
-- permite explicitamente p_icon_image_path = NULL para remover a imagem.
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
  v_icon text := coalesce(nullif(btrim(p_icon), ''), 'folder-kanban');
  v_image_path text := nullif(btrim(coalesce(p_icon_image_path, '')), '');
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'Projeto não encontrado';
  end if;

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
    if split_part(v_image_path, '/', 2) is distinct from p_project_id::text then
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
      case when v_image_path is null then 'Imagem personalizada removida; usando ícone do TaskBoard' else 'Imagem personalizada' end,
      auth.uid()
    );
  end if;
end;
$$;

revoke execute on function public.set_project_visual(uuid, text, text) from public, anon;
grant execute on function public.set_project_visual(uuid, text, text) to authenticated;

-- Mantém o helper administrativo sensível fechado ao cliente.
revoke execute on function public.is_workspace_admin(uuid, uuid) from public, anon, authenticated;

commit;
