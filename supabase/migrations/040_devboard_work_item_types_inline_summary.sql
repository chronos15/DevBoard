begin;

-- =============================================================================
-- 040 · Tipos dinâmicos de atividade/subatividade + classificação
-- =============================================================================
-- Mantém type_id opcional para não quebrar registros antigos.
-- O catálogo é do workspace e somente Admin pode criar/alterar/excluir tipos.
-- Integrantes do projeto podem selecionar um tipo existente nos registros.

create table if not exists public.work_item_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null default '#64748B',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_item_types_name_check check (length(btrim(name)) between 1 and 48),
  constraint work_item_types_color_check check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index if not exists work_item_types_workspace_name_uidx
  on public.work_item_types(workspace_id, lower(btrim(name)));

create index if not exists work_item_types_workspace_active_idx
  on public.work_item_types(workspace_id, active, name);

alter table public.activities
  add column if not exists type_id uuid references public.work_item_types(id) on delete set null;

alter table public.subactivities
  add column if not exists type_id uuid references public.work_item_types(id) on delete set null;

create index if not exists activities_type_idx on public.activities(type_id) where type_id is not null;
create index if not exists subactivities_type_idx on public.subactivities(type_id) where type_id is not null;

alter table public.work_item_types enable row level security;
alter table public.work_item_types replica identity full;

drop policy if exists work_item_types_select_workspace on public.work_item_types;
create policy work_item_types_select_workspace
  on public.work_item_types
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.work_item_types from anon, authenticated;
grant select on public.work_item_types to authenticated;

-- Catálogo inicial. O administrador pode desativar o que não usar e criar novos.
insert into public.work_item_types(workspace_id,name,color,active,created_by)
select w.id, seed.name, seed.color, true, null
from public.workspaces w
cross join (
  values
    ('Ajuste',          '#0EA5E9'),
    ('Correção',        '#F59E0B'),
    ('Erro',            '#EF4444'),
    ('Implementação',   '#8B5CF6'),
    ('Desenvolvimento', '#3B82F6'),
    ('Integração',      '#14B8A6')
) as seed(name,color)
on conflict do nothing;

create or replace function public.create_work_item_type(
  p_name text,
  p_color text default '#64748B'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_name text := btrim(coalesce(p_name,''));
  v_color text := upper(btrim(coalesce(p_color,'#64748B')));
  v_id uuid;
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não autenticado';
  end if;
  if public.workspace_role_of(v_workspace,auth.uid()) <> 'admin' then
    raise exception 'Apenas administradores podem criar tipos';
  end if;
  if length(v_name) < 1 or length(v_name) > 48 then
    raise exception 'O nome do tipo deve ter entre 1 e 48 caracteres';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Cor inválida';
  end if;

  insert into public.work_item_types(workspace_id,name,color,active,created_by)
  values(v_workspace,v_name,v_color,true,auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um tipo com este nome';
end;
$$;

create or replace function public.update_work_item_type(
  p_type_id uuid,
  p_name text default null,
  p_color text default null,
  p_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type public.work_item_types%rowtype;
  v_name text;
  v_color text;
begin
  select * into v_type
    from public.work_item_types
   where id=p_type_id
   for update;

  if not found then raise exception 'Tipo não encontrado'; end if;
  if public.workspace_role_of(v_type.workspace_id,auth.uid()) <> 'admin' then
    raise exception 'Apenas administradores podem alterar tipos';
  end if;

  v_name := case when p_name is null then v_type.name else btrim(p_name) end;
  v_color := case when p_color is null then v_type.color else upper(btrim(p_color)) end;

  if length(v_name) < 1 or length(v_name) > 48 then
    raise exception 'O nome do tipo deve ter entre 1 e 48 caracteres';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Cor inválida';
  end if;

  update public.work_item_types
     set name=v_name,
         color=v_color,
         active=coalesce(p_active,active),
         updated_at=now()
   where id=p_type_id;
exception
  when unique_violation then
    raise exception 'Já existe um tipo com este nome';
end;
$$;

create or replace function public.delete_work_item_type(p_type_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type public.work_item_types%rowtype;
begin
  select * into v_type
    from public.work_item_types
   where id=p_type_id
   for update;

  if not found then raise exception 'Tipo não encontrado'; end if;
  if public.workspace_role_of(v_type.workspace_id,auth.uid()) <> 'admin' then
    raise exception 'Apenas administradores podem excluir tipos';
  end if;

  if exists(select 1 from public.activities where type_id=p_type_id)
     or exists(select 1 from public.subactivities where type_id=p_type_id) then
    raise exception 'Este tipo já está em uso. Desative-o para impedir novos usos sem perder o histórico';
  end if;

  delete from public.work_item_types where id=p_type_id;
end;
$$;

create or replace function public.set_activity_type(
  p_activity_id uuid,
  p_type_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_role text;
begin
  select a.project_id into v_project
    from public.activities a
   where a.id=p_activity_id;

  if v_project is null then raise exception 'Atividade não encontrada'; end if;
  v_workspace := public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;

  v_role := public.workspace_role_of(v_workspace,auth.uid());
  if v_role <> 'admin' and not exists(
    select 1 from public.project_members pm
     where pm.project_id=v_project and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para alterar o tipo';
  end if;

  if p_type_id is not null and not exists(
    select 1 from public.work_item_types wit
     where wit.id=p_type_id and wit.workspace_id=v_workspace and wit.active=true
  ) then
    raise exception 'Tipo inválido ou inativo para este workspace';
  end if;

  update public.activities set type_id=p_type_id, updated_at=now() where id=p_activity_id;
end;
$$;

create or replace function public.set_subactivity_type(
  p_subactivity_id uuid,
  p_type_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity uuid;
  v_project uuid;
  v_workspace uuid;
  v_role text;
begin
  select s.activity_id into v_activity
    from public.subactivities s
   where s.id=p_subactivity_id;

  if v_activity is null then raise exception 'Subatividade não encontrada'; end if;
  v_project := public.activity_project_id(v_activity);
  v_workspace := public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;

  v_role := public.workspace_role_of(v_workspace,auth.uid());
  if v_role <> 'admin' and not exists(
    select 1 from public.project_members pm
     where pm.project_id=v_project and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para alterar o tipo';
  end if;

  if p_type_id is not null and not exists(
    select 1 from public.work_item_types wit
     where wit.id=p_type_id and wit.workspace_id=v_workspace and wit.active=true
  ) then
    raise exception 'Tipo inválido ou inativo para este workspace';
  end if;

  update public.subactivities set type_id=p_type_id, updated_at=now() where id=p_subactivity_id;
end;
$$;

revoke execute on function public.create_work_item_type(text,text) from public,anon;
revoke execute on function public.update_work_item_type(uuid,text,text,boolean) from public,anon;
revoke execute on function public.delete_work_item_type(uuid) from public,anon;
revoke execute on function public.set_activity_type(uuid,uuid) from public,anon;
revoke execute on function public.set_subactivity_type(uuid,uuid) from public,anon;

grant execute on function public.create_work_item_type(text,text) to authenticated;
grant execute on function public.update_work_item_type(uuid,text,text,boolean) to authenticated;
grant execute on function public.delete_work_item_type(uuid) to authenticated;
grant execute on function public.set_activity_type(uuid,uuid) to authenticated;
grant execute on function public.set_subactivity_type(uuid,uuid) to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
        where pubname='supabase_realtime'
          and schemaname='public'
          and tablename='work_item_types'
     ) then
    alter publication supabase_realtime add table public.work_item_types;
  end if;
end $$;

commit;
