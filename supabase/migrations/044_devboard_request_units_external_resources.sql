-- Devboard · Solicitações V24
-- Unidades administráveis + recursos externos (FTP/HTTP) no protocolo.
-- Não altera a estrutura de Projetos, Atividades ou Subatividades.

begin;

create table if not exists public.service_request_units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_request_units_name_length check (length(btrim(name)) between 2 and 80)
);

create unique index if not exists service_request_units_workspace_name_uidx
  on public.service_request_units(workspace_id, lower(btrim(name)));
create index if not exists service_request_units_workspace_active_idx
  on public.service_request_units(workspace_id, active, name);

drop trigger if exists service_request_units_set_updated_at on public.service_request_units;
create trigger service_request_units_set_updated_at
  before update on public.service_request_units
  for each row execute procedure public.set_updated_at();

alter table public.service_requests
  add column if not exists unit_id uuid references public.service_request_units(id) on delete set null;
create index if not exists service_requests_unit_idx on public.service_requests(unit_id, updated_at desc);

-- Preserva unidades já digitadas em solicitações antigas e as transforma em opções administráveis.
insert into public.service_request_units(workspace_id, name, active, created_by)
select distinct on (r.workspace_id, lower(btrim(r.unit)))
  r.workspace_id,
  btrim(r.unit),
  true,
  r.created_by
from public.service_requests r
where length(btrim(coalesce(r.unit,''))) >= 2
order by r.workspace_id, lower(btrim(r.unit)), r.created_at
on conflict do nothing;

update public.service_requests r
set unit_id = u.id
from public.service_request_units u
where r.unit_id is null
  and u.workspace_id = r.workspace_id
  and lower(btrim(u.name)) = lower(btrim(r.unit));

alter table public.service_request_attachments
  add column if not exists source_type text not null default 'upload',
  add column if not exists external_url text;

alter table public.service_request_attachments alter column storage_path drop not null;
alter table public.service_request_attachments alter column size_bytes set default 0;

alter table public.service_request_attachments
  drop constraint if exists service_request_attachments_size_bytes_check;
alter table public.service_request_attachments
  drop constraint if exists service_request_attachments_source_check;
alter table public.service_request_attachments
  add constraint service_request_attachments_source_check check (
    (
      source_type = 'upload'
      and size_bytes > 0
      and size_bytes <= 209715200
      and storage_path is not null
      and length(btrim(storage_path)) > 0
      and external_url is null
    )
    or
    (
      source_type = 'external-url'
      and size_bytes = 0
      and storage_path is null
      and external_url is not null
      and length(btrim(external_url)) between 6 and 2000
      and btrim(external_url) ~* '^(ftp|ftps|https?)://'
    )
  );

alter table public.service_request_units enable row level security;

drop policy if exists service_request_units_select on public.service_request_units;
create policy service_request_units_select
on public.service_request_units
for select to authenticated
using (
  exists(
    select 1
    from public.workspace_members wm
    where wm.workspace_id = service_request_units.workspace_id
      and wm.user_id = auth.uid()
      and wm.active
  )
);

create or replace function public.create_service_request_unit(p_name text)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_name text := btrim(coalesce(p_name,''));
  v_id uuid;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not exists(
    select 1 from public.workspace_members wm
    where wm.workspace_id=v_workspace and wm.user_id=auth.uid() and wm.active and wm.role::text='admin'
  ) then raise exception 'Apenas administradores podem criar unidades'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'O nome da unidade deve ter entre 2 e 80 caracteres'; end if;

  insert into public.service_request_units(workspace_id,name,active,created_by)
  values(v_workspace,v_name,true,auth.uid())
  returning id into v_id;
  return v_id;
exception
  when unique_violation then raise exception 'Já existe uma unidade com este nome';
end;
$$;

