begin;

-- O administrador pode encaminhar qualquer tópico.
-- O AQS pode encaminhar somente o tópico que ele próprio colocou em análise.
create or replace function public.send_topic_to_activity(p_topic_id uuid,p_project_id uuid,p_developer_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.support_topics%rowtype;
  v_workspace uuid;
  v_activity uuid;
  v_recipient uuid;
  v_project_name text;
  v_is_admin boolean;
  v_is_assigned_aqs boolean;
begin
  v_is_admin := public.is_workspace_admin(public.current_workspace_id());

  select * into v
    from public.support_topics
   where id=p_topic_id
   for update;

  if not found then raise exception 'Tópico não encontrado'; end if;
  if v.workspace_id is distinct from public.current_workspace_id() then raise exception 'Tópico fora do seu workspace'; end if;

  v_is_assigned_aqs := (
    public.workspace_role_of(v.workspace_id, auth.uid())='aqs'
    and v.status='analyzing'
    and v.assigned_analyst_id=auth.uid()
  );

  if not v_is_admin and not v_is_assigned_aqs then
    raise exception 'Apenas o administrador ou o analista AQS responsável pela análise podem encaminhar tópicos para desenvolvimento';
  end if;

  if v.status='sent-to-dev' then return v.activity_id; end if;
  if v.status<>'analyzing' and not v_is_admin then
    raise exception 'O tópico precisa estar em análise pelo AQS responsável';
  end if;

  v_workspace:=public.project_workspace_id(p_project_id);
  if v_workspace is distinct from v.workspace_id then raise exception 'Projeto inválido para este workspace'; end if;
  if p_developer_id is not null and public.workspace_role_of(v_workspace,p_developer_id)<>'developer' then raise exception 'O responsável associado precisa ter a role Desenvolvedor'; end if;

  insert into public.activities(project_id,title,created_by)
  values(p_project_id,format('[Ordem %s] %s',v.order_number,v.title),auth.uid()) returning id into v_activity;

  if p_developer_id is not null then
    insert into public.activity_assignees(activity_id,user_id)
    values(v_activity,p_developer_id)
    on conflict do nothing;
  end if;

  update public.support_topics
     set status='sent-to-dev',
         assigned_analyst_id=coalesce(assigned_analyst_id,auth.uid()),
         project_id=p_project_id,
         activity_id=v_activity,
         developer_id=p_developer_id,
         revoked_reason=null
   where id=p_topic_id;

  select name into v_project_name from public.projects where id=p_project_id;
  perform public.add_project_log(
    p_project_id,
    'topic-to-activity',
    'Tópico convertido em atividade',
    format('Ordem %s · “%s” foi enviada para desenvolvimento.',v.order_number,v.title),
    auth.uid()
  );

  for v_recipient in
    select wm.user_id
      from public.workspace_members wm
     where wm.workspace_id=v_workspace
       and wm.active
       and wm.role='admin'
       and wm.user_id<>auth.uid()
  loop
    perform public.push_notification(v_recipient,auth.uid(),'topic-sent','Tópico enviado para desenvolvimento',format('Ordem %s · %s · %s',v.order_number,v.title,v_project_name),p_project_id,v_activity,null);
  end loop;

  if p_developer_id is not null then
    perform public.push_notification(p_developer_id,auth.uid(),'topic-sent','Nova atividade originada do Suporte',format('Ordem %s · %s · %s',v.order_number,v.title,v_project_name),p_project_id,v_activity,null);
  end if;

  perform public.push_notification(v.created_by,auth.uid(),'topic-status','Seu tópico foi enviado para desenvolvimento',format('Ordem %s · %s',v.order_number,v_project_name),p_project_id,v_activity,null);
  return v_activity;
end;
$$;

revoke execute on function public.send_topic_to_activity(uuid,uuid,uuid) from public,anon;
grant execute on function public.send_topic_to_activity(uuid,uuid,uuid) to authenticated;

commit;
