begin;

create table if not exists public.followup_reactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  target_kind text not null check (target_kind in ('comment','attachment','session','log')),
  target_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_reactions_one_per_user unique (subactivity_id,target_kind,target_id,user_id)
);

create index if not exists followup_reactions_subactivity_idx
  on public.followup_reactions(subactivity_id,created_at);
create index if not exists followup_reactions_target_idx
  on public.followup_reactions(target_kind,target_id);

alter table public.followup_reactions enable row level security;
alter table public.followup_reactions replica identity full;

drop policy if exists cadence_followup_reactions_select on public.followup_reactions;
create policy cadence_followup_reactions_select
  on public.followup_reactions for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.followup_reactions from anon, authenticated;
grant select on public.followup_reactions to authenticated;

create or replace function public.set_followup_reaction(
  p_subactivity_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_emoji text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_valid boolean := false;
  v_emoji text := nullif(btrim(coalesce(p_emoji,'')), '');
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_subactivity_id is null or p_target_id is null then raise exception 'Item inválido'; end if;
  if p_target_kind not in ('comment','attachment','session','log') then raise exception 'Tipo de reação inválido'; end if;

  select a.project_id, p.workspace_id
    into v_project, v_workspace
    from public.subactivities s
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
   where s.id = p_subactivity_id;

  if v_project is null or v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao acompanhamento';
  end if;

  if p_target_kind = 'comment' then
    select exists(
      select 1 from public.subactivity_comments c
       where c.id = p_target_id and c.subactivity_id = p_subactivity_id
    ) into v_valid;
  elsif p_target_kind = 'attachment' then
    select exists(
      select 1 from public.attachments a
       where a.id = p_target_id and a.subactivity_id = p_subactivity_id and a.active = true
    ) into v_valid;
  elsif p_target_kind = 'session' then
    select exists(
      select 1 from public.work_sessions w
       where w.id = p_target_id and w.subactivity_id = p_subactivity_id
    ) into v_valid;
  else
    select exists(
      select 1 from public.project_logs l
       where l.id = p_target_id and l.project_id = v_project
    ) into v_valid;
  end if;

  if not v_valid then raise exception 'Item do acompanhamento não encontrado'; end if;

  if v_emoji is null then
    delete from public.followup_reactions
     where subactivity_id = p_subactivity_id
       and target_kind = p_target_kind
       and target_id = p_target_id
       and user_id = auth.uid();
    return true;
  end if;

  if v_emoji not in (
    '👍','👎','❤️','😂','😮','😢','😡','🎉','🔥','🚀',
    '👀','✅','💯','🤔','🙏','👏','💪','💡','⚠️','⭐'
  ) then
    raise exception 'Emoji de reação inválido';
  end if;

  insert into public.followup_reactions(
    workspace_id,project_id,subactivity_id,target_kind,target_id,user_id,emoji,created_at,updated_at
  ) values (
    v_workspace,v_project,p_subactivity_id,p_target_kind,p_target_id,auth.uid(),v_emoji,now(),now()
  )
  on conflict (subactivity_id,target_kind,target_id,user_id)
  do update set emoji = excluded.emoji, updated_at = now();

  return true;
end;
$$;

revoke execute on function public.set_followup_reaction(uuid,text,uuid,text) from public, anon;
grant execute on function public.set_followup_reaction(uuid,text,uuid,text) to authenticated;

create or replace function public.cleanup_followup_reactions_for_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text;
begin
  v_kind := case TG_TABLE_NAME
    when 'subactivity_comments' then 'comment'
    when 'attachments' then 'attachment'
    when 'work_sessions' then 'session'
    when 'project_logs' then 'log'
    else null
  end;
  if v_kind is not null then
    delete from public.followup_reactions where target_kind = v_kind and target_id = old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists cleanup_followup_reactions_comments on public.subactivity_comments;
create trigger cleanup_followup_reactions_comments
  after delete on public.subactivity_comments
  for each row execute function public.cleanup_followup_reactions_for_source();

drop trigger if exists cleanup_followup_reactions_attachments on public.attachments;
create trigger cleanup_followup_reactions_attachments
  after delete on public.attachments
  for each row execute function public.cleanup_followup_reactions_for_source();

drop trigger if exists cleanup_followup_reactions_sessions on public.work_sessions;
create trigger cleanup_followup_reactions_sessions
  after delete on public.work_sessions
  for each row execute function public.cleanup_followup_reactions_for_source();

drop trigger if exists cleanup_followup_reactions_logs on public.project_logs;
create trigger cleanup_followup_reactions_logs
  after delete on public.project_logs
  for each row execute function public.cleanup_followup_reactions_for_source();

-- Realtime é best-effort: ambientes onde a tabela já está publicada não devem falhar.
do $$
begin
  alter publication supabase_realtime add table public.followup_reactions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;
