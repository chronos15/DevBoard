begin;

-- 074 · Edição administrativa de subatividade + suporte de UI do painel Equipe
-- A parte de painel é somente frontend. Esta migration cria apenas a RPC segura
-- usada por Administradores para alterar os dados principais da subatividade.

create or replace function public.update_subactivity_admin(
  p_subactivity_id uuid,
  p_title text,
  p_estimated_hours numeric,
  p_assignee_id uuid,
  p_type_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_new_title text := btrim(coalesce(p_title, ''));
  v_old_assignee_name text;
  v_new_assignee_name text;
  v_old_type_name text;
  v_new_type_name text;
  v_changes text[] := array[]::text[];
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  select * into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem editar os dados da subatividade';
  end if;

  if char_length(v_new_title) < 1 then
    raise exception 'Descrição da subatividade é obrigatória';
  end if;

  if char_length(v_new_title) > 4000 then
    raise exception 'A descrição da subatividade deve ter no máximo 4000 caracteres';
  end if;

  if coalesce(p_estimated_hours, 0) < 0 then
    raise exception 'A estimativa não pode ser negativa';
  end if;

  if p_assignee_id is null or public.workspace_role_of(v_workspace, p_assignee_id) not in ('admin', 'developer') then
    raise exception 'O responsável precisa ser um Administrador ou Desenvolvedor deste workspace';
  end if;

  if p_type_id is not null and not exists (
    select 1
      from public.work_item_types wit
     where wit.id = p_type_id
       and wit.workspace_id = v_workspace
       and (wit.active = true or wit.id = v_sub.type_id)
  ) then
    raise exception 'Tipo inválido ou inativo para este workspace';
  end if;

  if v_sub.status = 'in-progress' and p_assignee_id is distinct from v_sub.assignee_id then
    raise exception 'Pause a subatividade antes de trocar o responsável';
  end if;

  if v_sub.title is not distinct from v_new_title
     and v_sub.estimated_hours is not distinct from greatest(coalesce(p_estimated_hours, 0), 0)
     and v_sub.assignee_id is not distinct from p_assignee_id
     and v_sub.type_id is not distinct from p_type_id then
    return;
  end if;

  if v_sub.title is distinct from v_new_title then
    v_changes := array_append(v_changes, format('descrição: “%s” → “%s”', v_sub.title, v_new_title));
  end if;

  if v_sub.estimated_hours is distinct from greatest(coalesce(p_estimated_hours, 0), 0) then
    v_changes := array_append(
      v_changes,
      format('estimativa: %sh → %sh', trim(to_char(v_sub.estimated_hours, 'FM999999990.##')), trim(to_char(greatest(coalesce(p_estimated_hours, 0), 0), 'FM999999990.##')))
    );
  end if;

  if v_sub.assignee_id is distinct from p_assignee_id then
    select name into v_old_assignee_name from public.profiles where id = v_sub.assignee_id;
    select name into v_new_assignee_name from public.profiles where id = p_assignee_id;
    v_changes := array_append(v_changes, format('responsável: %s → %s', coalesce(v_old_assignee_name, 'Usuário anterior'), coalesce(v_new_assignee_name, 'Novo usuário')));
  end if;

  if v_sub.type_id is distinct from p_type_id then
    if v_sub.type_id is not null then
      select name into v_old_type_name from public.work_item_types where id = v_sub.type_id;
    end if;
    if p_type_id is not null then
      select name into v_new_type_name from public.work_item_types where id = p_type_id;
    end if;
    v_changes := array_append(v_changes, format('tipo: %s → %s', coalesce(v_old_type_name, 'Sem tipo'), coalesce(v_new_type_name, 'Sem tipo')));
  end if;

  update public.subactivities
     set title = v_new_title,
         estimated_hours = greatest(coalesce(p_estimated_hours, 0), 0),
         assignee_id = p_assignee_id,
         type_id = p_type_id,
         updated_at = now()
   where id = p_subactivity_id;

  insert into public.subactivity_members(subactivity_id, user_id, added_by)
  values (p_subactivity_id, p_assignee_id, auth.uid())
  on conflict (subactivity_id, user_id) do nothing;

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    'Subatividade atualizada',
    format('“%s” · %s.', v_new_title, array_to_string(v_changes, ' · ')),
    auth.uid()
  );

  if v_sub.assignee_id is distinct from p_assignee_id then
    perform public.push_notification(
      p_assignee_id,
      auth.uid(),
      'subactivity-assigned',
      'Você recebeu uma subatividade',
      format('“%s” foi atribuída a você por um Administrador.', v_new_title),
      v_project,
      v_sub.activity_id,
      p_subactivity_id
    );
  end if;
end;
$$;

revoke all on function public.update_subactivity_admin(uuid,text,numeric,uuid,uuid) from public, anon;
grant execute on function public.update_subactivity_admin(uuid,text,numeric,uuid,uuid) to authenticated;

commit;
