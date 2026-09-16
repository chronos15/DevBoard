begin;

-- TaskBoard V171 · O.S. e Versão / Build por subatividade
-- Mantém os campos existentes da atividade por compatibilidade, mas as
-- referências informadas na criação/edição da subatividade passam a ser
-- persistidas diretamente em public.subactivities.
//
alter table public.subactivities
  add column if not exists linked_os text,
  add column if not exists build text;

create or replace function public.set_subactivity_context(
  p_subactivity_id uuid,
  p_linked_os text default null,
  p_build text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_role text;
  v_linked_os text := nullif(btrim(coalesce(p_linked_os, '')), '');
  v_build text := nullif(btrim(coalesce(p_build, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  if v_project is null then
    raise exception 'Subatividade não encontrada';
  end if;

  v_workspace := public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para alterar a subatividade';
  end if;

  if not public.taskboard_can_perform_action('createSubactivities', v_workspace, auth.uid()) then
    raise exception 'Seu nível de acesso não permite alterar referências da subatividade';
  end if;

  v_role := public.workspace_role_of(v_workspace, auth.uid());
  if v_role not in ('admin', 'developer') and not exists (
    select 1
      from public.project_members pm
     where pm.project_id = v_project
       and pm.user_id = auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para alterar a subatividade';
  end if;

  if char_length(coalesce(v_linked_os, '')) > 120 then
    raise exception 'Número da O.S. deve ter no máximo 120 caracteres';
  end if;

  if char_length(coalesce(v_build, '')) > 120 then
    raise exception 'Versão / Build deve ter no máximo 120 caracteres';
  end if;

  update public.subactivities
     set linked_os = v_linked_os,
         build = v_build,
         updated_at = now()
   where id = p_subactivity_id;
end;
$$;

revoke all on function public.set_subactivity_context(uuid,text,text) from public, anon;
grant execute on function public.set_subactivity_context(uuid,text,text) to authenticated;

comment on column public.subactivities.linked_os is 'Número de O.S. opcional vinculado especificamente à subatividade.';
comment on column public.subactivities.build is 'Versão / Build opcional vinculado especificamente à subatividade.';

commit;
