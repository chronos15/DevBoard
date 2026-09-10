begin;

-- 073 · Anotações em atividade + terminologia de anotações na subatividade
--
-- A estrutura histórica `subactivity_checklist_items` é mantida para preservar
-- compatibilidade. Apenas a linguagem apresentada ao usuário passa a ser
-- "Anotações". Atividades ganham anotações próprias, com opção de transformar
-- uma anotação em subatividade sem perder o registro original.

create table if not exists public.activity_notes (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  content text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_subactivity_id uuid references public.subactivities(id) on delete set null,
  converted_at timestamptz,
  converted_by uuid references public.profiles(id) on delete set null,
  constraint activity_notes_content_chk check (char_length(btrim(content)) between 1 and 2000)
);

create index if not exists activity_notes_activity_idx
  on public.activity_notes(activity_id, created_at, id);
create index if not exists activity_notes_converted_sub_idx
  on public.activity_notes(converted_subactivity_id)
  where converted_subactivity_id is not null;

alter table public.activity_notes enable row level security;
alter table public.activity_notes replica identity full;

-- Todos que pertencem ao workspace podem consultar as anotações da atividade.
-- Escrita continua passando somente pelas RPCs abaixo.
drop policy if exists taskboard_activity_notes_select on public.activity_notes;
create policy taskboard_activity_notes_select
  on public.activity_notes for select to authenticated
  using (
    public.is_workspace_member(
      public.project_workspace_id(public.activity_project_id(activity_id))
    )
  );

revoke all on public.activity_notes from anon, authenticated;
grant select on public.activity_notes to authenticated;

create or replace function public.can_manage_activity_notes(p_activity_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_role text;
begin
  if p_activity_id is null or p_user_id is null then return false; end if;
  v_project := public.activity_project_id(p_activity_id);
  if v_project is null then return false; end if;
  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace, p_user_id) then return false; end if;

  v_role := public.workspace_role_of(v_workspace, p_user_id)::text;
  return v_role in ('admin','developer')
    or exists (
      select 1 from public.project_members pm
       where pm.project_id = v_project and pm.user_id = p_user_id
    );
end;
$$;

