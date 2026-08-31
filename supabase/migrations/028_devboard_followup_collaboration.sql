begin;

alter table public.subactivity_comments
  add column if not exists mentions jsonb not null default '[]'::jsonb,
  add column if not exists reply_to_comment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subactivity_comments_mentions_array_ck'
      and conrelid = 'public.subactivity_comments'::regclass
  ) then
    alter table public.subactivity_comments
      add constraint subactivity_comments_mentions_array_ck
      check (jsonb_typeof(mentions) = 'array');
  end if;
end $$;

create index if not exists subactivity_comments_reply_idx
  on public.subactivity_comments(reply_to_comment_id)
  where reply_to_comment_id is not null;

create table if not exists public.followup_comment_marks (
  comment_id uuid not null references public.subactivity_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.followup_comment_marks enable row level security;

drop policy if exists cadence_followup_comment_marks_select on public.followup_comment_marks;
create policy cadence_followup_comment_marks_select
  on public.followup_comment_marks
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.followup_comment_marks from anon, authenticated;
grant select on public.followup_comment_marks to authenticated;

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

  perform public.add_project_log(
    v_project,
    'comment-added',
    'Mensagem adicionada no acompanhamento',
    format('“%s” · “%s”', v_sub.title, v_preview),
    auth.uid()
  );

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

create or replace function public.delete_followup_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment public.subactivity_comments%rowtype;
  v_project uuid;
  v_workspace uuid;
begin
  select * into v_comment
    from public.subactivity_comments
   where id = p_comment_id;
  if not found then return true; end if;

  v_project := public.subactivity_project_id(v_comment.subactivity_id);
  v_workspace := public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if not public.is_workspace_admin(v_workspace)
     and not (v_comment.author_id = auth.uid() and v_comment.created_at >= now() - interval '30 minutes') then
    raise exception 'A mensagem só pode ser excluída pelo autor nos primeiros 30 minutos';
  end if;

  delete from public.subactivity_comments where id = p_comment_id;
  return true;
end;
$$;

create or replace function public.toggle_followup_comment_mark(
  p_comment_id uuid,
  p_marked boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subactivity uuid;
  v_project uuid;
  v_workspace uuid;
begin
  select subactivity_id into v_subactivity
    from public.subactivity_comments
   where id = p_comment_id;
  if v_subactivity is null then raise exception 'Mensagem não encontrada'; end if;

  v_project := public.subactivity_project_id(v_subactivity);
  v_workspace := public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then raise exception 'Sem acesso ao projeto'; end if;

  if coalesce(p_marked,false) then
    insert into public.followup_comment_marks(comment_id,user_id)
    values(p_comment_id,auth.uid())
    on conflict (comment_id,user_id) do nothing;
  else
    delete from public.followup_comment_marks
    where comment_id = p_comment_id and user_id = auth.uid();
  end if;
  return true;
end;
$$;

revoke execute on function public.add_followup_comment(uuid,text,jsonb,uuid) from public, anon;
grant execute on function public.add_followup_comment(uuid,text,jsonb,uuid) to authenticated;
revoke execute on function public.delete_followup_comment(uuid) from public, anon;
grant execute on function public.delete_followup_comment(uuid) to authenticated;
revoke execute on function public.toggle_followup_comment_mark(uuid,boolean) from public, anon;
grant execute on function public.toggle_followup_comment_mark(uuid,boolean) to authenticated;

commit;
