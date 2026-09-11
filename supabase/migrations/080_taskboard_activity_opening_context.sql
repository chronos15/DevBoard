-- TaskBoard V98 · Dados adicionais na abertura da atividade
-- Execute depois da migration 079.
--
-- Mantém add_activity intacta para preservar compatibilidade com os fluxos
-- existentes. Os novos dados são persistidos logo após a criação pela RPC
-- set_activity_context.

begin;

alter table public.activities add column if not exists build text;
alter table public.activities add column if not exists linked_os text;
alter table public.activities add column if not exists priority text;
alter table public.activities add column if not exists related_module text;
alter table public.activities add column if not exists subject text;
alter table public.activities add column if not exists responsible_department text;

do $$ begin
  if not exists (
    select 1
      from pg_constraint
     where conname='activities_priority_valid'
       and conrelid='public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_priority_valid
      check (priority is null or priority in ('low','medium','high'));
  end if;
end $$;

create or replace function public.set_activity_context(
  p_activity_id uuid,
  p_build text default null,
  p_linked_os text default null,
  p_priority text default null,
  p_related_module text default null,
  p_subject text default null,
  p_responsible_department text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_project_id uuid;
  v_role text;
  v_build text := nullif(btrim(coalesce(p_build,'')), '');
  v_linked_os text := nullif(btrim(coalesce(p_linked_os,'')), '');
  v_priority text := nullif(btrim(coalesce(p_priority,'')), '');
  v_related_module text := nullif(btrim(coalesce(p_related_module,'')), '');
  v_subject text := nullif(btrim(coalesce(p_subject,'')), '');
  v_responsible_department text := nullif(btrim(coalesce(p_responsible_department,'')), '');
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select a.project_id into v_project_id
    from public.activities a
   where a.id=p_activity_id
   for update;
  if not found then
    raise exception 'Atividade não encontrada';
  end if;

  select * into v_project
    from public.projects
   where id=v_project_id;
  if not found then
    raise exception 'Projeto não encontrado';
  end if;

  select wm.role::text into v_role
    from public.workspace_members wm
   where wm.workspace_id=v_project.workspace_id
     and wm.user_id=auth.uid()
     and wm.active;
  if v_role is null then
    raise exception 'Sem permissão para alterar a atividade';
  end if;

  if not public.taskboard_can_perform_action('createActivities',v_project.workspace_id,auth.uid()) then
    raise exception 'Seu nível de acesso não permite alterar os dados da atividade';
  end if;

  if v_role<>'admin' and not exists(
    select 1
      from public.project_members pm
     where pm.project_id=v_project_id
       and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para alterar a atividade';
  end if;

  if char_length(coalesce(v_build,''))>120 then
    raise exception 'Build deve ter no máximo 120 caracteres';
  end if;
  if char_length(coalesce(v_linked_os,''))>120 then
    raise exception 'O.S. vinculada deve ter no máximo 120 caracteres';
  end if;
  if char_length(coalesce(v_related_module,''))>100
     or char_length(coalesce(v_subject,''))>100
     or char_length(coalesce(v_responsible_department,''))>100 then
    raise exception 'Módulo, assunto e departamento devem ter no máximo 100 caracteres';
  end if;

  if v_priority is not null and v_priority not in ('low','medium','high') then
    raise exception 'Prioridade inválida';
  end if;

  if v_related_module is not null
     and not (v_related_module = any(coalesce(v_project.modules,'{}'::text[]))) then
    raise exception 'O módulo selecionado não pertence ao contexto deste projeto';
  end if;
  if v_subject is not null
     and not (v_subject = any(coalesce(v_project.subjects,'{}'::text[]))) then
    raise exception 'O assunto selecionado não pertence ao contexto deste projeto';
  end if;
  if v_responsible_department is not null
     and not (v_responsible_department = any(coalesce(v_project.responsible_departments,'{}'::text[]))) then
    raise exception 'O departamento selecionado não pertence ao contexto deste projeto';
  end if;

  update public.activities
     set build=v_build,
         linked_os=v_linked_os,
         priority=v_priority,
         related_module=v_related_module,
         subject=v_subject,
         responsible_department=v_responsible_department
   where id=p_activity_id;
end;
$$;

revoke execute on function public.set_activity_context(uuid,text,text,text,text,text,text) from public, anon;
grant execute on function public.set_activity_context(uuid,text,text,text,text,text,text) to authenticated;

commit;
