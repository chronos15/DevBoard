-- TaskBoard V103 · Atividades sem responsável visíveis para qualquer DEV
-- Execute depois da migration 082.
--
-- Regra funcional:
--   * uma atividade sem registros em activity_assignees representa uma atividade
--     disponível para o time de desenvolvimento;
--   * qualquer usuário com role developer deve conseguir enxergá-la, mesmo com
--     perfil de acesso personalizado e restrições de projeto/atividade ativadas;
--   * atividades que possuem responsável continuam respeitando integralmente
--     restrict_projects / restrict_activities / restrict_subactivities.
--
-- Importante:
-- Para uma atividade sem responsável aparecer na árvore Projetos -> Atividades,
-- o projeto pai também precisa passar pela RLS. Por isso taskboard_can_view_project
-- concede a visualização do projeto ao DEV quando existir ao menos uma atividade
-- sem responsável dentro dele. Isso NÃO libera as demais atividades atribuídas:
-- cada atividade continua sendo filtrada por taskboard_can_view_activity().

begin;

-- ---------------------------------------------------------------------------
-- Projeto
-- DEV pode enxergar o projeto pai quando houver pelo menos uma atividade sem
-- responsável. O restante da regra permanece igual à V102.
-- ---------------------------------------------------------------------------
create or replace function public.taskboard_can_view_project(
  p_project_id uuid,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid;
  v_role text;
  v_enabled boolean;
  v_restrict_projects boolean;
begin
  if p_project_id is null or p_user is null then return false; end if;

  select p.workspace_id,
         wm.role::text,
         coalesce(ap.enabled,false),
         coalesce(ap.restrict_projects,false)
    into v_workspace,v_role,v_enabled,v_restrict_projects
    from public.projects p
    join public.workspace_members wm
      on wm.workspace_id=p.workspace_id
     and wm.user_id=p_user
     and wm.active
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=p.workspace_id
     and ap.user_id=p_user
   where p.id=p_project_id;

  if not found then return false; end if;
  if v_role='admin' or not v_enabled or not v_restrict_projects then return true; end if;

  -- Regra V103: atividade sem responsável é uma atividade disponível para
  -- qualquer desenvolvedor, portanto o projeto pai precisa ficar visível.
  if v_role='developer' and exists(
    select 1
      from public.activities a
     where a.project_id=p_project_id
       and not exists(
         select 1
           from public.activity_assignees aa
          where aa.activity_id=a.id
       )
     limit 1
  ) then
    return true;
  end if;

  return
    exists(
      select 1 from public.project_members pm
       where pm.project_id=p_project_id and pm.user_id=p_user
    )
    or exists(
      select 1
        from public.activities a
        join public.activity_assignees aa on aa.activity_id=a.id
       where a.project_id=p_project_id and aa.user_id=p_user
       limit 1
    )
    or exists(
      select 1
        from public.activities a
        join public.subactivities s on s.activity_id=a.id
       where a.project_id=p_project_id
         and (
           s.assignee_id=p_user
           or exists(
             select 1 from public.subactivity_members sm
              where sm.subactivity_id=s.id and sm.user_id=p_user
           )
         )
       limit 1
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Atividade
-- A exceção de atividade sem responsável acontece ANTES dos gates de projeto
-- e atividade. Assim ela permanece visível ao DEV independentemente do nível
-- de acesso configurado para aquele usuário.
-- ---------------------------------------------------------------------------
create or replace function public.taskboard_can_view_activity(
  p_activity_id uuid,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_role text;
  v_enabled boolean;
  v_restrict_projects boolean;
  v_restrict_activities boolean;
  v_project_allowed boolean := true;
begin
  if p_activity_id is null or p_user is null then return false; end if;

  select a.project_id,
         p.workspace_id,
         wm.role::text,
         coalesce(ap.enabled,false),
         coalesce(ap.restrict_projects,false),
         coalesce(ap.restrict_activities,false)
    into v_project,v_workspace,v_role,v_enabled,v_restrict_projects,v_restrict_activities
    from public.activities a
    join public.projects p on p.id=a.project_id
    join public.workspace_members wm
      on wm.workspace_id=p.workspace_id
     and wm.user_id=p_user
     and wm.active
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=p.workspace_id
     and ap.user_id=p_user
   where a.id=p_activity_id;

  if not found then return false; end if;
  if v_role='admin' or not v_enabled then return true; end if;

  -- Regra V103: sem responsável = disponível para qualquer DEV.
  if v_role='developer' and not exists(
    select 1
      from public.activity_assignees aa
     where aa.activity_id=p_activity_id
  ) then
    return true;
  end if;

  if v_restrict_projects then
    v_project_allowed :=
      exists(select 1 from public.project_members pm where pm.project_id=v_project and pm.user_id=p_user)
      or exists(
        select 1 from public.activities a
        join public.activity_assignees aa on aa.activity_id=a.id
        where a.project_id=v_project and aa.user_id=p_user
        limit 1
      )
      or exists(
        select 1 from public.activities a
        join public.subactivities s on s.activity_id=a.id
        where a.project_id=v_project
          and (s.assignee_id=p_user or exists(
            select 1 from public.subactivity_members sm
             where sm.subactivity_id=s.id and sm.user_id=p_user
          ))
        limit 1
      );
  end if;

  if not v_project_allowed then return false; end if;
  if not v_restrict_activities then return true; end if;

  return
    exists(
      select 1 from public.activity_assignees aa
       where aa.activity_id=p_activity_id and aa.user_id=p_user
    )
    or exists(
      select 1 from public.subactivities s
       where s.activity_id=p_activity_id
         and (
           s.assignee_id=p_user
           or exists(
             select 1 from public.subactivity_members sm
              where sm.subactivity_id=s.id and sm.user_id=p_user
           )
         )
       limit 1
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Subatividade
-- A atividade-pai sem responsável também precisa satisfazer o gate de
-- atividade dentro deste helper. A restrição específica de subatividades,
-- quando ativada, continua sendo respeitada normalmente.
-- ---------------------------------------------------------------------------
create or replace function public.taskboard_can_view_subactivity(
  p_subactivity_id uuid,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity uuid;
  v_project uuid;
  v_workspace uuid;
  v_role text;
  v_enabled boolean;
  v_restrict_projects boolean;
  v_restrict_activities boolean;
  v_restrict_subactivities boolean;
  v_assignee uuid;
  v_activity_unassigned boolean := false;
  v_project_allowed boolean := true;
  v_activity_allowed boolean := true;
begin
  if p_subactivity_id is null or p_user is null then return false; end if;

  select s.activity_id,
         a.project_id,
         p.workspace_id,
         wm.role::text,
         coalesce(ap.enabled,false),
         coalesce(ap.restrict_projects,false),
         coalesce(ap.restrict_activities,false),
         coalesce(ap.restrict_subactivities,false),
         s.assignee_id,
         not exists(select 1 from public.activity_assignees aa where aa.activity_id=a.id)
    into v_activity,v_project,v_workspace,v_role,v_enabled,
         v_restrict_projects,v_restrict_activities,v_restrict_subactivities,v_assignee,
         v_activity_unassigned
    from public.subactivities s
    join public.activities a on a.id=s.activity_id
    join public.projects p on p.id=a.project_id
    join public.workspace_members wm
      on wm.workspace_id=p.workspace_id
     and wm.user_id=p_user
     and wm.active
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=p.workspace_id
     and ap.user_id=p_user
   where s.id=p_subactivity_id;

  if not found then return false; end if;
  if v_role='admin' or not v_enabled then return true; end if;

  if v_restrict_projects then
    -- Se a atividade-pai está sem responsável, o projeto é acessível ao DEV
    -- exclusivamente para manter essa atividade disponível na árvore.
    if v_role='developer' and v_activity_unassigned then
      v_project_allowed := true;
    else
      v_project_allowed :=
        exists(select 1 from public.project_members pm where pm.project_id=v_project and pm.user_id=p_user)
        or exists(
          select 1 from public.activities a
          join public.activity_assignees aa on aa.activity_id=a.id
          where a.project_id=v_project and aa.user_id=p_user
          limit 1
        )
        or exists(
          select 1 from public.activities a
          join public.subactivities s on s.activity_id=a.id
          where a.project_id=v_project
            and (s.assignee_id=p_user or exists(
              select 1 from public.subactivity_members sm
               where sm.subactivity_id=s.id and sm.user_id=p_user
            ))
          limit 1
        );
    end if;
  end if;
  if not v_project_allowed then return false; end if;

  if v_restrict_activities then
    if v_role='developer' and v_activity_unassigned then
      v_activity_allowed := true;
    else
      v_activity_allowed :=
        exists(select 1 from public.activity_assignees aa where aa.activity_id=v_activity and aa.user_id=p_user)
        or exists(
          select 1 from public.subactivities s
           where s.activity_id=v_activity
             and (s.assignee_id=p_user or exists(
               select 1 from public.subactivity_members sm
                where sm.subactivity_id=s.id and sm.user_id=p_user
             ))
           limit 1
        );
    end if;
  end if;
  if not v_activity_allowed then return false; end if;

  if not v_restrict_subactivities then return true; end if;

  return v_assignee=p_user
    or exists(
      select 1 from public.subactivity_members sm
       where sm.subactivity_id=p_subactivity_id and sm.user_id=p_user
    );
end;
$$;

-- Reaproveita a PK (activity_id,user_id) para detectar rapidamente atividades
-- sem responsável. ANALYZE ajuda o planner logo após a migration.
analyze public.activity_assignees;
analyze public.activities;

revoke execute on function public.taskboard_can_view_project(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_activity(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_subactivity(uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_view_project(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_activity(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_subactivity(uuid,uuid) to authenticated;

commit;
