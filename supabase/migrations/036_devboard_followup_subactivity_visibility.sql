begin;

-- 036 · Visibilidade privada do Acompanhamento por subatividade
-- O modo Lista/Kanban continua com as regras existentes. Esta tabela representa
-- somente os participantes explícitos de uma subatividade no Acompanhamento.
create table if not exists public.subactivity_members (
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (subactivity_id,user_id)
);

create index if not exists subactivity_members_user_idx
  on public.subactivity_members(user_id,subactivity_id);

alter table public.subactivity_members enable row level security;
alter table public.subactivity_members replica identity full;

drop policy if exists cadence_subactivity_members_select on public.subactivity_members;
create policy cadence_subactivity_members_select
  on public.subactivity_members for select to authenticated
  using (
    public.is_workspace_member(
      public.project_workspace_id(public.subactivity_project_id(subactivity_id))
    )
  );

revoke all on public.subactivity_members from anon, authenticated;
grant select on public.subactivity_members to authenticated;

-- Mantém participantes históricos. O responsável sempre participa; quem criou,
-- comentou, anexou ou registrou trabalho também já participou de fato daquele fluxo.
insert into public.subactivity_members(subactivity_id,user_id,added_by)
select s.id,s.assignee_id,s.created_by
  from public.subactivities s
on conflict (subactivity_id,user_id) do nothing;

insert into public.subactivity_members(subactivity_id,user_id,added_by)
select s.id,s.created_by,s.created_by
  from public.subactivities s
on conflict (subactivity_id,user_id) do nothing;

insert into public.subactivity_members(subactivity_id,user_id,added_by)
select distinct c.subactivity_id,c.author_id,c.author_id
  from public.subactivity_comments c
on conflict (subactivity_id,user_id) do nothing;

insert into public.subactivity_members(subactivity_id,user_id,added_by)
select distinct a.subactivity_id,a.uploaded_by,a.uploaded_by
  from public.attachments a
 where a.subactivity_id is not null
on conflict (subactivity_id,user_id) do nothing;

insert into public.subactivity_members(subactivity_id,user_id,added_by)
select distinct w.subactivity_id,w.user_id,w.user_id
  from public.work_sessions w
on conflict (subactivity_id,user_id) do nothing;

-- Preserva também usuários mencionados historicamente, desde que ainda pertençam
-- ao workspace daquele projeto.
insert into public.subactivity_members(subactivity_id,user_id,added_by)
select distinct
  c.subactivity_id,
  (m.value->>'id')::uuid,
  c.author_id
