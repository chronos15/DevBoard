-- Devboard · Migration 021
-- Captura o estado do repositório no início de uma sessão de desenvolvimento.
-- Serve como referência para saber de qual branch/revisão a tarefa partiu.

begin;

create table if not exists public.developer_vcs_task_baselines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_project_id uuid references public.developer_local_projects(id) on delete set null,
  devboard_project_id uuid references public.projects(id) on delete set null,
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  provider text not null check (provider in ('git','svn')),
  revision text not null default '',
  branch text not null default '',
  repository text not null default '',
  captured_at timestamptz not null default now(),
  unique(user_id, local_project_id, subactivity_id)
);

create index if not exists developer_vcs_task_baselines_subactivity_idx
  on public.developer_vcs_task_baselines(subactivity_id, captured_at desc);

alter table public.developer_vcs_task_baselines enable row level security;

create policy devboard_developer_vcs_task_baselines_select on public.developer_vcs_task_baselines
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_workspace_member(public.project_workspace_id(public.subactivity_project_id(subactivity_id)))
);

create policy devboard_developer_vcs_task_baselines_insert on public.developer_vcs_task_baselines
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_workspace_role(array['developer'::public.workspace_role])
);

create policy devboard_developer_vcs_task_baselines_update on public.developer_vcs_task_baselines
for update to authenticated
using (user_id = auth.uid() and public.has_workspace_role(array['developer'::public.workspace_role]))
with check (user_id = auth.uid() and public.has_workspace_role(array['developer'::public.workspace_role]));

create policy devboard_developer_vcs_task_baselines_delete on public.developer_vcs_task_baselines
for delete to authenticated
using (user_id = auth.uid() and public.has_workspace_role(array['developer'::public.workspace_role]));

grant select, insert, update, delete on public.developer_vcs_task_baselines to authenticated;

commit;
