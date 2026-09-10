begin;

-- =============================================================================
-- 072 · Prazo de projeto opcional
-- =============================================================================
-- A data de entrega deixa de ser requisito estrutural. Projetos sem prazo
-- continuam aparecendo normalmente; Agenda e cards tratam NULL como "Sem prazo".

alter table public.projects
  alter column due_date drop not null;

create or replace function public.create_project(
  p_name text,
  p_client text,
  p_description text,
  p_tag text,
  p_priority text,
  p_due_date date,
  p_repository text default '',
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_project uuid;
  v_member uuid;
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não autenticado';
  end if;

  if not public.has_workspace_role(array['admin'::public.workspace_role,'developer'::public.workspace_role]) then
    raise exception 'Somente Administrador ou Desenvolvedor pode criar projetos';
  end if;

  if length(btrim(coalesce(p_name,''))) = 0 then
    raise exception 'Nome do projeto é obrigatório';
  end if;

  if p_priority not in ('low','medium','high') then
    raise exception 'Prioridade inválida';
  end if;

  insert into public.projects(
    workspace_id,
    name,
    client,
    description,
    tag,
    priority,
    due_date,
    repository,
    created_by
  )
  values(
    v_workspace,
    btrim(p_name),
    coalesce(nullif(btrim(p_client),''),'Projeto interno'),
    coalesce(p_description,''),
    coalesce(nullif(btrim(p_tag),''),'Desenvolvimento'),
    p_priority::public.project_priority,
    p_due_date,
    coalesce(p_repository,''),
    auth.uid()
  )
  returning id into v_project;

  insert into public.project_members(project_id,user_id,added_by)
  select v_project,x.user_id,auth.uid()
  from (
    select distinct unnest(array_append(coalesce(p_member_ids,'{}'::uuid[]),auth.uid())) user_id
  ) x
  where public.is_workspace_member(v_workspace,x.user_id)
  on conflict do nothing;

  perform public.add_project_log(
    v_project,
    'created',
    'Projeto criado',
    case
      when p_due_date is null then 'Projeto criado e disponibilizado para a equipe, sem data de entrega definida.'
      else 'Projeto criado e disponibilizado para a equipe.'
    end,
    auth.uid()
  );

  for v_member in
    select user_id
    from public.project_members
    where project_id = v_project
      and user_id <> auth.uid()
  loop
    perform public.push_notification(
      v_member,
      auth.uid(),
      'project-assigned',
      'Você foi adicionado a um projeto',
      btrim(p_name),
      v_project,
      null,
      null
    );
  end loop;

  return v_project;
end;
$$;

revoke execute on function public.create_project(text,text,text,text,text,date,text,uuid[]) from public, anon;
grant execute on function public.create_project(text,text,text,text,text,date,text,uuid[]) to authenticated;

-- Mantém exatamente a regra administrativa vigente da V65: Admin pode editar
-- qualquer projeto do workspace sem ser inserido automaticamente como membro;
-- DEV precisa continuar integrado ao projeto.
create or replace function public.update_project(
  p_project_id uuid,
  p_name text,
  p_client text,
  p_description text,
  p_tag text,
  p_priority text,
  p_due_date date,
  p_repository text default '',
  p_member_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_workspace uuid;
  v_role text;
  v_description text := '';
  v_old_members uuid[];
  v_member uuid;
  v_requested_members uuid[];
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then raise exception 'Projeto não encontrado'; end if;

  v_workspace := v_project.workspace_id;
  select wm.role::text into v_role
  from public.workspace_members wm
  where wm.workspace_id = v_workspace
    and wm.user_id = auth.uid()
    and wm.active;

  if v_role is null then raise exception 'Sem permissão para editar projetos'; end if;

  if v_role <> 'admin' and (
    v_role <> 'developer'
    or not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
    )
  ) then
    raise exception 'Você precisa estar integrado ao projeto para editá-lo';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Nome do projeto é obrigatório'; end if;
  if p_priority not in ('low', 'medium', 'high') then raise exception 'Prioridade inválida'; end if;

  if v_project.name is distinct from btrim(p_name) then
    v_description := v_description || format('Nome: “%s” → “%s”. ', v_project.name, btrim(p_name));
  end if;
  if v_project.client is distinct from coalesce(nullif(btrim(p_client), ''), 'Projeto interno') then
    v_description := v_description || 'Cliente/área alterado. ';
  end if;
  if v_project.description is distinct from coalesce(p_description, '') then
    v_description := v_description || 'Descrição alterada. ';
  end if;
  if v_project.tag is distinct from coalesce(nullif(btrim(p_tag), ''), 'Desenvolvimento') then
    v_description := v_description || 'Categoria alterada. ';
  end if;
  if v_project.priority::text is distinct from p_priority then
    v_description := v_description || 'Prioridade alterada. ';
  end if;
  if v_project.due_date is distinct from p_due_date then
    v_description := v_description || case when p_due_date is null then 'Data de entrega removida. ' else 'Data de entrega alterada. ' end;
  end if;
  if v_project.repository is distinct from coalesce(p_repository, '') then
    v_description := v_description || 'Repositório/caminho alterado. ';
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    into v_old_members
  from public.project_members
  where project_id = p_project_id;

  update public.projects
     set name = btrim(p_name),
         client = coalesce(nullif(btrim(p_client), ''), 'Projeto interno'),
         description = coalesce(p_description, ''),
         tag = coalesce(nullif(btrim(p_tag), ''), 'Desenvolvimento'),
         priority = p_priority::public.project_priority,
         due_date = p_due_date,
         repository = coalesce(p_repository, '')
   where id = p_project_id;

  v_requested_members := coalesce(p_member_ids, '{}'::uuid[]);
  if v_role = 'developer' then
    v_requested_members := array_append(v_requested_members, auth.uid());
  end if;

  delete from public.project_members where project_id = p_project_id;

  insert into public.project_members(project_id, user_id, added_by)
  select p_project_id, x.user_id, auth.uid()
  from (select distinct unnest(v_requested_members) as user_id) x
  where exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = v_workspace
      and wm.user_id = x.user_id
      and wm.active
  )
  on conflict do nothing;

  if v_old_members is distinct from (
    select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    from public.project_members
    where project_id = p_project_id
  ) then
    v_description := v_description || 'Responsáveis alterados. ';
  end if;

  perform public.add_project_log(
    p_project_id,
    'updated',
    'Projeto atualizado',
    nullif(btrim(v_description), ''),
    auth.uid()
  );

  for v_member in
    select user_id
    from public.project_members
    where project_id = p_project_id
      and user_id <> auth.uid()
      and not (user_id = any(v_old_members))
  loop
    perform public.push_notification(
      v_member,
      auth.uid(),
      'project-assigned',
      'Você foi adicionado a um projeto',
      btrim(p_name),
      p_project_id,
      null,
      null
    );
  end loop;
end;
$$;

revoke execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) from public, anon;
grant execute on function public.update_project(uuid,text,text,text,text,text,date,text,uuid[]) to authenticated;

commit;
