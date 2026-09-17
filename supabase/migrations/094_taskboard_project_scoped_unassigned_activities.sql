-- TaskBoard V181 · Atividade sem responsável limitada ao contexto do projeto
-- Execute depois da migration 093.
--
-- Objetivo:
--   * uma atividade sem responsável continua disponível para DEV;
--   * porém ela NÃO pode tornar o projeto visível para desenvolvedores que não
--     possuam nenhum vínculo com o projeto;
--   * para DEV, projeto visível = usuário integrado ao projeto diretamente ou
--     por atividade/subatividade;
--   * dentro de um projeto já visível, as restrições personalizadas de
--     atividades/subatividades continuam sendo respeitadas;
--   * Admin permanece com acesso integral.
--
-- Esta migration corrige especificamente a abertura introduzida pela 083 sem
-- alterar tabelas, enums, policies ou o modelo de vínculos existente.

begin;

-- ---------------------------------------------------------------------------
-- Projeto
-- ---------------------------------------------------------------------------
-- Para DEV, o projeto precisa ter vínculo real com o usuário. Uma atividade
-- sem responsável, sozinha, não é vínculo e não abre mais o projeto.
--
-- São considerados vínculos já existentes:
--   1. project_members;
--   2. activity_assignees em alguma atividade do projeto;
--   3. assignee_id/subactivity_members em alguma subatividade do projeto.
--
-- Para as demais roles, preserva-se o comportamento dos perfis de acesso.
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
  v_project_related boolean := false;
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
  if v_role='admin' then return true; end if;

  v_project_related :=
    exists(
      select 1
        from public.project_members pm
       where pm.project_id=p_project_id
         and pm.user_id=p_user
    )
    or exists(
      select 1
        from public.activities a
        join public.activity_assignees aa on aa.activity_id=a.id
       where a.project_id=p_project_id
         and aa.user_id=p_user
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
             select 1
               from public.subactivity_members sm
              where sm.subactivity_id=s.id
                and sm.user_id=p_user
           )
         )
       limit 1
    );

  -- DEV passa a respeitar sempre o contexto do projeto. Isso impede que uma
  -- atividade sem responsável faça um projeto alheio aparecer na interface.
  if v_role='developer' then
    return v_project_related;
  end if;

  -- Demais roles mantêm exatamente a semântica do perfil personalizado.
  if not v_enabled or not v_restrict_projects then return true; end if;
  return v_project_related;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atividade
-- ---------------------------------------------------------------------------
-- DEV precisa estar integrado ao projeto. Depois disso:
--   * sem restrição de atividades: vê as atividades retornadas normalmente;
--   * com restrict_activities: vê atividades em que participa OU atividades
--     sem responsável, pois já pertence ao contexto do projeto.
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
  v_project_related boolean := false;
  v_project_allowed boolean := true;
  v_activity_unassigned boolean := false;
