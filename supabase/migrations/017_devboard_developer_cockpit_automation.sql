-- Devboard · Migration 017
-- Painel Dev: automações pessoais, contextos/launcher e ajustes de sessão.
-- Continua estritamente pessoal e exclusivo da role developer.

begin;

alter table public.developer_settings
  add column if not exists auto_focus_on_timer boolean not null default true,
  add column if not exists auto_open_ide_on_timer boolean not null default false,
  add column if not exists auto_open_music_on_timer boolean not null default false,
  add column if not exists notify_forgotten_timer boolean not null default true,
  add column if not exists forgotten_timer_minutes integer not null default 120,
  add column if not exists notify_wrapup boolean not null default true,
  add column if not exists wrapup_minutes integer not null default 30;

-- Constraints adicionadas de forma idempotente para instalações que já possuam a tabela.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'developer_settings_forgotten_timer_minutes_check'
      and conrelid = 'public.developer_settings'::regclass
  ) then
    alter table public.developer_settings
      add constraint developer_settings_forgotten_timer_minutes_check
      check (forgotten_timer_minutes between 30 and 480);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'developer_settings_wrapup_minutes_check'
      and conrelid = 'public.developer_settings'::regclass
  ) then
    alter table public.developer_settings
      add constraint developer_settings_wrapup_minutes_check
      check (wrapup_minutes between 5 and 120);
  end if;
end $$;

create table if not exists public.developer_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  devboard_project_id uuid references public.projects(id) on delete set null,
  local_project_id uuid references public.developer_local_projects(id) on delete set null,
  ide_id uuid references public.developer_ides(id) on delete set null,
  music_provider text not null default 'spotify' check (music_provider in ('spotify','youtube-music')),
  music_url text not null default '',
  auto_focus boolean not null default true,
  auto_open_ide boolean not null default true,
  auto_open_music boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists developer_contexts_user_sort_idx
  on public.developer_contexts(user_id, sort_order, created_at);
create index if not exists developer_contexts_project_idx
  on public.developer_contexts(user_id, devboard_project_id);

-- Um developer pode ter vários contextos, inclusive para o mesmo projeto,
-- mas nomes duplicados no próprio painel só confundem o launcher.
create unique index if not exists developer_contexts_user_name_unique_idx
  on public.developer_contexts(user_id, lower(name));

drop trigger if exists developer_contexts_set_updated_at on public.developer_contexts;
create trigger developer_contexts_set_updated_at
before update on public.developer_contexts
for each row execute procedure public.set_updated_at();

alter table public.developer_contexts enable row level security;

drop policy if exists devboard_developer_contexts_all on public.developer_contexts;
create policy devboard_developer_contexts_all on public.developer_contexts
for all to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

grant select, insert, update, delete on public.developer_contexts to authenticated;

-- Contextos são metadados pessoais; sincronizam entre dispositivos.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='developer_contexts'
     ) then
    alter publication supabase_realtime add table public.developer_contexts;
  end if;
end $$;

commit;
