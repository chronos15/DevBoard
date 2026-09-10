begin;

-- 062 · Anotações/checklist por subatividade
-- Mantém o histórico de conversa separado do checklist operacional e bloqueia
-- conclusão/envio à AQS quando houver itens pendentes.

create table if not exists public.subactivity_checklist_items (
  id uuid primary key default gen_random_uuid(),
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  content text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint subactivity_checklist_items_content_chk check (char_length(btrim(content)) between 1 and 2000)
);

create index if not exists subactivity_checklist_items_sub_idx
  on public.subactivity_checklist_items(subactivity_id, created_at, id);

alter table public.subactivity_checklist_items enable row level security;
alter table public.subactivity_checklist_items replica identity full;

drop policy if exists taskboard_subactivity_checklist_select on public.subactivity_checklist_items;
create policy taskboard_subactivity_checklist_select
  on public.subactivity_checklist_items for select to authenticated
  using (public.can_access_followup_subactivity(subactivity_id));

revoke all on public.subactivity_checklist_items from anon, authenticated;
grant select on public.subactivity_checklist_items to authenticated;

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
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not public.can_access_followup_subactivity(p_subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;
  if char_length(v_content) < 1 then raise exception 'Digite uma anotação'; end if;
  if char_length(v_content) > 2000 then raise exception 'A anotação deve ter no máximo 2000 caracteres'; end if;

  select s.status::text into v_status
    from public.subactivities s
   where s.id=p_subactivity_id;
  if v_status is null then raise exception 'Subatividade não encontrada'; end if;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'O checklist fica bloqueado enquanto a subatividade está em análise ou finalizada';
  end if;

  insert into public.subactivity_checklist_items(subactivity_id,content,created_by)
  values(p_subactivity_id,v_content,auth.uid())
  returning id into v_id;

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
begin
  select * into v_item
    from public.subactivity_checklist_items
   where id=p_item_id
   for update;
  if not found then raise exception 'Item do checklist não encontrado'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.status::text into v_status
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'O checklist fica bloqueado enquanto a subatividade está em análise ou finalizada';
  end if;

  update public.subactivity_checklist_items
     set completed_at=case when coalesce(p_completed,false) then now() else null end,
         completed_by=case when coalesce(p_completed,false) then auth.uid() else null end,
         updated_at=now()
   where id=p_item_id;
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
begin
  select * into v_item
    from public.subactivity_checklist_items
   where id=p_item_id
   for update;
  if not found then raise exception 'Item do checklist não encontrado'; end if;
  if not public.can_access_followup_subactivity(v_item.subactivity_id) then
    raise exception 'Sem acesso a esta subatividade';
  end if;

  select s.assignee_id,s.status::text into v_assignee,v_status
    from public.subactivities s
   where s.id=v_item.subactivity_id;
  v_project:=public.subactivity_project_id(v_item.subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);

  if v_status in ('waiting-aqs','done','cancelled') then
    raise exception 'O checklist fica bloqueado enquanto a subatividade está em análise ou finalizada';
  end if;

  if auth.uid()<>v_item.created_by
     and auth.uid()<>v_assignee
     and not public.is_workspace_admin(v_workspace) then
    raise exception 'Somente o autor, responsável ou administrador pode excluir esta anotação';
  end if;

  delete from public.subactivity_checklist_items where id=p_item_id;
end;
$$;

revoke execute on function public.add_subactivity_checklist_item(uuid,text) from public,anon;
revoke execute on function public.set_subactivity_checklist_item_completed(uuid,boolean) from public,anon;
revoke execute on function public.delete_subactivity_checklist_item(uuid) from public,anon;
grant execute on function public.add_subactivity_checklist_item(uuid,text) to authenticated;
grant execute on function public.set_subactivity_checklist_item_completed(uuid,boolean) to authenticated;
grant execute on function public.delete_subactivity_checklist_item(uuid) to authenticated;

-- Mantém as regras já existentes e acrescenta o checklist como guarda de saída.
create or replace function public.set_subactivity_status(p_subactivity_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_admin boolean;
  v_role public.workspace_role;
  v_now timestamptz:=now();
  v_request_id uuid;
  v_order_number text;
begin
  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then raise exception 'Status inválido'; end if;
  if p_status='in-progress' then perform public.start_subactivity(p_subactivity_id); return; end if;

  select * into v_sub from public.subactivities where id=p_subactivity_id for update;
  if not found then raise exception 'Subatividade não encontrada'; end if;
  if v_sub.status::text=p_status then return; end if;

  if p_status in ('waiting-aqs','done') and exists(
    select 1
      from public.subactivity_checklist_items ci
     where ci.subactivity_id=p_subactivity_id
       and ci.completed_at is null
  ) then
    raise exception 'Finalize todos os itens do checklist antes de concluir ou enviar para AQS';
  end if;

  v_request_id:=public.service_request_for_activity(v_sub.activity_id);
  if v_request_id is not null and p_status in ('done','cancelled') then
    select order_number into v_order_number from public.service_requests where id=v_request_id;
    raise exception 'A subatividade pertence à OS %. Para finalizar, envie para Aguardando AQS; somente a aprovação do AQS pode concluir o trabalho.',v_order_number;
  end if;

  v_project:=public.subactivity_project_id(p_subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);
  v_admin:=public.is_workspace_admin(v_workspace);
  v_role:=public.current_workspace_role();

  if not v_admin and (v_role<>'developer' or v_sub.assignee_id<>auth.uid()) then raise exception 'Desenvolvedor só pode alterar a própria subatividade'; end if;
  if v_sub.status in ('done','cancelled') and not v_admin then raise exception 'Somente um administrador pode alterar uma subatividade finalizada'; end if;
  if v_sub.status='waiting-aqs' and not v_admin then raise exception 'Aguardando decisão do AQS'; end if;

  if v_sub.status='in-progress' then
    update public.work_sessions
       set ended_at=v_now,
           duration_seconds=greatest(0,floor(extract(epoch from(v_now-started_at)))::bigint)
     where subactivity_id=p_subactivity_id and user_id=v_sub.assignee_id and ended_at is null;
  end if;

  update public.subactivities
     set tracked_seconds=tracked_seconds+case when v_sub.status='in-progress' then greatest(0,floor(extract(epoch from(v_now-v_sub.timer_started_at)))::bigint) else 0 end,
         status=p_status::public.subactivity_status,
         timer_started_at=null,
         completed_at=case when p_status='done' then v_now else null end,
         cancelled_at=case when p_status='cancelled' then v_now else null end,
         needs_attention=case when p_status='waiting' then needs_attention else false end,
         attention_message=case when p_status='waiting' then attention_message else null end
   where id=p_subactivity_id;

  if p_status='waiting-aqs' then
    perform public.enqueue_aqs_review(p_subactivity_id,auth.uid());
  else
    perform public.add_project_log(v_project,'subactivity-status','Status da subatividade alterado',format('“%s”: %s → %s.',v_sub.title,v_sub.status::text,p_status),auth.uid());
  end if;
end;
$$;

revoke execute on function public.set_subactivity_status(uuid,text) from public,anon;
grant execute on function public.set_subactivity_status(uuid,text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.subactivity_checklist_items;
exception
  when duplicate_object then null;
end $$;

commit;
