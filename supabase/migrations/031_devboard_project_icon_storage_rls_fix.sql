begin;

-- 031 · Corrige upload de imagem do projeto após o hardening da migration 024.
--
-- A migration 024 remove EXECUTE de is_workspace_admin(uuid,uuid) do role
-- authenticated de propósito. As policies do Storage criadas na 030 chamavam
-- esse helper diretamente e, por isso, o upload falhava com:
--   permission denied for function is_workspace_admin
--
-- Este helper expõe somente a pergunta "o usuário atual pode alterar a identidade
-- visual deste projeto?". Ele nunca aceita um user_id arbitrário.
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
          wm.role = 'admin'
          or p.created_by = auth.uid()
          or (
            wm.role = 'developer'
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

-- Recria as policies sem chamar is_workspace_admin diretamente.
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
  and split_part(name,'/',1) = auth.uid()::text
  and public.can_manage_project_visual(split_part(name,'/',2))
);

create policy devboard_project_icons_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.can_manage_project_visual(split_part(name,'/',2))
)
with check (
  bucket_id = 'devboard-project-icons'
  and public.can_manage_project_visual(split_part(name,'/',2))
);

create policy devboard_project_icons_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and public.can_manage_project_visual(split_part(name,'/',2))
);

-- Também remove a dependência do helper restrito dentro da RPC da identidade visual.
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

  if not public.can_manage_project_visual(p_project_id::text) then
    raise exception 'Você precisa estar integrado ao projeto para alterar a identidade visual';
  end if;

  if v_icon not in (
    'folder-kanban','code','smartphone','monitor','server','database','globe',
    'shopping-cart','credit-card','store','package','boxes','wrench','rocket','bug','shield'
  ) then
    raise exception 'Ícone de projeto inválido';
  end if;

  if v_image_path is not null and not exists (
    select 1
    from storage.objects so
    where so.bucket_id = 'devboard-project-icons'
      and so.name = v_image_path
  ) then
    raise exception 'Imagem personalizada não encontrada no Storage';
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
      case when v_image_path is null then 'Ícone do Devboard' else 'Imagem personalizada' end,
      auth.uid()
    );
  end if;
end;
$$;

revoke execute on function public.set_project_visual(uuid,text,text) from public, anon;
grant execute on function public.set_project_visual(uuid,text,text) to authenticated;

commit;