begin
  if p_activity_id is null or p_user is null then return false; end if;

  select a.project_id,
         p.workspace_id,
         wm.role::text,
         coalesce(ap.enabled,false),
         coalesce(ap.restrict_projects,false),
         coalesce(ap.restrict_activities,false),
         not exists(
           select 1
             from public.activity_assignees aa
            where aa.activity_id=a.id
         )
    into v_project,v_workspace,v_role,v_enabled,v_restrict_projects,
         v_restrict_activities,v_activity_unassigned
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
  if v_role='admin' then return true; end if;

  v_project_related :=
    exists(
      select 1
        from public.project_members pm
       where pm.project_id=v_project
         and pm.user_id=p_user
    )
    or exists(
      select 1
        from public.activities a
        join public.activity_assignees aa on aa.activity_id=a.id
       where a.project_id=v_project
         and aa.user_id=p_user
       limit 1
    )
    or exists(
      select 1
        from public.activities a
        join public.subactivities s on s.activity_id=a.id
       where a.project_id=v_project
         and (
           s.assignee_id=p_user
           or exists(
             select 1
               from public.subactivity_members sm
              where sm.subactivity_id=s.id
                and sm.user_id=p_user
           )
         )
       limit 1
    );

  if v_role='developer' then
    if not v_project_related then return false; end if;
  elsif v_enabled and v_restrict_projects then
    v_project_allowed := v_project_related;
  end if;

  if not v_project_allowed then return false; end if;

  -- Perfil desligado ou atividades sem restrição: mantém o comportamento
  -- existente, mas DEV já passou obrigatoriamente pelo gate do projeto acima.
  if not v_enabled or not v_restrict_activities then return true; end if;

  -- A única exceção para atividade sem responsável: DEV já integrado ao projeto.
  if v_role='developer' and v_activity_unassigned then return true; end if;

  return
    exists(
      select 1
        from public.activity_assignees aa
       where aa.activity_id=p_activity_id
         and aa.user_id=p_user
    )
    or exists(
      select 1
        from public.subactivities s
       where s.activity_id=p_activity_id
         and (
           s.assignee_id=p_user
           or exists(
             select 1
               from public.subactivity_members sm
              where sm.subactivity_id=s.id
                and sm.user_id=p_user
           )
         )
       limit 1
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Subatividade
-- ---------------------------------------------------------------------------
-- Repete os mesmos gates sem chamar os helpers acima, preservando a otimização
-- da migration 082. A atividade-pai sem responsável só é liberada ao DEV que
-- já possui vínculo com o projeto.
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
  v_project_related boolean := false;
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
         not exists(
           select 1
             from public.activity_assignees aa
            where aa.activity_id=a.id
         )
    into v_activity,v_project,v_workspace,v_role,v_enabled,
         v_restrict_projects,v_restrict_activities,v_restrict_subactivities,
         v_assignee,v_activity_unassigned
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
  if v_role='admin' then return true; end if;

  v_project_related :=
    exists(
      select 1
        from public.project_members pm
       where pm.project_id=v_project
         and pm.user_id=p_user
    )
    or exists(
      select 1
        from public.activities a
        join public.activity_assignees aa on aa.activity_id=a.id
       where a.project_id=v_project
         and aa.user_id=p_user
       limit 1
    )
    or exists(
      select 1
        from public.activities a
        join public.subactivities s on s.activity_id=a.id
       where a.project_id=v_project
         and (
           s.assignee_id=p_user
           or exists(
             select 1
               from public.subactivity_members sm
              where sm.subactivity_id=s.id
                and sm.user_id=p_user
           )
         )
       limit 1
    );

  if v_role='developer' then
    if not v_project_related then return false; end if;
  elsif v_enabled and v_restrict_projects then
    v_project_allowed := v_project_related;
  end if;

  if not v_project_allowed then return false; end if;

  if v_enabled and v_restrict_activities then
    if v_role='developer' and v_activity_unassigned then
      v_activity_allowed := true;
    else
      v_activity_allowed :=
        exists(
          select 1
            from public.activity_assignees aa
           where aa.activity_id=v_activity
             and aa.user_id=p_user
        )
        or exists(
          select 1
            from public.subactivities s
           where s.activity_id=v_activity
             and (
               s.assignee_id=p_user
               or exists(
                 select 1
                   from public.subactivity_members sm
                  where sm.subactivity_id=s.id
                    and sm.user_id=p_user
               )
             )
           limit 1
        );
    end if;
  end if;

  if not v_activity_allowed then return false; end if;

  if not v_enabled or not v_restrict_subactivities then return true; end if;

  return v_assignee=p_user
    or exists(
      select 1
        from public.subactivity_members sm
       where sm.subactivity_id=p_subactivity_id
         and sm.user_id=p_user
    );
end;
$$;

-- As policies existentes já chamam estes helpers; não é necessário recriá-las.
analyze public.project_members;
analyze public.activity_assignees;
analyze public.activities;
analyze public.subactivities;
analyze public.subactivity_members;
analyze public.workspace_member_access_profiles;

revoke execute on function public.taskboard_can_view_project(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_activity(uuid,uuid) from public,anon;
revoke execute on function public.taskboard_can_view_subactivity(uuid,uuid) from public,anon;
grant execute on function public.taskboard_can_view_project(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_activity(uuid,uuid) to authenticated;
grant execute on function public.taskboard_can_view_subactivity(uuid,uuid) to authenticated;

commit;
