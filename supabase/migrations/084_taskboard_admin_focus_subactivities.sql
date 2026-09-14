begin;

-- 084 · Foco de hoje definido pela administração
-- Permite que Administradores marquem subatividades que devem aparecer no
-- bloco "Foco de hoje" do dashboard. A marcação é persistente até ser removida.

alter table public.subactivities
  add column if not exists is_focus boolean not null default false,
  add column if not exists focus_marked_at timestamptz,
  add column if not exists focus_marked_by uuid references public.profiles(id) on delete set null;

create index if not exists subactivities_focus_idx
  on public.subactivities(focus_marked_at desc)
  where is_focus = true;

create or replace function public.set_subactivity_focus_admin(
  p_subactivity_id uuid,
  p_enabled boolean
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
  v_enabled boolean := coalesce(p_enabled, false);
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

  if v_workspace is null or public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem definir o Foco de hoje';
  end if;

  if coalesce(v_sub.is_focus, false) = v_enabled then
    return;
  end if;

  update public.subactivities
     set is_focus = v_enabled,
         focus_marked_at = case when v_enabled then now() else null end,
         focus_marked_by = case when v_enabled then auth.uid() else null end,
         updated_at = now()
   where id = p_subactivity_id;

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    case when v_enabled then 'Subatividade marcada como foco' else 'Subatividade removida do foco' end,
    format(
      '“%s” %s no bloco Foco de hoje pela administração.',
      v_sub.title,
      case when v_enabled then 'foi incluída' else 'foi removida' end
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.set_subactivity_focus_admin(uuid,boolean) from public, anon;
grant execute on function public.set_subactivity_focus_admin(uuid,boolean) to authenticated;

comment on column public.subactivities.is_focus is 'Subatividade destacada manualmente pela administração no bloco Foco de hoje.';
comment on column public.subactivities.focus_marked_at is 'Data/hora da última marcação como foco.';
comment on column public.subactivities.focus_marked_by is 'Administrador que marcou a subatividade como foco.';

commit;