from public.subactivity_comments c
cross join lateral jsonb_array_elements(coalesce(c.mentions,'[]'::jsonb)) m(value)
join public.subactivities s on s.id=c.subactivity_id
join public.activities act on act.id=s.activity_id
join public.projects p on p.id=act.project_id
join public.workspace_members wm
  on wm.workspace_id=p.workspace_id
 and wm.active=true
 and wm.user_id=case
   when (m.value->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   then (m.value->>'id')::uuid
   else null
 end
where m.value->>'kind'='user'
on conflict (subactivity_id,user_id) do nothing;

create or replace function public.can_access_followup_subactivity(p_subactivity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists(
    select 1
      from public.subactivities s
      join public.activities a on a.id=s.activity_id
      join public.projects p on p.id=a.project_id
     where s.id=p_subactivity_id
       and public.is_workspace_member(p.workspace_id)
       and (
         public.workspace_role_of(p.workspace_id,auth.uid())='admin'
         or s.assignee_id=auth.uid()
         or exists(
           select 1
             from public.subactivity_members sm
            where sm.subactivity_id=s.id
              and sm.user_id=auth.uid()
         )
       )
  );
$$;

revoke execute on function public.can_access_followup_subactivity(uuid) from public,anon;
grant execute on function public.can_access_followup_subactivity(uuid) to authenticated;

-- Novas subatividades já nascem com o responsável e o criador como participantes
-- do acompanhamento. O restante da regra permanece igual à migration 033.
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

-- Uma mensagem só pode ser enviada por quem realmente enxerga a subatividade.
-- Mencionar alguém cria o vínculo com a subatividade (e com o projeto, se preciso).
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
  v_was_project_member boolean;
  v_was_sub_member boolean;
  v_mentions jsonb := coalesce(p_mentions, '[]'::jsonb);
begin
  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Você não participa desta subatividade';
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
    select 1 from public.subactivity_comments c
     where c.id = p_reply_to_comment_id and c.subactivity_id = p_subactivity_id
  ) then
    raise exception 'A mensagem respondida não pertence a esta subatividade';
  end if;

  insert into public.subactivity_comments(
    subactivity_id, author_id, content, mentions, reply_to_comment_id
  ) values (
    p_subactivity_id, auth.uid(), btrim(p_content), v_mentions, p_reply_to_comment_id
  ) returning id into v_id;

  -- Garante que um participante que escreveu continue explicitamente associado.
  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values(p_subactivity_id,auth.uid(),auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

  select name into v_actor_name from public.profiles where id = auth.uid();
  select name into v_project_name from public.projects where id = v_project;
  v_preview := left(regexp_replace(btrim(p_content),'[[:space:]]+',' ','g'),180);

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
    ) into v_was_project_member;

    select (v_sub.assignee_id=v_recipient) or exists(
      select 1 from public.subactivity_members sm
       where sm.subactivity_id=p_subactivity_id and sm.user_id=v_recipient
    ) into v_was_sub_member;

    insert into public.project_members(project_id, user_id, added_by)
    values (v_project, v_recipient, auth.uid())
    on conflict (project_id, user_id) do nothing;

    insert into public.subactivity_members(subactivity_id,user_id,added_by)
    values (p_subactivity_id,v_recipient,auth.uid())
    on conflict (subactivity_id,user_id) do nothing;

    perform public.push_notification(
      v_recipient,
      auth.uid(),
      'followup-mention',
      format('%s mencionou você no acompanhamento', coalesce(nullif(v_actor_name,''),'Alguém')),
      case
        when not v_was_sub_member and not v_was_project_member then
          format('Você foi adicionado ao projeto e à subatividade · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title)
        when not v_was_sub_member then
          format('Você foi adicionado à subatividade · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title)
        else
          format('%s · %s · %s', coalesce(nullif(v_project_name,''),'Projeto'), v_sub.title, v_preview)
      end,
      v_project,
      v_activity,
      p_subactivity_id
    );
  end loop;

  if v_sub.assignee_id <> auth.uid() and not exists (
    select 1 from jsonb_array_elements(v_mentions) value
     where value->>'kind' = 'user' and value->>'id' = v_sub.assignee_id::text
  ) then
    perform public.push_notification(
      v_sub.assignee_id,auth.uid(),'subactivity-comment','Nova mensagem em sua subatividade',
      format('“%s” · “%s”', v_sub.title, v_preview),v_project,v_activity,p_subactivity_id
    );
  end if;

  return v_id;
end;
$$;

-- Reações também respeitam a participação da subatividade.
drop policy if exists cadence_followup_reactions_select on public.followup_reactions;
create policy cadence_followup_reactions_select
  on public.followup_reactions for select to authenticated
  using (public.can_access_followup_subactivity(subactivity_id));

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
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Sem acesso ao acompanhamento';
  end if;

  select a.project_id, p.workspace_id
    into v_project, v_workspace
    from public.subactivities s
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
   where s.id = p_subactivity_id;

  if p_target_kind = 'comment' then
    select exists(select 1 from public.subactivity_comments c where c.id=p_target_id and c.subactivity_id=p_subactivity_id) into v_valid;
  elsif p_target_kind = 'attachment' then
    select exists(select 1 from public.attachments a where a.id=p_target_id and a.subactivity_id=p_subactivity_id and a.active=true) into v_valid;
  elsif p_target_kind = 'session' then
    select exists(select 1 from public.work_sessions w where w.id=p_target_id and w.subactivity_id=p_subactivity_id) into v_valid;
  else
    select exists(select 1 from public.project_logs l where l.id=p_target_id and l.project_id=v_project) into v_valid;
  end if;

  if not v_valid then raise exception 'Item do acompanhamento não encontrado'; end if;

  if v_emoji is null then
    delete from public.followup_reactions
     where subactivity_id=p_subactivity_id and target_kind=p_target_kind
       and target_id=p_target_id and user_id=auth.uid();
    return true;
  end if;

  if v_emoji not in ('👍','👎','❤️','😂','😮','😢','😡','🎉','🔥','🚀','👀','✅','💯','🤔','🙏','👏','💪','💡','⚠️','⭐') then
    raise exception 'Emoji de reação inválido';
  end if;

  insert into public.followup_reactions(
    workspace_id,project_id,subactivity_id,target_kind,target_id,user_id,emoji,created_at,updated_at
  ) values(
    v_workspace,v_project,p_subactivity_id,p_target_kind,p_target_id,auth.uid(),v_emoji,now(),now()
  )
  on conflict (subactivity_id,target_kind,target_id,user_id)
  do update set emoji=excluded.emoji,updated_at=now();

  return true;
end;
$$;

revoke execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) from public,anon;
grant execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) to authenticated;
revoke execute on function public.add_followup_comment(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.add_followup_comment(uuid,text,jsonb,uuid) to authenticated;
revoke execute on function public.set_followup_reaction(uuid,text,uuid,text) from public,anon;
grant execute on function public.set_followup_reaction(uuid,text,uuid,text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.subactivity_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;
