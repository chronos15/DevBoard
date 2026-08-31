begin;

-- 033 · Estrutura do projeto para todos os integrantes
-- Regra consolidada:
--   • Admin do workspace pode criar/excluir estrutura em qualquer projeto.
--   • Qualquer usuário autenticado que esteja em project_members pode criar
--     atividades e subatividades e excluir atividades vazias daquele projeto.
--   • Usuários fora do projeto continuam bloqueados.
-- As regras de responsável/status continuam as mesmas: subatividades de
-- desenvolvimento são atribuídas somente a Admin/Developer e a execução de
-- tarefa de outro responsável continua restrita.

create or replace function public.add_activity(p_project_id uuid,p_title text,p_assignee_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_activity uuid;
  v_user uuid;
  v_project_name text;
  v_role text;
begin
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar atividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role<>'admin' and not exists(
    select 1
      from public.project_members pm
     where pm.project_id=p_project_id
       and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para criar atividades';
  end if;

  if length(btrim(coalesce(p_title,'')))=0 then
    raise exception 'Título da atividade é obrigatório';
  end if;

  if exists(
    select 1
      from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) x(user_id)
     where public.workspace_role_of(v_workspace,x.user_id) not in ('admin','developer')
  ) then
    raise exception 'Atividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  insert into public.activities(project_id,title,created_by)
  values(p_project_id,btrim(p_title),auth.uid())
  returning id into v_activity;

  insert into public.activity_assignees(activity_id,user_id)
  select v_activity,x.user_id
    from (select distinct unnest(coalesce(p_assignee_ids,'{}'::uuid[])) user_id) x
   where public.is_workspace_member(v_workspace,x.user_id)
  on conflict do nothing;

  perform public.add_project_log(
    p_project_id,'activity-added','Atividade adicionada',
    format('“%s” foi adicionada ao projeto.',btrim(p_title)),auth.uid()
  );

  select name into v_project_name from public.projects where id=p_project_id;
  for v_user in
    select user_id
      from public.activity_assignees
     where activity_id=v_activity and user_id<>auth.uid()
  loop
    perform public.push_notification(
      v_user,auth.uid(),'activity-assigned','Você recebeu uma nova atividade',
      format('“%s” · %s',btrim(p_title),v_project_name),p_project_id,v_activity,null
    );
  end loop;

  return v_activity;
end;
$$;

create or replace function public.delete_activity(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.activities%rowtype;
  v_workspace uuid;
  v_role text;
begin
  select * into v_activity from public.activities where id=p_activity_id for update;
  if not found then raise exception 'Atividade não encontrada'; end if;

  v_workspace:=public.project_workspace_id(v_activity.project_id);
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para excluir atividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role<>'admin' and not exists(
    select 1
      from public.project_members pm
     where pm.project_id=v_activity.project_id
       and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para excluir atividades';
  end if;

  if exists(select 1 from public.subactivities where activity_id=p_activity_id) then
    raise exception 'Só é possível excluir atividades sem subatividades';
  end if;

  perform public.add_project_log(
    v_activity.project_id,'activity-deleted','Atividade excluída',
    format('“%s” foi removida do projeto.',v_activity.title),auth.uid()
  );
  delete from public.activities where id=p_activity_id;
end;
$$;

create or replace function public.add_subactivity(
  p_project_id uuid,p_activity_id uuid,p_title text,p_estimated_hours numeric,p_assignee_id uuid,p_status text default 'backlog'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_id uuid;
  v_activity_title text;
  v_project_name text;
  v_role text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then
    raise exception 'Atividade não pertence ao projeto';
  end if;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar subatividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role<>'admin' and not exists(
    select 1
      from public.project_members pm
     where pm.project_id=p_project_id
       and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para criar subatividades';
  end if;

  if length(btrim(coalesce(p_title,'')))=0 then
    raise exception 'Título da subatividade é obrigatório';
  end if;

  if public.workspace_role_of(v_workspace,p_assignee_id) not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then
    raise exception 'Status inválido';
  end if;

  if p_status='in-progress' and p_assignee_id<>auth.uid() and v_role<>'admin' then
    raise exception 'Você só pode iniciar uma subatividade atribuída a você';
  end if;

  insert into public.subactivities(
    activity_id,title,status,estimated_hours,tracked_seconds,timer_started_at,
    assignee_id,created_by,completed_at,cancelled_at
  )
  values(
    p_activity_id,btrim(p_title),'backlog',greatest(coalesce(p_estimated_hours,0),0),0,null,
    p_assignee_id,auth.uid(),null,null
  )
  returning id into v_id;

  select title into v_activity_title from public.activities where id=p_activity_id;
  select name into v_project_name from public.projects where id=p_project_id;

  perform public.add_project_log(
    p_project_id,'subactivity-added','Subatividade adicionada',
    format('“%s” adicionada em “%s”.',btrim(p_title),v_activity_title),auth.uid()
  );

  perform public.push_notification(
    p_assignee_id,auth.uid(),'subactivity-assigned','Você recebeu uma nova subatividade',
    format('“%s” · %s · %s',btrim(p_title),v_activity_title,v_project_name),
    p_project_id,p_activity_id,v_id
  );

  if p_status<>'backlog' then
    perform public.set_subactivity_status(v_id,p_status);
  end if;

  return v_id;
end;
$$;

revoke execute on function public.add_activity(uuid,text,uuid[]),
  public.delete_activity(uuid),
  public.add_subactivity(uuid,uuid,text,numeric,uuid,text)
from public,anon;

grant execute on function public.add_activity(uuid,text,uuid[]),
  public.delete_activity(uuid),
  public.add_subactivity(uuid,uuid,text,numeric,uuid,text)
to authenticated;

commit;
