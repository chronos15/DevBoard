begin;

-- 063 · Atividades livres para DEV + logs operacionais do checklist
-- - Atividade não exige responsável.
-- - Desenvolvedores do workspace podem criar subatividades em qualquer atividade,
--   mesmo quando não constam em project_members.
-- - Inclusão, conclusão/reabertura e remoção de itens do checklist geram logs
--   próprios, permitindo uma identidade visual diferente no Acompanhamento.

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
  v_request_id uuid;
  v_order_number text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then
    raise exception 'Atividade não pertence ao projeto';
  end if;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar subatividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role not in ('admin','developer') and not exists(
    select 1 from public.project_members pm
     where pm.project_id=p_project_id and pm.user_id=auth.uid()
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

  v_request_id:=public.service_request_for_activity(p_activity_id);
  if v_request_id is not null and p_status in ('done','cancelled') then
    select order_number into v_order_number from public.service_requests where id=v_request_id;
    raise exception 'A atividade pertence à OS %. A nova subatividade não pode nascer concluída/cancelada; envie-a para Aguardando AQS ao finalizar.',v_order_number;
  end if;

  if p_status='in-progress' and p_assignee_id<>auth.uid() and v_role<>'admin' then
    raise exception 'Você só pode iniciar uma subatividade atribuída a você';
  end if;

  insert into public.subactivities(
    activity_id,title,status,estimated_hours,tracked_seconds,timer_started_at,
    assignee_id,created_by,completed_at,cancelled_at
  ) values(
    p_activity_id,btrim(p_title),'backlog',greatest(coalesce(p_estimated_hours,0),0),0,null,
    p_assignee_id,auth.uid(),null,null
  ) returning id into v_id;

  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values
    (v_id,p_assignee_id,auth.uid()),
    (v_id,auth.uid(),auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

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

create or replace function public.add_subactivity_checklist_item(
  p_subactivity_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_status text;
  v_content text := btrim(coalesce(p_content, ''));
  v_project uuid;
  v_sub_title text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;
  if char_length(v_content) < 1 then raise exception 'Digite uma anotação'; end if;
  if char_length(v_content) > 2000 then raise exception 'A anotação deve ter no máximo 2000 caracteres'; end if;

  select s.status::text,s.title into v_status,v_sub_title
    from public.subactivities s
   where s.id=p_subactivity_id;
  if v_status is null then raise exception 'Subatividade não encontrada'; end if;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'O checklist fica bloqueado enquanto a subatividade está em análise ou finalizada';
  end if;

  insert into public.subactivity_checklist_items(subactivity_id,content,created_by)
  values(p_subactivity_id,v_content,auth.uid())
  returning id into v_id;

  v_project:=public.subactivity_project_id(p_subactivity_id);
  perform public.add_project_log(
    v_project,'checklist-added','Checklist · item adicionado',
    format('Checklist de “%s”: “%s” foi adicionado.',v_sub_title,v_content),auth.uid()
  );

  return v_id;
end;
$$;

create or replace function public.set_subactivity_checklist_item_completed(
  p_item_id uuid,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.subactivity_checklist_items%rowtype;
  v_status text;
  v_project uuid;
  v_sub_title text;
begin
  select * into v_item
    from public.subactivity_checklist_items
   where id=p_item_id
   for update;
  if not found then raise exception 'Item do checklist não encontrado'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.status::text,s.title into v_status,v_sub_title
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'O checklist fica bloqueado enquanto a subatividade está em análise ou finalizada';
  end if;

  update public.subactivity_checklist_items
     set completed_at=case when coalesce(p_completed,false) then now() else null end,
         completed_by=case when coalesce(p_completed,false) then auth.uid() else null end,
         updated_at=now()
   where id=p_item_id;

  v_project:=public.subactivity_project_id(v_item.subactivity_id);
  perform public.add_project_log(
    v_project,
    case when coalesce(p_completed,false) then 'checklist-completed' else 'checklist-reopened' end,
    case when coalesce(p_completed,false) then 'Checklist · item finalizado' else 'Checklist · item reaberto' end,
    format('Checklist de “%s”: “%s” foi %s.',v_sub_title,v_item.content,case when coalesce(p_completed,false) then 'finalizado' else 'reaberto' end),
    auth.uid()
  );
end;
$$;

create or replace function public.delete_subactivity_checklist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.subactivity_checklist_items%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_assignee uuid;
  v_status text;
  v_sub_title text;
begin
  select * into v_item
    from public.subactivity_checklist_items
   where id=p_item_id
   for update;
  if not found then raise exception 'Item do checklist não encontrado'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.assignee_id,s.status::text,s.title into v_assignee,v_status,v_sub_title
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  v_project:=public.subactivity_project_id(v_item.subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);

  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'O checklist fica bloqueado enquanto a subatividade está em análise ou finalizada';
  end if;

  if auth.uid()<>v_item.created_by
     and auth.uid()<>v_assignee
     and not public.is_workspace_admin(v_workspace) then
    raise exception 'Somente o autor, responsável ou administrador pode excluir esta anotação';
  end if;

  delete from public.subactivity_checklist_items where id=p_item_id;

  perform public.add_project_log(
    v_project,'checklist-removed','Checklist · item removido',
    format('Checklist de “%s”: “%s” foi removido.',v_sub_title,v_item.content),auth.uid()
  );
end;
$$;

revoke execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) from public,anon;
revoke execute on function public.add_subactivity_checklist_item(uuid,text) from public,anon;
revoke execute on function public.set_subactivity_checklist_item_completed(uuid,boolean) from public,anon;
revoke execute on function public.delete_subactivity_checklist_item(uuid) from public,anon;

grant execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) to authenticated;
grant execute on function public.add_subactivity_checklist_item(uuid,text) to authenticated;
grant execute on function public.set_subactivity_checklist_item_completed(uuid,boolean) to authenticated;
grant execute on function public.delete_subactivity_checklist_item(uuid) to authenticated;

commit;