create or replace function public.add_activity_note(p_activity_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_content text := btrim(coalesce(p_content, ''));
  v_project uuid;
  v_activity_title text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not public.can_manage_activity_notes(p_activity_id) then
    raise exception 'Sem permissão para adicionar anotações nesta atividade';
  end if;
  if char_length(v_content) < 1 then raise exception 'Digite uma anotação'; end if;
  if char_length(v_content) > 2000 then raise exception 'A anotação deve ter no máximo 2000 caracteres'; end if;

  select a.project_id, a.title into v_project, v_activity_title
    from public.activities a where a.id = p_activity_id;
  if not found then raise exception 'Atividade não encontrada'; end if;

  insert into public.activity_notes(activity_id, content, created_by)
  values (p_activity_id, v_content, auth.uid())
  returning id into v_id;

  perform public.add_project_log(
    v_project,
    'activity-note-added',
    'Anotação adicionada na atividade',
    format('Anotação em “%s”: “%s”.', v_activity_title, v_content),
    auth.uid()
  );

  return v_id;
end;
$$;

create or replace function public.delete_activity_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.activity_notes%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_activity_title text;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;

  select * into v_note
    from public.activity_notes
   where id = p_note_id
   for update;
  if not found then raise exception 'Anotação não encontrada'; end if;

  if not public.can_manage_activity_notes(v_note.activity_id) then
    raise exception 'Sem permissão para alterar anotações nesta atividade';
  end if;

  v_project := public.activity_project_id(v_note.activity_id);
  v_workspace := public.project_workspace_id(v_project);
  v_role := public.workspace_role_of(v_workspace, auth.uid())::text;

  if auth.uid() <> v_note.created_by and v_role <> 'admin' then
    raise exception 'Somente o autor ou um administrador pode excluir esta anotação';
  end if;

  select title into v_activity_title from public.activities where id = v_note.activity_id;
  delete from public.activity_notes where id = p_note_id;

  perform public.add_project_log(
    v_project,
    'activity-note-removed',
    'Anotação removida da atividade',
    format('Anotação em “%s” removida: “%s”.', v_activity_title, v_note.content),
    auth.uid()
  );
end;
$$;

create or replace function public.promote_activity_note_to_subactivity(
  p_note_id uuid,
  p_title text,
  p_estimated_hours numeric,
  p_assignee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.activity_notes%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_activity_title text;
  v_subactivity_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;

  select * into v_note
    from public.activity_notes
   where id = p_note_id
   for update;
  if not found then raise exception 'Anotação não encontrada'; end if;

  if v_note.converted_subactivity_id is not null then
    raise exception 'Esta anotação já foi transformada em subatividade';
  end if;
  if not public.can_manage_activity_notes(v_note.activity_id) then
    raise exception 'Sem permissão para criar subatividade nesta atividade';
  end if;
  if char_length(v_title) < 1 then raise exception 'Título da subatividade é obrigatório'; end if;

  v_project := public.activity_project_id(v_note.activity_id);
  v_workspace := public.project_workspace_id(v_project);
  if public.workspace_role_of(v_workspace, p_assignee_id)::text not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  v_subactivity_id := public.add_subactivity(
    v_project,
    v_note.activity_id,
    v_title,
    greatest(coalesce(p_estimated_hours, 0), 0),
    p_assignee_id,
    'backlog'
  );

  update public.activity_notes
     set converted_subactivity_id = v_subactivity_id,
         converted_at = now(),
         converted_by = auth.uid(),
         updated_at = now()
   where id = p_note_id;

  select title into v_activity_title from public.activities where id = v_note.activity_id;
  perform public.add_project_log(
    v_project,
    'activity-note-promoted',
    'Anotação transformada em subatividade',
    format('Em “%s”, a anotação “%s” originou a subatividade “%s”.', v_activity_title, v_note.content, v_title),
    auth.uid()
  );

  return v_subactivity_id;
end;
$$;

revoke execute on function public.can_manage_activity_notes(uuid,uuid) from public, anon;
revoke execute on function public.add_activity_note(uuid,text) from public, anon;
revoke execute on function public.delete_activity_note(uuid) from public, anon;
revoke execute on function public.promote_activity_note_to_subactivity(uuid,text,numeric,uuid) from public, anon;
grant execute on function public.can_manage_activity_notes(uuid,uuid) to authenticated;
grant execute on function public.add_activity_note(uuid,text) to authenticated;
grant execute on function public.delete_activity_note(uuid) to authenticated;
grant execute on function public.promote_activity_note_to_subactivity(uuid,text,numeric,uuid) to authenticated;

-- Mantém os nomes físicos das funções/tabela de checklist por compatibilidade,
-- mas todos os textos novos gerados para o usuário passam a dizer Anotações.
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
    raise exception 'As anotações ficam bloqueadas enquanto a subatividade está em análise ou finalizada';
  end if;

  insert into public.subactivity_checklist_items(subactivity_id,content,created_by)
  values(p_subactivity_id,v_content,auth.uid())
  returning id into v_id;

  v_project:=public.subactivity_project_id(p_subactivity_id);
  perform public.add_project_log(
    v_project,'checklist-added','Anotação adicionada',
    format('Anotação de “%s”: “%s” foi adicionada.',v_sub_title,v_content),auth.uid()
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
  if not found then raise exception 'Anotação não encontrada'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.status::text,s.title into v_status,v_sub_title
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'As anotações ficam bloqueadas enquanto a subatividade está em análise ou finalizada';
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
    case when coalesce(p_completed,false) then 'Anotação finalizada' else 'Anotação reaberta' end,
    format('Anotação de “%s”: “%s” foi %s.',v_sub_title,v_item.content,case when coalesce(p_completed,false) then 'finalizada' else 'reaberta' end),
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
  if not found then raise exception 'Anotação não encontrada'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.assignee_id,s.status::text,s.title into v_assignee,v_status,v_sub_title
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  v_project:=public.subactivity_project_id(v_item.subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);

  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'As anotações ficam bloqueadas enquanto a subatividade está em análise ou finalizada';
  end if;

  if auth.uid()<>v_item.created_by
     and auth.uid()<>v_assignee
     and public.workspace_role_of(v_workspace,auth.uid())::text<>'admin' then
    raise exception 'Somente o autor, responsável ou administrador pode excluir esta anotação';
  end if;

  delete from public.subactivity_checklist_items where id=p_item_id;

  perform public.add_project_log(
    v_project,'checklist-removed','Anotação removida',
    format('Anotação de “%s”: “%s” foi removida.',v_sub_title,v_item.content),auth.uid()
  );
end;
$$;

revoke execute on function public.add_subactivity_checklist_item(uuid,text) from public,anon;
revoke execute on function public.set_subactivity_checklist_item_completed(uuid,boolean) from public,anon;
revoke execute on function public.delete_subactivity_checklist_item(uuid) from public,anon;
grant execute on function public.add_subactivity_checklist_item(uuid,text) to authenticated;
grant execute on function public.set_subactivity_checklist_item_completed(uuid,boolean) to authenticated;
grant execute on function public.delete_subactivity_checklist_item(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'activity_notes'
  ) then
    alter publication supabase_realtime add table public.activity_notes;
  end if;
end
$$;

commit;
