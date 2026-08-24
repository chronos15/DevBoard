-- Devboard · Controle de horas · hotfix de permissão RLS
-- Corrige: "permission denied for function is_workspace_admin" após a migration 023.
--
-- A migration 001 revoga EXECUTE das funções auxiliares por padrão. A primeira versão
-- da policy 023 chamava is_workspace_admin(...) diretamente como authenticated, portanto
-- o PostgreSQL barrava a avaliação da policy antes mesmo de retornar work_sessions.
-- Este helper é propositalmente restrito: ele sempre usa auth.uid() e não permite consultar
-- o papel de outro usuário arbitrário.

create or replace function public.can_read_work_session(
  p_subactivity_id uuid,
  p_session_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and (
      p_session_user_id = auth.uid()
      or exists (
        select 1
        from public.subactivities s
        join public.activities a on a.id = s.activity_id
        join public.projects p on p.id = a.project_id
        join public.workspace_members wm on wm.workspace_id = p.workspace_id
        where s.id = p_subactivity_id
          and wm.user_id = auth.uid()
          and wm.active
          and wm.role = 'admin'
      )
    );
$$;

revoke execute on function public.can_read_work_session(uuid,uuid) from public, anon, authenticated;
grant execute on function public.can_read_work_session(uuid,uuid) to authenticated;

drop policy if exists cadence_work_sessions_select on public.work_sessions;
create policy cadence_work_sessions_select
on public.work_sessions
for select
to authenticated
using (public.can_read_work_session(subactivity_id, user_id));

-- Mantém is_workspace_admin(...) fechado para chamadas arbitrárias do cliente.
-- hours_report(...) é SECURITY DEFINER e pode continuar usando o helper internamente.
revoke execute on function public.is_workspace_admin(uuid,uuid) from public, anon, authenticated;
