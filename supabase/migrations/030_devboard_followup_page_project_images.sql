begin;

-- 030 · Acompanhamento como página + imagem customizada por projeto
-- A rota do Acompanhamento é uma alteração de frontend. Esta migration adiciona
-- somente a persistência/Storage necessários para a imagem personalizada do projeto.

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
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name,'/',2)
      and (
        public.is_workspace_admin(p.workspace_id)
        or p.created_by = auth.uid()
        or (
          public.workspace_role_of(p.workspace_id, auth.uid()) = 'developer'
          and exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
          )
        )
      )
  )
);

create policy devboard_project_icons_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name,'/',2)
      and (
        public.is_workspace_admin(p.workspace_id)
        or p.created_by = auth.uid()
        or (
          public.workspace_role_of(p.workspace_id, auth.uid()) = 'developer'
          and exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
          )
        )
      )
  )
)
with check (
  bucket_id = 'devboard-project-icons'
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name,'/',2)
      and (
        public.is_workspace_admin(p.workspace_id)
        or p.created_by = auth.uid()
        or (
          public.workspace_role_of(p.workspace_id, auth.uid()) = 'developer'
          and exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
          )
        )
      )
  )
);

create policy devboard_project_icons_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'devboard-project-icons'
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name,'/',2)
      and (
        public.is_workspace_admin(p.workspace_id)
        or p.created_by = auth.uid()
        or (
          public.workspace_role_of(p.workspace_id, auth.uid()) = 'developer'
          and exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid()
          )
        )
      )
  )
);

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
  v_workspace uuid;
  v_icon text := coalesce(nullif(btrim(p_icon),''),'folder-kanban');
  v_image_path text := nullif(btrim(coalesce(p_icon_image_path,'')),'');
begin
  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'Projeto não encontrado';
  end if;

  v_workspace := v_project.workspace_id;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if not public.is_workspace_admin(v_workspace)
     and v_project.created_by <> auth.uid()
     and (
       public.workspace_role_of(v_workspace, auth.uid()) <> 'developer'
       or not exists (
         select 1
         from public.project_members pm
         where pm.project_id = p_project_id
           and pm.user_id = auth.uid()
       )
     ) then
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
