begin;

-- 037 · Remoção de participantes do Acompanhamento
-- Apenas Admin, responsável pela atividade ou responsável pela subatividade
-- pode retirar um participante explícito. O responsável principal da
-- subatividade não pode ser removido do acompanhamento sem antes ser reatribuído.
create or replace function public.remove_followup_subactivity_member(
  p_subactivity_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_role text;
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;
  if p_subactivity_id is null or p_user_id is null then
    raise exception 'Participante inválido';
  end if;

  select s.*
    into v_sub
    from public.subactivities s
   where s.id=p_subactivity_id;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  v_role := public.workspace_role_of(v_workspace,auth.uid());
  v_can_manage :=
    v_role='admin'
    or v_sub.assignee_id=auth.uid()
    or exists(
      select 1
        from public.activity_assignees aa
       where aa.activity_id=v_sub.activity_id
         and aa.user_id=auth.uid()
    );

  if not v_can_manage then
    raise exception 'Somente responsáveis pela atividade/subatividade ou Administrador podem remover participantes';
  end if;

  if p_user_id=v_sub.assignee_id then
    raise exception 'O responsável principal da subatividade não pode ser removido. Altere o responsável antes de removê-lo do acompanhamento';
  end if;

  -- Admins mantêm acesso global por regra. Não oferecemos uma falsa remoção que
  -- continuaria permitindo a visualização do item.
  if public.workspace_role_of(v_workspace,p_user_id)='admin' then
    raise exception 'Administradores possuem acesso global ao acompanhamento';
  end if;

  delete from public.subactivity_members
   where subactivity_id=p_subactivity_id
     and user_id=p_user_id;

  return true;
end;
$$;

revoke execute on function public.remove_followup_subactivity_member(uuid,uuid) from public,anon;
grant execute on function public.remove_followup_subactivity_member(uuid,uuid) to authenticated;

commit;
