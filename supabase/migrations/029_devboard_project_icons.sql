begin;

-- 029 · Ícones dos projetos
-- Mantém compatibilidade com projetos existentes e com as RPCs atuais de criação/edição.

alter table public.projects
  add column if not exists icon text not null default 'folder-kanban';

update public.projects
set icon = 'folder-kanban'
where icon is null or btrim(icon) = '';

alter table public.projects
  drop constraint if exists projects_icon_check;

alter table public.projects
  add constraint projects_icon_check check (
    icon in (
      'folder-kanban','code','smartphone','monitor','server','database','globe',
      'shopping-cart','credit-card','store','package','boxes','wrench','rocket','bug','shield'
    )
  );

create or replace function public.set_project_icon(p_project_id uuid, p_icon text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_workspace uuid;
  v_icon text := coalesce(nullif(btrim(p_icon),''),'folder-kanban');
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'Projeto não encontrado'; end if;

  v_workspace := v_project.workspace_id;
  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  if not public.is_workspace_admin(v_workspace)
     and v_project.created_by <> auth.uid()
     and (
       public.workspace_role_of(v_workspace, auth.uid()) <> 'developer'
       or not exists (
         select 1 from public.project_members pm
         where pm.project_id = p_project_id and pm.user_id = auth.uid()
       )
     ) then
    raise exception 'Você precisa estar integrado ao projeto para alterar o ícone';
  end if;

  if v_icon not in (
    'folder-kanban','code','smartphone','monitor','server','database','globe',
    'shopping-cart','credit-card','store','package','boxes','wrench','rocket','bug','shield'
  ) then
    raise exception 'Ícone de projeto inválido';
  end if;

  if v_project.icon is distinct from v_icon then
    update public.projects set icon = v_icon, updated_at = now() where id = p_project_id;
    perform public.add_project_log(
      p_project_id,
      'updated',
      'Ícone do projeto atualizado',
      null,
      auth.uid()
    );
  end if;
end;
$$;

revoke execute on function public.set_project_icon(uuid,text) from public, anon;
grant execute on function public.set_project_icon(uuid,text) to authenticated;

commit;
