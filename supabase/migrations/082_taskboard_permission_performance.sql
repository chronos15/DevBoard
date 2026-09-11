-- TaskBoard V102 · Performance das permissões estruturais
-- Execute depois da migration 081.
--
-- Motivo:
-- A V93/077 passou a aplicar taskboard_can_view_* como RLS em toda a árvore
-- Projetos -> Atividades -> Subatividades -> Comentários/Anexos/Sessões.
-- As versões anteriores dos helpers eram recursivas (subatividade -> atividade
-- -> projeto), multiplicando consultas por linha durante loadProjects().
--
-- Esta migration preserva exatamente a mesma regra de visibilidade, porém:
--   1) elimina chamadas recursivas entre os helpers;
--   2) usa fast-path para admin/perfil desativado/escopo não restrito;
--   3) só consulta vínculos individuais quando a respectiva restrição está ativa;
--   4) adiciona índices usados pelos caminhos restritos.

begin;

create index if not exists taskboard_activity_assignees_user_activity_idx
  on public.activity_assignees(user_id, activity_id);

create index if not exists taskboard_subactivities_assignee_activity_idx
  on public.subactivities(assignee_id, activity_id);

create index if not exists taskboard_activities_project_id_idx
  on public.activities(project_id, id);


-- ---------------------------------------------------------------------------
-- Ações de escrita: o helper da V95 concatenava JSON/defaults dentro de uma
-- subconsulta SQL em toda RPC estrutural. Continua sendo uma única checagem,
-- mas agora usa fast-path para admin e perfil desativado antes de interpretar
-- action_permissions. A autorização final das RPCs continua intacta.
-- ---------------------------------------------------------------------------
create or replace function public.taskboard_can_perform_action(
  p_action text,
  p_workspace uuid default public.current_workspace_id(),
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_enabled boolean;
  v_actions jsonb;
  v_default boolean := false;
begin
  if p_workspace is null or p_user is null then return false; end if;

  select wm.role::text, coalesce(ap.enabled,false), coalesce(ap.action_permissions,'{}'::jsonb)
    into v_role,v_enabled,v_actions
    from public.workspace_members wm
    left join public.workspace_member_access_profiles ap
      on ap.workspace_id=wm.workspace_id and ap.user_id=wm.user_id
   where wm.workspace_id=p_workspace
     and wm.user_id=p_user
     and wm.active
   limit 1;

  if not found then return false; end if;
  if v_role='admin' or not v_enabled then return true; end if;
  if p_action not in ('createProjects','editProjects','createActivities','createSubactivities') then return false; end if;

  v_default := v_role in ('admin','developer');
  return coalesce((v_actions ->> p_action)::boolean, v_default, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Projeto: uma única leitura de contexto. Para a grande maioria dos usuários
-- (admin, acesso personalizado desligado ou projetos sem restrição), retorna
-- imediatamente sem varrer assignments/subatividades.
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
-- Atividade: não chama taskboard_can_view_project(). O gate do projeto e o
-- gate da atividade são avaliados no mesmo contexto e apenas quando ativos.
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
-- Subatividade: elimina a cadeia sub -> atividade -> projeto. Todos os gates
-- são avaliados uma única vez. Em perfil sem restrição o retorno acontece logo
-- após uma consulta indexada pelo PK da subatividade.
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
         s.assignee_id
    into v_activity,v_project,v_workspace,v_role,v_enabled,
         v_restrict_projects,v_restrict_activities,v_restrict_subactivities,v_assignee
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

  if v_restrict_activities then
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
  if not v_activity_allowed then return false; end if;

  if not v_restrict_subactivities then return true; end if;

  return v_assignee=p_user
    or exists(
      select 1 from public.subactivity_members sm
       where sm.subactivity_id=p_subactivity_id and sm.user_id=p_user
    );
end;
$$;

-- Estatísticas novas ajudam o planner imediatamente após criar os índices.
analyze public.activity_assignees;
analyze public.activities;
analyze public.subactivities;
analyze public.subactivity_members;
analyze public.project_members;
analyze public.workspace_member_access_profiles;

revoke execute on function public.taskboard_can_perform_action(text,uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_perform_action(text,uuid,uuid) to authenticated;

revoke execute on function public.taskboard_can_view_project(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_activity(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_subactivity(uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_view_project(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_activity(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_subactivity(uuid,uuid) to authenticated;

commit;
