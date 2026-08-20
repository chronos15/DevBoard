-- Devboard · Migration 016
-- Painel Dev: múltiplas IDEs + múltiplos projetos locais por developer.
-- Metadados sincronizam pelo Supabase; o handle real da pasta fica somente no navegador (IndexedDB).

begin;

create table if not exists public.developer_ides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null default 'vscode' check (kind in ('vscode','cursor','visual-studio','delphi','jetbrains','custom')),
  icon text not null default 'code' check (icon in ('code','braces','terminal','blocks','box','monitor','cpu','rocket','app')),
  custom_uri_template text not null default '',
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists developer_ides_user_name_unique_idx
  on public.developer_ides(user_id, lower(name));
create index if not exists developer_ides_user_sort_idx
  on public.developer_ides(user_id, sort_order, created_at);

create table if not exists public.developer_local_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  folder_name text not null default '',
  ide_id uuid references public.developer_ides(id) on delete set null,
  -- Mantido apenas para migrar o atalho antigo da migration 015 sem quebrar quem já usava.
  -- Novos projetos não precisam digitar caminho; a pasta real fica em um FileSystemDirectoryHandle local.
  legacy_path text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists developer_local_projects_user_idx
  on public.developer_local_projects(user_id, created_at);
create index if not exists developer_local_projects_ide_idx
  on public.developer_local_projects(ide_id);

drop trigger if exists developer_ides_set_updated_at on public.developer_ides;
create trigger developer_ides_set_updated_at
before update on public.developer_ides
for each row execute procedure public.set_updated_at();

drop trigger if exists developer_local_projects_set_updated_at on public.developer_local_projects;
create trigger developer_local_projects_set_updated_at
before update on public.developer_local_projects
for each row execute procedure public.set_updated_at();

alter table public.developer_ides enable row level security;
alter table public.developer_local_projects enable row level security;

-- Painel continua estritamente pessoal e exclusivo da role developer.
drop policy if exists devboard_developer_ides_all on public.developer_ides;
create policy devboard_developer_ides_all on public.developer_ides
for all to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

drop policy if exists devboard_developer_local_projects_all on public.developer_local_projects;
create policy devboard_developer_local_projects_all on public.developer_local_projects
for all to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

grant select, insert, update, delete on public.developer_ides to authenticated;
grant select, insert, update, delete on public.developer_local_projects to authenticated;

-- Migra a configuração simples da migration 015 para uma IDE e um projeto local.
-- Isso evita perder o atalho de quem já havia configurado o painel antigo.
insert into public.developer_ides (user_id, name, kind, icon, custom_uri_template)
select
  ds.user_id,
  case ds.ide_kind
    when 'vscode' then 'Visual Studio Code'
    when 'cursor' then 'Cursor'
    when 'visual-studio' then 'Visual Studio'
    when 'delphi' then 'Delphi'
    when 'jetbrains' then 'JetBrains'
    else 'IDE personalizada'
  end,
  ds.ide_kind,
  case ds.ide_kind
    when 'vscode' then 'code'
    when 'cursor' then 'braces'
    when 'visual-studio' then 'monitor'
    when 'delphi' then 'app'
    when 'jetbrains' then 'blocks'
    else 'terminal'
  end,
  ds.ide_custom_uri
from public.developer_settings ds
where not exists (
  select 1 from public.developer_ides di where di.user_id = ds.user_id
);

insert into public.developer_local_projects (user_id, name, folder_name, ide_id, legacy_path)
select
  ds.user_id,
  coalesce(nullif(regexp_replace(replace(ds.ide_workspace_path, E'\\', '/'), '^.*/', ''), ''), 'Workspace local'),
  coalesce(nullif(regexp_replace(replace(ds.ide_workspace_path, E'\\', '/'), '^.*/', ''), ''), 'Workspace local'),
  (
    select di.id
    from public.developer_ides di
    where di.user_id = ds.user_id
    order by di.created_at
    limit 1
  ),
  ds.ide_workspace_path
from public.developer_settings ds
where btrim(ds.ide_workspace_path) <> ''
  and not exists (
    select 1 from public.developer_local_projects dp where dp.user_id = ds.user_id
  );

-- Realtime só sincroniza metadados. O handle da pasta nunca sai do dispositivo.
do $$
declare
  v_table text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['developer_ides','developer_local_projects'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end $$;

commit;
