begin;

-- 085 · Ajuste administrativo da estimativa de horas pelo dashboard da atividade.
-- A RPC altera somente a estimativa. Título, responsável, tipo, status e horas
-- já trabalhadas permanecem intactos.

create or replace function public.update_subactivity_estimate_admin(
  p_subactivity_id uuid,
  p_estimated_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_new_estimate numeric := greatest(coalesce(p_estimated_hours, 0), 0);
  v_old_label text;
  v_new_label text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  select *
    into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem ajustar a estimativa de horas';
  end if;

  if p_estimated_hours is null or p_estimated_hours < 0 then
    raise exception 'A estimativa precisa ser igual ou maior que zero';
  end if;

  if p_estimated_hours > 100000 then
    raise exception 'A estimativa informada é muito alta';
  end if;

  if coalesce(v_sub.estimated_hours, 0) is not distinct from v_new_estimate then
    return;
  end if;

  v_old_label := trim(to_char(coalesce(v_sub.estimated_hours, 0), 'FM999999990.##'));
  v_new_label := trim(to_char(v_new_estimate, 'FM999999990.##'));

  update public.subactivities
     set estimated_hours = v_new_estimate,
         updated_at = now()
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    'Estimativa da subatividade ajustada',
    format('“%s” · estimativa: %sh → %sh.', v_sub.title, v_old_label, v_new_label),
    auth.uid()
  );
end;
$$;

revoke all on function public.update_subactivity_estimate_admin(uuid,numeric) from public, anon;
grant execute on function public.update_subactivity_estimate_admin(uuid,numeric) to authenticated;

commit;
