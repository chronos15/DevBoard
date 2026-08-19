-- Devboard · Migration 006
-- Notificação de novas análises para TODOS os usuários ativos com role AQS.
-- Incremental e idempotente: execute após a migration de Roles/AQS/Tópicos.

begin;

create or replace function public.enqueue_aqs_review(
  p_subactivity_id uuid,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_activity uuid;
  v_workspace uuid;
  v_review uuid;
  v_sub_title text;
  v_recipient uuid;
begin
  select s.activity_id, s.title
    into v_activity, v_sub_title
  from public.subactivities s
  where s.id = p_subactivity_id;

  if v_activity is null then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.activity_project_id(v_activity);
  v_workspace := public.project_workspace_id(v_project);

  select id
    into v_review
  from public.aqs_reviews
  where subactivity_id = p_subactivity_id
    and status in ('awaiting', 'evaluating')
  order by created_at desc
  limit 1;

  if v_review is null then
    insert into public.aqs_reviews(
      workspace_id,
      project_id,
      activity_id,
      subactivity_id,
      status,
      created_by
    )
    values(
      v_workspace,
      v_project,
      v_activity,
      p_subactivity_id,
      'awaiting',
      p_actor_id
    )
    returning id into v_review;
  end if;

  perform public.add_project_log(
    v_project,
    'aqs-submitted',
    'Subatividade enviada para AQS',
    format('“%s” entrou na fila de análise.', v_sub_title),
    p_actor_id
  );

  -- Uma notificação por usuário AQS ativo do workspace.
  for v_recipient in
    select wm.user_id
    from public.workspace_members wm
    where wm.workspace_id = v_workspace
      and wm.active
      and wm.role = 'aqs'::public.workspace_role
      and wm.user_id <> p_actor_id
  loop
    perform public.push_notification(
      v_recipient,
      p_actor_id,
      'aqs-awaiting',
      'Nova tarefa aguardando AQS',
      v_sub_title,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end loop;

  return v_review;
end;
$$;

-- Esta função é interna: somente outras RPCs SECURITY DEFINER a utilizam.
revoke execute on function public.enqueue_aqs_review(uuid, uuid)
from public, anon, authenticated;

commit;
