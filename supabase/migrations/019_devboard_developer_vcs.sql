-- Devboard · Migration 019
-- Controle de versão local do Painel Dev.
-- O Agent executa Git/SVN localmente; o Supabase guarda apenas vínculos de commits/revisões
-- que o próprio developer decidiu associar às tarefas do Devboard.

begin;

alter table public.developer_local_projects
  add column if not exists devboard_project_id uuid references public.projects(id) on delete set null;

create index if not exists developer_local_projects_devboard_project_idx
  on public.developer_local_projects(user_id, devboard_project_id);

create table if not exists public.developer_vcs_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_project_id uuid references public.developer_local_projects(id) on delete set null,
  devboard_project_id uuid references public.projects(id) on delete set null,
  subactivity_id uuid references public.subactivities(id) on delete set null,
  provider text not null check (provider in ('git','svn')),
  revision text not null check (length(btrim(revision)) between 1 and 200),
  branch text not null default '',
  repository text not null default '',
  message text not null default '',
  source text not null default 'direct' check (source in ('direct','manual')),
  committed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists developer_vcs_changes_user_history_idx
  on public.developer_vcs_changes(user_id, committed_at desc);
create index if not exists developer_vcs_changes_subactivity_idx
  on public.developer_vcs_changes(subactivity_id, committed_at desc);
create index if not exists developer_vcs_changes_project_idx
  on public.developer_vcs_changes(devboard_project_id, committed_at desc);
create unique index if not exists developer_vcs_changes_link_unique_idx
  on public.developer_vcs_changes(user_id, local_project_id, provider, revision, subactivity_id);

alter table public.developer_vcs_changes enable row level security;

drop policy if exists devboard_developer_vcs_changes_all on public.developer_vcs_changes;
drop policy if exists devboard_developer_vcs_changes_select on public.developer_vcs_changes;
drop policy if exists devboard_developer_vcs_changes_insert on public.developer_vcs_changes;
drop policy if exists devboard_developer_vcs_changes_update on public.developer_vcs_changes;
drop policy if exists devboard_developer_vcs_changes_delete on public.developer_vcs_changes;

-- O developer é dono do vínculo. Quando o vínculo aponta para uma subatividade, os demais
-- membros daquele workspace (incluindo AQS/admin) podem ver somente o metadado do commit/revisão.
create policy devboard_developer_vcs_changes_select on public.developer_vcs_changes
for select to authenticated
using (
  user_id = auth.uid()
  or (
    subactivity_id is not null
    and public.is_workspace_member(
      public.project_workspace_id(public.subactivity_project_id(subactivity_id))
    )
  )
);

create policy devboard_developer_vcs_changes_insert on public.developer_vcs_changes
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

create policy devboard_developer_vcs_changes_update on public.developer_vcs_changes
for update to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
)
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

create policy devboard_developer_vcs_changes_delete on public.developer_vcs_changes
for delete to authenticated
using (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

grant select, insert, update, delete on public.developer_vcs_changes to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='developer_vcs_changes'
     ) then
    alter publication supabase_realtime add table public.developer_vcs_changes;
  end if;
end $$;

commit;
