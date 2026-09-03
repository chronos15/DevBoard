begin;

-- =============================================================================
-- 041 · Pausa automática por inatividade + tipos intermitentes
-- =============================================================================
-- O cliente usa este sinal para não pausar atividades/subatividades que podem
-- permanecer longos períodos sem interação com o computador, como reuniões.

alter table public.work_item_types
  add column if not exists intermittent boolean not null default false;

-- "Reunião" é um tipo inicial útil para este comportamento. Se já existir,
-- preservamos o registro e apenas ativamos a característica intermitente.
insert into public.work_item_types(workspace_id,name,color,active,intermittent,created_by)
select w.id, 'Reunião', '#6366F1', true, true, null
from public.workspaces w
where not exists (
  select 1
    from public.work_item_types wit
   where wit.workspace_id=w.id
     and lower(btrim(wit.name))=lower('Reunião')
);

update public.work_item_types
   set intermittent=true,
       updated_at=now()
 where lower(btrim(name))=lower('Reunião');

-- Recriamos as RPCs com o campo adicional, mantendo defaults para que clientes
-- já abertos com a assinatura anterior continuem funcionando durante deploy.
drop function if exists public.create_work_item_type(text,text);

create function public.create_work_item_type(
  p_name text,
  p_color text default '#64748B',
  p_intermittent boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_name text := btrim(coalesce(p_name,''));
  v_color text := upper(btrim(coalesce(p_color,'#64748B')));
  v_id uuid;
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não autenticado';
  end if;
  if public.workspace_role_of(v_workspace,auth.uid()) <> 'admin' then
    raise exception 'Apenas administradores podem criar tipos';
  end if;
  if length(v_name) < 1 or length(v_name) > 48 then
    raise exception 'O nome do tipo deve ter entre 1 e 48 caracteres';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Cor inválida';
  end if;

  insert into public.work_item_types(workspace_id,name,color,active,intermittent,created_by)
  values(v_workspace,v_name,v_color,true,coalesce(p_intermittent,false),auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um tipo com este nome';
end;
$$;

drop function if exists public.update_work_item_type(uuid,text,text,boolean);

create function public.update_work_item_type(
  p_type_id uuid,
  p_name text default null,
  p_color text default null,
  p_active boolean default null,
  p_intermittent boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type public.work_item_types%rowtype;
  v_name text;
  v_color text;
begin
  select * into v_type
    from public.work_item_types
   where id=p_type_id
   for update;

  if not found then raise exception 'Tipo não encontrado'; end if;
  if public.workspace_role_of(v_type.workspace_id,auth.uid()) <> 'admin' then
    raise exception 'Apenas administradores podem alterar tipos';
  end if;

  v_name := case when p_name is null then v_type.name else btrim(p_name) end;
  v_color := case when p_color is null then v_type.color else upper(btrim(p_color)) end;

  if length(v_name) < 1 or length(v_name) > 48 then
    raise exception 'O nome do tipo deve ter entre 1 e 48 caracteres';
  end if;
  if v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Cor inválida';
  end if;

  update public.work_item_types
     set name=v_name,
         color=v_color,
         active=coalesce(p_active,active),
         intermittent=coalesce(p_intermittent,intermittent),
         updated_at=now()
   where id=p_type_id;
exception
  when unique_violation then
    raise exception 'Já existe um tipo com este nome';
end;
$$;

revoke execute on function public.create_work_item_type(text,text,boolean) from public,anon;
revoke execute on function public.update_work_item_type(uuid,text,text,boolean,boolean) from public,anon;
grant execute on function public.create_work_item_type(text,text,boolean) to authenticated;
grant execute on function public.update_work_item_type(uuid,text,text,boolean,boolean) to authenticated;

commit;
