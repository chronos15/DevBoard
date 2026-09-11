begin;

-- 079 · Histórico não destrutivo das anotações da atividade
--
-- Anotações transformadas em subatividade já permaneciam vinculadas pelo campo
-- converted_subactivity_id. A partir desta versão, exclusões também viram estado
-- histórico: o registro continua visível, riscado e identificado como excluído.

alter table public.activity_notes
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create index if not exists activity_notes_deleted_idx
  on public.activity_notes(activity_id, deleted_at)
  where deleted_at is not null;

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

  if v_note.deleted_at is not null then
    return;
  end if;

  if not public.can_manage_activity_notes(v_note.activity_id) then
    raise exception 'Sem permissão para alterar anotações nesta atividade';
  end if;

  v_project := public.activity_project_id(v_note.activity_id);
  v_workspace := public.project_workspace_id(v_project);
  v_role := public.workspace_role_of(v_workspace, auth.uid())::text;

  if auth.uid() <> v_note.created_by and v_role <> 'admin' then
    raise exception 'Somente o autor ou um administrador pode excluir esta anotação';
  end if;

  if v_note.converted_subactivity_id is not null then
    raise exception 'Uma anotação transformada em subatividade faz parte do histórico e não pode ser excluída';
  end if;

  update public.activity_notes
     set deleted_at = now(),
         deleted_by = auth.uid(),
         updated_at = now()
   where id = p_note_id;

  select title into v_activity_title from public.activities where id = v_note.activity_id;

  perform public.add_project_log(
    v_project,
    'activity-note-removed',
    'Anotação excluída da atividade',
    format('Anotação em “%s” marcada como excluída: “%s”.', v_activity_title, v_note.content),
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

  if v_note.deleted_at is not null then
    raise exception 'Uma anotação excluída não pode ser transformada em subatividade';
  end if;
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

revoke execute on function public.delete_activity_note(uuid) from public, anon;
revoke execute on function public.promote_activity_note_to_subactivity(uuid,text,numeric,uuid) from public, anon;
grant execute on function public.delete_activity_note(uuid) to authenticated;
grant execute on function public.promote_activity_note_to_subactivity(uuid,text,numeric,uuid) to authenticated;

commit;
