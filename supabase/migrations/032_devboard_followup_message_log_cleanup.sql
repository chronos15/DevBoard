begin;

-- O acompanhamento já exibe a própria mensagem na timeline. O log criado para cada
-- mensagem repetia o mesmo conteúdo e, ao excluir a mensagem, o log permanecia.
-- Remove os registros históricos gerados especificamente por esse fluxo.
delete from public.project_logs
where type = 'comment-added'
  and title = 'Mensagem adicionada no acompanhamento';

create or replace function public.add_followup_comment(
  p_subactivity_id uuid,
  p_content text,
  p_mentions jsonb default '[]'::jsonb,
  p_reply_to_comment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_project uuid := public.subactivity_project_id(p_subactivity_id);
  v_workspace uuid;
  v_sub public.subactivities%rowtype;
  v_activity uuid;
  v_preview text;
  v_actor_name text;
  v_project_name text;
  v_recipient uuid;
  v_was_member boolean;
  v_mentions jsonb := coalesce(p_mentions, '[]'::jsonb);
begin
  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;
  if length(btrim(coalesce(p_content,''))) = 0 then
    raise exception 'Comentário vazio';
  end if;
  if jsonb_typeof(v_mentions) <> 'array' then
    raise exception 'Menções inválidas';
  end if;
  if jsonb_array_length(v_mentions) > 25 then
    raise exception 'Muitas menções em uma única mensagem';
  end if;

  select * into v_sub from public.subactivities where id = p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  v_activity := v_sub.activity_id;

  if p_reply_to_comment_id is not null and not exists (
    select 1
      from public.subactivity_comments c
     where c.id = p_reply_to_comment_id
       and c.subactivity_id = p_subactivity_id
  ) then
    raise exception 'A mensagem respondida não pertence a esta subatividade';
  end if;

  insert into public.subactivity_comments(
    subactivity_id, author_id, content, mentions, reply_to_comment_id
  ) values (
    p_subactivity_id, auth.uid(), btrim(p_content), v_mentions, p_reply_to_comment_id
  ) returning id into v_id;

  select name into v_actor_name from public.profiles where id = auth.uid();
  select name into v_project_name from public.projects where id = v_project;
  v_preview := left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

  -- Intencionalmente não cria project_log para mensagens do acompanhamento.
  -- A própria subactivity_comments já é a fonte de verdade da timeline.

  for v_recipient in
    select distinct wm.user_id
      from jsonb_array_elements(v_mentions) value
      join public.workspace_members wm
        on wm.workspace_id = v_workspace
       and wm.active = true
       and wm.user_id = case
         when (value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         then (value->>'id')::uuid
         else null
       end
     where value->>'kind' = 'user'
       and wm.user_id <> auth.uid()
  loop
    select exists(
      select 1 from public.project_members pm
      where pm.project_id = v_project and pm.user_id = v_recipient
    ) into v_was_member;

    insert into public.project_members(project_id, user_id, added_by)
    values (v_project, v_recipient, auth.uid())
    on conflict (project_id, user_id) do nothing;

    perform public.push_notification(
      v_recipient,
      auth.uid(),
      'followup-mention',
      format('%s mencionou você no acompanhamento', coalesce(nullif(v_actor_name,''),'Alguém')),
      case when v_was_member then
        format('%s · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title, v_preview)
      else
        format('Você foi adicionado ao projeto %s · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title, v_preview)
      end,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end loop;

  if v_sub.assignee_id <> auth.uid() and not exists (
    select 1
      from jsonb_array_elements(v_mentions) value
     where value->>'kind' = 'user'
       and value->>'id' = v_sub.assignee_id::text
  ) then
    perform public.push_notification(
      v_sub.assignee_id,
      auth.uid(),
      'subactivity-comment',
      'Nova mensagem em sua subatividade',
      format('“%s” · “%s”', v_sub.title, v_preview),
      v_project,
      v_activity,
      p_subactivity_id
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.add_followup_comment(uuid,text,jsonb,uuid) from public, anon;
grant execute on function public.add_followup_comment(uuid,text,jsonb,uuid) to authenticated;

commit;