create or replace function public.update_service_request_unit(
  p_unit_id uuid,
  p_name text default null,
  p_active boolean default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_unit public.service_request_units%rowtype;
  v_name text;
begin
  select * into v_unit from public.service_request_units where id=p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada'; end if;
  if not exists(
    select 1 from public.workspace_members wm
    where wm.workspace_id=v_unit.workspace_id and wm.user_id=auth.uid() and wm.active and wm.role::text='admin'
  ) then raise exception 'Apenas administradores podem alterar unidades'; end if;

  v_name := case when p_name is null then v_unit.name else btrim(p_name) end;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'O nome da unidade deve ter entre 2 e 80 caracteres'; end if;

  update public.service_request_units
     set name=v_name,
         active=coalesce(p_active,active),
         updated_at=now()
   where id=p_unit_id;
exception
  when unique_violation then raise exception 'Já existe uma unidade com este nome';
end;
$$;

create or replace function public.delete_service_request_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_unit public.service_request_units%rowtype;
begin
  select * into v_unit from public.service_request_units where id=p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada'; end if;
  if not exists(
    select 1 from public.workspace_members wm
    where wm.workspace_id=v_unit.workspace_id and wm.user_id=auth.uid() and wm.active and wm.role::text='admin'
  ) then raise exception 'Apenas administradores podem excluir unidades'; end if;

  -- service_requests.unit mantém o nome histórico; unit_id é SET NULL.
  delete from public.service_request_units where id=p_unit_id;
end;
$$;

create or replace function public.create_service_request_v2(
  p_order_number text,
  p_request_type text,
  p_unit_id uuid,
  p_module text,
  p_subject text,
  p_title text,
  p_description text,
  p_priority_requested boolean default false,
  p_priority_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_unit_name text;
  v_id uuid;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;

  select u.name into v_unit_name
  from public.service_request_units u
  where u.id=p_unit_id and u.workspace_id=v_workspace and u.active;
  if v_unit_name is null then raise exception 'Selecione uma unidade ativa'; end if;

  if length(btrim(coalesce(p_order_number,''))) > 40 then raise exception 'O número da OS deve ter no máximo 40 caracteres'; end if;
  if length(btrim(coalesce(p_module,''))) > 120 then raise exception 'O módulo deve ter no máximo 120 caracteres'; end if;
  if length(btrim(coalesce(p_subject,''))) > 180 then raise exception 'O assunto deve ter no máximo 180 caracteres'; end if;
  if length(btrim(coalesce(p_title,''))) > 180 then raise exception 'O título deve ter no máximo 180 caracteres'; end if;
  if length(btrim(coalesce(p_description,''))) > 12000 then raise exception 'A descrição deve ter no máximo 12.000 caracteres'; end if;
  if length(btrim(coalesce(p_priority_reason,''))) > 2000 then raise exception 'A justificativa de prioridade deve ter no máximo 2.000 caracteres'; end if;

  v_id := public.create_service_request(
    p_order_number,
    p_request_type,
    v_unit_name,
    p_module,
    p_subject,
    p_title,
    p_description,
    p_priority_requested,
    p_priority_reason
  );

  update public.service_requests set unit_id=p_unit_id where id=v_id;
  return v_id;
end;
$$;

create or replace function public.add_service_request_external_resource(
  p_request_id uuid,
  p_message_id uuid default null,
  p_category text default 'other',
  p_url text default '',
  p_name text default 'Link externo'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_url text := btrim(coalesce(p_url,''));
  v_name text := btrim(coalesce(p_name,''));
begin
  if not public.can_view_service_request(p_request_id) then raise exception 'Sem acesso a esta solicitação'; end if;
  if p_category not in ('order-pdf','analysis-video','database','certificate','other') then raise exception 'Categoria inválida'; end if;
  if v_url !~* '^(ftp|ftps|https?)://' or length(v_url) > 2000 then raise exception 'Informe uma URL FTP/HTTP válida'; end if;
  if length(v_name) < 1 then v_name := 'Link externo'; end if;
  if length(v_name) > 180 then raise exception 'O nome do recurso deve ter no máximo 180 caracteres'; end if;
  if p_message_id is not null and not exists(
    select 1 from public.service_request_messages m where m.id=p_message_id and m.request_id=p_request_id
  ) then raise exception 'Mensagem inválida'; end if;

  insert into public.service_request_attachments(
    request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,uploaded_by,source_type,external_url
  ) values(
    p_request_id,p_message_id,p_category,v_name,'text/uri-list',0,'other',null,auth.uid(),'external-url',v_url
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_service_request_unit(text) from public,anon;
revoke execute on function public.update_service_request_unit(uuid,text,boolean) from public,anon;
revoke execute on function public.delete_service_request_unit(uuid) from public,anon;
revoke execute on function public.create_service_request_v2(text,text,uuid,text,text,text,text,boolean,text) from public,anon;
revoke execute on function public.add_service_request_external_resource(uuid,uuid,text,text,text) from public,anon;

grant execute on function public.create_service_request_unit(text) to authenticated;
grant execute on function public.update_service_request_unit(uuid,text,boolean) to authenticated;
grant execute on function public.delete_service_request_unit(uuid) to authenticated;
grant execute on function public.create_service_request_v2(text,text,uuid,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.add_service_request_external_resource(uuid,uuid,text,text,text) to authenticated;
grant select on public.service_request_units to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='service_request_units'
     ) then
    alter publication supabase_realtime add table public.service_request_units;
  end if;
end $$;

commit;
