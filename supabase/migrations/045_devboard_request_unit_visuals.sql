begin;

-- 045 · Identidade visual das Unidades de Solicitações
-- Mantém a estrutura de Solicitações/Projetos intacta e adiciona apenas
-- ícone/foto opcional para a navegação visual no estilo Acompanhamento.

alter table public.service_request_units
  add column if not exists icon text not null default 'building',
  add column if not exists icon_image_path text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'devboard-request-unit-icons',
  'devboard-request-unit-icons',
  true,
  3145728,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_service_request_unit_visual(p_unit_id_text text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select auth.uid() is not null and exists(
    select 1
    from public.service_request_units u
    join public.workspace_members wm
      on wm.workspace_id=u.workspace_id
     and wm.user_id=auth.uid()
     and wm.active
    where u.id::text=p_unit_id_text
      and wm.role::text='admin'
  );
$$;

revoke execute on function public.can_manage_service_request_unit_visual(text) from public,anon;
grant execute on function public.can_manage_service_request_unit_visual(text) to authenticated;

drop policy if exists devboard_request_unit_icons_select on storage.objects;
drop policy if exists devboard_request_unit_icons_insert on storage.objects;
drop policy if exists devboard_request_unit_icons_update on storage.objects;
drop policy if exists devboard_request_unit_icons_delete on storage.objects;

create policy devboard_request_unit_icons_select
on storage.objects for select
to public
using (bucket_id='devboard-request-unit-icons');

create policy devboard_request_unit_icons_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id='devboard-request-unit-icons'
  and split_part(name,'/',1)=auth.uid()::text
  and public.can_manage_service_request_unit_visual(split_part(name,'/',2))
);

create policy devboard_request_unit_icons_update
on storage.objects for update
to authenticated
using (
  bucket_id='devboard-request-unit-icons'
  and public.can_manage_service_request_unit_visual(split_part(name,'/',2))
)
with check (
  bucket_id='devboard-request-unit-icons'
  and public.can_manage_service_request_unit_visual(split_part(name,'/',2))
);

create policy devboard_request_unit_icons_delete
on storage.objects for delete
to authenticated
using (
  bucket_id='devboard-request-unit-icons'
  and public.can_manage_service_request_unit_visual(split_part(name,'/',2))
);

create or replace function public.set_service_request_unit_visual(
  p_unit_id uuid,
  p_icon text default 'building',
  p_icon_image_path text default null
)
returns void
language plpgsql
security definer
set search_path=public,storage,pg_temp
as $$
declare
  v_unit public.service_request_units%rowtype;
  v_icon text := coalesce(nullif(btrim(p_icon),''),'building');
  v_image_path text := nullif(btrim(coalesce(p_icon_image_path,'')),'');
begin
  select * into v_unit from public.service_request_units where id=p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada'; end if;

  if auth.uid() is null or not public.can_manage_service_request_unit_visual(p_unit_id::text) then
    raise exception 'Apenas administradores podem alterar a identidade visual da unidade';
  end if;

  if v_icon not in ('building','store','warehouse','factory','office','support','landmark','location','boxes') then
    raise exception 'Ícone de unidade inválido';
  end if;

  if v_image_path is not null and not exists(
    select 1 from storage.objects so
    where so.bucket_id='devboard-request-unit-icons' and so.name=v_image_path
  ) then
    raise exception 'Imagem personalizada não encontrada no Storage';
  end if;

  update public.service_request_units
     set icon=v_icon,
         icon_image_path=v_image_path,
         updated_at=now()
   where id=p_unit_id;
end;
$$;

revoke execute on function public.set_service_request_unit_visual(uuid,text,text) from public,anon;
grant execute on function public.set_service_request_unit_visual(uuid,text,text) to authenticated;

create or replace function public.delete_service_request_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path=public,storage,pg_temp
as $$
declare v_unit public.service_request_units%rowtype;
begin
  select * into v_unit from public.service_request_units where id=p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada'; end if;
  if not exists(
    select 1 from public.workspace_members wm
    where wm.workspace_id=v_unit.workspace_id and wm.user_id=auth.uid() and wm.active and wm.role::text='admin'
  ) then raise exception 'Apenas administradores podem excluir unidades'; end if;

  if v_unit.icon_image_path is not null then
    delete from storage.objects
    where bucket_id='devboard-request-unit-icons' and name=v_unit.icon_image_path;
  end if;

  delete from public.service_request_units where id=p_unit_id;
end;
$$;

revoke execute on function public.delete_service_request_unit(uuid) from public,anon;
grant execute on function public.delete_service_request_unit(uuid) to authenticated;

commit;
