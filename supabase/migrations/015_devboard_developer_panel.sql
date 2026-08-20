-- Devboard · Migration 015
-- Painel pessoal do Desenvolvedor: expediente, hidratação, notas e ambiente.
-- Totalmente desacoplado de projetos: os dados pertencem somente ao usuário developer.

begin;

create table if not exists public.developer_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  work_start time not null default '08:00',
  work_end time not null default '18:00',
  break_start time not null default '12:00',
  break_end time not null default '13:00',
  work_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  hydration_goal_ml integer not null default 2500 check (hydration_goal_ml between 500 and 10000),
  hydration_cup_ml integer not null default 300 check (hydration_cup_ml between 50 and 2000),
  hydration_reminder_minutes integer not null default 60 check (hydration_reminder_minutes between 15 and 240),
  notify_shift_end boolean not null default true,
  notify_hydration boolean not null default false,
  music_provider text not null default 'spotify' check (music_provider in ('spotify','youtube-music')),
  music_url text not null default '',
  ide_kind text not null default 'vscode' check (ide_kind in ('vscode','cursor','visual-studio','delphi','jetbrains','custom')),
  ide_workspace_path text not null default '',
  ide_custom_uri text not null default '',
  focus_minutes integer not null default 50 check (focus_minutes between 10 and 180),
  break_minutes integer not null default 10 check (break_minutes between 5 and 60),
  updated_at timestamptz not null default now(),
  constraint developer_settings_work_days_valid check (
    cardinality(work_days) between 1 and 7
    and work_days <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

create table if not exists public.developer_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(btrim(content)) between 1 and 6000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists developer_notes_user_idx
  on public.developer_notes(user_id, pinned desc, updated_at desc);

create table if not exists public.developer_water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_ml integer not null check (amount_ml between 50 and 2000),
  logged_at timestamptz not null default now()
);
create index if not exists developer_water_logs_user_day_idx
  on public.developer_water_logs(user_id, logged_at desc);

-- Usa o trigger comum do Devboard para manter updated_at consistente.
drop trigger if exists developer_settings_set_updated_at on public.developer_settings;
create trigger developer_settings_set_updated_at
before update on public.developer_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists developer_notes_set_updated_at on public.developer_notes;
create trigger developer_notes_set_updated_at
before update on public.developer_notes
for each row execute procedure public.set_updated_at();

alter table public.developer_settings enable row level security;
alter table public.developer_notes enable row level security;
alter table public.developer_water_logs enable row level security;

-- Nem admin acessa este módulo. A policy exige explicitamente role developer.
drop policy if exists devboard_developer_settings_select on public.developer_settings;
create policy devboard_developer_settings_select on public.developer_settings
for select to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

drop policy if exists devboard_developer_settings_insert on public.developer_settings;
create policy devboard_developer_settings_insert on public.developer_settings
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

drop policy if exists devboard_developer_settings_update on public.developer_settings;
create policy devboard_developer_settings_update on public.developer_settings
for update to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

drop policy if exists devboard_developer_notes_all on public.developer_notes;
create policy devboard_developer_notes_all on public.developer_notes
for all to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

drop policy if exists devboard_developer_water_logs_all on public.developer_water_logs;
create policy devboard_developer_water_logs_all on public.developer_water_logs
for all to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

grant select, insert, update on public.developer_settings to authenticated;
grant select, insert, update, delete on public.developer_notes to authenticated;
grant select, insert, delete on public.developer_water_logs to authenticated;

-- Sincroniza painel pessoal entre abas/dispositivos do próprio developer.
do $$
declare
  v_table text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['developer_settings','developer_notes','developer_water_logs'] loop
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
