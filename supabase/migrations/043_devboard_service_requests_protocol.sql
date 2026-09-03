-- Devboard · Solicitações / Protocolo AQS → DEV
-- Mantém Projetos, Atividades e Subatividades intactos. Solicitações apenas se vinculam
-- opcionalmente a projeto/atividade existentes quando chegam ao DEV.

begin;

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_number text not null,
  request_type text not null check (request_type in ('failure','development','adjustment','improvement','structured-triage')),
  unit text not null,
  module text not null,
  subject text not null,
  title text not null,
  description text not null,
  status text not null default 'received' check (status in (
    'received','aqs-analysis','waiting-info','waiting-dev','waiting-executor','in-dev',
    'waiting-aqs','rework','waiting-build','completed','rejected','cancelled'
  )),
  priority_requested boolean not null default false,
  priority_reason text,
  priority_approved boolean not null default false,
  created_by uuid not null references public.profiles(id),
  assigned_aqs_id uuid references public.profiles(id) on delete set null,
  responsible_dev_id uuid references public.profiles(id) on delete set null,
  executor_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  aqs_summary text,
  dev_summary text,
  final_build text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_requests_priority_reason check (not priority_requested or length(btrim(coalesce(priority_reason,''))) >= 5)
);
create unique index if not exists service_requests_workspace_order_uidx on public.service_requests(workspace_id, lower(btrim(order_number)));
create index if not exists service_requests_workspace_status_idx on public.service_requests(workspace_id,status,updated_at desc);
create index if not exists service_requests_creator_idx on public.service_requests(created_by,created_at desc);
create index if not exists service_requests_aqs_idx on public.service_requests(assigned_aqs_id,status,updated_at desc);
create index if not exists service_requests_dev_idx on public.service_requests(responsible_dev_id,executor_id,status,updated_at desc);
drop trigger if exists service_requests_set_updated_at on public.service_requests;
create trigger service_requests_set_updated_at before update on public.service_requests for each row execute procedure public.set_updated_at();

create table if not exists public.service_request_participants (
  request_id uuid not null references public.service_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'manual' check (source in ('creator','aqs','dev','executor','mention','manual')),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(request_id,user_id)
);
create index if not exists service_request_participants_user_idx on public.service_request_participants(user_id,request_id);

create table if not exists public.service_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null default '',
  mentions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint service_request_messages_mentions_array check (jsonb_typeof(mentions)='array')
);
create index if not exists service_request_messages_request_idx on public.service_request_messages(request_id,created_at);

create table if not exists public.service_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  description text,
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);
create index if not exists service_request_events_request_idx on public.service_request_events(request_id,created_at);

create table if not exists public.service_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  message_id uuid references public.service_request_messages(id) on delete cascade,
  category text not null default 'other' check (category in ('order-pdf','analysis-video','database','certificate','other')),
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 209715200),
  kind public.attachment_kind not null default 'other',
  storage_path text not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists service_request_attachments_request_idx on public.service_request_attachments(request_id,created_at);
create index if not exists service_request_attachments_message_idx on public.service_request_attachments(message_id,created_at);
create unique index if not exists service_request_attachments_path_uidx on public.service_request_attachments(storage_path);

alter table public.notifications add column if not exists request_id uuid references public.service_requests(id) on delete cascade;
create index if not exists notifications_request_idx on public.notifications(request_id,recipient_id,created_at desc);

create or replace function public.can_view_service_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.service_requests r
    join public.workspace_members me on me.workspace_id=r.workspace_id and me.user_id=auth.uid() and me.active
    where r.id=p_request_id
      and (
        me.role::text in ('admin','aqs')
        or r.created_by=auth.uid()
        or r.responsible_dev_id=auth.uid()
        or r.executor_id=auth.uid()
        or exists(select 1 from public.service_request_participants rp where rp.request_id=r.id and rp.user_id=auth.uid())
        or (me.role::text='developer' and r.status in ('waiting-dev','waiting-executor','in-dev','waiting-aqs','rework','waiting-build','completed'))
      )
  );
$$;

create or replace function public.service_request_workspace_id(p_request_id uuid)
returns uuid
language sql
stable
security definer
set search_path=public,pg_temp
as $$ select workspace_id from public.service_requests where id=p_request_id; $$;

create or replace function public.service_request_actor_role(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select wm.role::text
  from public.service_requests r
  join public.workspace_members wm on wm.workspace_id=r.workspace_id and wm.user_id=auth.uid() and wm.active
  where r.id=p_request_id
  limit 1;
$$;

create or replace function public.service_request_add_event(
  p_request_id uuid,
  p_event_type text,
  p_title text,
  p_description text default null,
  p_from_status text default null,
  p_to_status text default null,
  p_actor_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid;
begin
  insert into public.service_request_events(request_id,actor_id,event_type,title,description,from_status,to_status)
  values(p_request_id,p_actor_id,p_event_type,btrim(p_title),nullif(btrim(coalesce(p_description,'')),''),p_from_status,p_to_status)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.service_request_notify(
  p_request_id uuid,
  p_recipient_id uuid,
  p_type text,
  p_title text,
  p_description text default null,
  p_actor_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_workspace uuid;
begin
  if p_recipient_id is null or p_recipient_id=p_actor_id then return; end if;
  select workspace_id into v_workspace from public.service_requests where id=p_request_id;
  if v_workspace is null then return; end if;
  insert into public.notifications(workspace_id,recipient_id,actor_id,type,title,description,request_id)
  values(v_workspace,p_recipient_id,p_actor_id,p_type,p_title,p_description,p_request_id);
end;
$$;

create or replace function public.create_service_request(
  p_order_number text,
  p_request_type text,
  p_unit text,
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
declare v_workspace uuid; v_id uuid; v_rec record;
begin
  v_workspace:=public.current_workspace_id();
  if v_workspace is null then raise exception 'Workspace não encontrado'; end if;
  if p_request_type not in ('failure','development','adjustment','improvement','structured-triage') then raise exception 'Tipo de solicitação inválido'; end if;
  if length(btrim(coalesce(p_order_number,'')))<2 then raise exception 'Informe o número da ordem'; end if;
  if length(btrim(coalesce(p_unit,'')))<2 then raise exception 'Informe a unidade'; end if;
  if length(btrim(coalesce(p_module,'')))<2 then raise exception 'Informe o módulo'; end if;
  if length(btrim(coalesce(p_subject,'')))<2 then raise exception 'Informe o assunto'; end if;
  if length(btrim(coalesce(p_title,'')))<3 then raise exception 'Informe um título'; end if;
  if length(btrim(coalesce(p_description,'')))<10 then raise exception 'Detalhe melhor a solicitação'; end if;
  if coalesce(p_priority_requested,false) and length(btrim(coalesce(p_priority_reason,'')))<5 then raise exception 'Justifique a prioridade solicitada'; end if;

  insert into public.service_requests(workspace_id,order_number,request_type,unit,module,subject,title,description,priority_requested,priority_reason,created_by)
  values(v_workspace,btrim(p_order_number),p_request_type,btrim(p_unit),btrim(p_module),btrim(p_subject),btrim(p_title),btrim(p_description),coalesce(p_priority_requested,false),nullif(btrim(coalesce(p_priority_reason,'')),''),auth.uid())
  returning id into v_id;

  insert into public.service_request_participants(request_id,user_id,source,added_by)
  values(v_id,auth.uid(),'creator',auth.uid()) on conflict(request_id,user_id) do nothing;
  perform public.service_request_add_event(v_id,'created','Solicitação protocolada','A solicitação foi recebida e entrou na caixa de entrada AQS.',null,'received');

  for v_rec in
    select wm.user_id from public.workspace_members wm
    where wm.workspace_id=v_workspace and wm.active and wm.role::text in ('admin','aqs') and wm.user_id<>auth.uid()
  loop
    perform public.service_request_notify(v_id,v_rec.user_id,'request-created','Nova solicitação recebida',btrim(p_order_number)||' · '||btrim(p_title));
  end loop;
  return v_id;
end;
$$;

create or replace function public.add_service_request_attachment(
  p_request_id uuid,
  p_message_id uuid default null,
  p_category text default 'other',
  p_name text default 'arquivo',
  p_mime_type text default 'application/octet-stream',
  p_size_bytes bigint default 0,
  p_kind public.attachment_kind default 'other',
  p_storage_path text default ''
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid; v_workspace uuid;
begin
  if not public.can_view_service_request(p_request_id) then raise exception 'Sem acesso a esta solicitação'; end if;
  if p_category not in ('order-pdf','analysis-video','database','certificate','other') then raise exception 'Categoria de arquivo inválida'; end if;
  if p_size_bytes<=0 or p_size_bytes>209715200 then raise exception 'Arquivo fora do limite permitido'; end if;
  if p_message_id is not null and not exists(select 1 from public.service_request_messages m where m.id=p_message_id and m.request_id=p_request_id) then raise exception 'Mensagem inválida'; end if;
  select workspace_id into v_workspace from public.service_requests where id=p_request_id;
  if split_part(p_storage_path,'/',1)<>v_workspace::text or split_part(p_storage_path,'/',2)<>p_request_id::text or split_part(p_storage_path,'/',3)<>auth.uid()::text then raise exception 'Caminho de armazenamento inválido'; end if;
  insert into public.service_request_attachments(request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,uploaded_by)
  values(p_request_id,p_message_id,p_category,btrim(p_name),coalesce(nullif(p_mime_type,''),'application/octet-stream'),p_size_bytes,p_kind,p_storage_path,auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_service_request_message(
  p_request_id uuid,
  p_content text default '',
  p_mentions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid; v_workspace uuid; v_item jsonb; v_user uuid; v_label text;
begin
  if not public.can_view_service_request(p_request_id) then raise exception 'Sem acesso a esta solicitação'; end if;
  if jsonb_typeof(coalesce(p_mentions,'[]'::jsonb))<>'array' then raise exception 'Menções inválidas'; end if;
  if length(btrim(coalesce(p_content,'')))>8000 then raise exception 'Mensagem muito longa'; end if;
  select workspace_id into v_workspace from public.service_requests where id=p_request_id;
  insert into public.service_request_messages(request_id,author_id,content,mentions)
  values(p_request_id,auth.uid(),coalesce(p_content,''),coalesce(p_mentions,'[]'::jsonb)) returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_mentions,'[]'::jsonb)) loop
    if coalesce(v_item->>'kind','')<>'user' then continue; end if;
    begin v_user:=(v_item->>'id')::uuid; exception when others then continue; end;
    if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=v_user and wm.active) then continue; end if;
    insert into public.service_request_participants(request_id,user_id,source,added_by)
    values(p_request_id,v_user,'mention',auth.uid()) on conflict(request_id,user_id) do nothing;
    v_label:=coalesce(nullif(v_item->>'label',''),'Usuário');
    perform public.service_request_notify(p_request_id,v_user,'request-mention','Você foi mencionado em uma solicitação',coalesce(nullif(left(btrim(p_content),180),''),'Novo anexo ou mensagem no protocolo.'));
  end loop;
  return v_id;
end;
$$;

create or replace function public.start_service_request_aqs(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_creator uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem assumir a análise'; end if;
  select status,created_by into v_old,v_creator from public.service_requests where id=p_request_id for update;
  if v_old not in ('received','waiting-info') then raise exception 'Esta solicitação não está disponível para análise'; end if;
  update public.service_requests set status='aqs-analysis',assigned_aqs_id=auth.uid() where id=p_request_id;
  insert into public.service_request_participants(request_id,user_id,source,added_by) values(p_request_id,auth.uid(),'aqs',auth.uid()) on conflict(request_id,user_id) do update set source='aqs';
  perform public.service_request_add_event(p_request_id,'aqs-analysis','Análise AQS iniciada','O protocolo foi assumido pelo AQS.',v_old,'aqs-analysis');
  perform public.service_request_notify(p_request_id,v_creator,'request-status','Sua solicitação está em análise','O AQS iniciou a análise do protocolo.');
end; $$;

create or replace function public.request_service_request_info(p_request_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_creator uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem solicitar informações'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Informe o que precisa ser complementado'; end if;
  select status,created_by into v_old,v_creator from public.service_requests where id=p_request_id for update;
  if v_old<>'aqs-analysis' then raise exception 'A solicitação precisa estar em análise AQS'; end if;
  update public.service_requests set status='waiting-info' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'waiting-info','Informações adicionais solicitadas',p_reason,v_old,'waiting-info');
  perform public.service_request_notify(p_request_id,v_creator,'request-status','AQS solicitou mais informações',p_reason);
end; $$;

create or replace function public.reject_service_request(p_request_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_creator uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem recusar'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo da recusa'; end if;
  select status,created_by into v_old,v_creator from public.service_requests where id=p_request_id for update;
  if v_old in ('completed','rejected','cancelled') then raise exception 'Solicitação já encerrada'; end if;
  update public.service_requests set status='rejected',closed_at=now() where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'rejected','Solicitação recusada',p_reason,v_old,'rejected');
  perform public.service_request_notify(p_request_id,v_creator,'request-status','Solicitação recusada',p_reason);
end; $$;

create or replace function public.send_service_request_to_dev(
  p_request_id uuid,
  p_responsible_dev_id uuid,
  p_project_id uuid default null,
  p_activity_id uuid default null,
  p_aqs_summary text default null,
  p_priority_approved boolean default false
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_workspace uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem encaminhar ao DEV'; end if;
  select status,workspace_id into v_old,v_workspace from public.service_requests where id=p_request_id for update;
  if v_old<>'aqs-analysis' then raise exception 'Finalize a análise AQS antes de encaminhar'; end if;
  if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=p_responsible_dev_id and wm.active and wm.role::text in ('developer','admin')) then raise exception 'Responsável DEV inválido'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=v_workspace) then raise exception 'Projeto inválido'; end if;
  if p_activity_id is not null and not exists(select 1 from public.activities a where a.id=p_activity_id and a.project_id=p_project_id) then raise exception 'Atividade não pertence ao projeto selecionado'; end if;
  update public.service_requests
  set status='waiting-dev',responsible_dev_id=p_responsible_dev_id,project_id=p_project_id,activity_id=p_activity_id,
      aqs_summary=nullif(btrim(coalesce(p_aqs_summary,'')),''),priority_approved=coalesce(p_priority_approved,false)
  where id=p_request_id;
  insert into public.service_request_participants(request_id,user_id,source,added_by) values(p_request_id,p_responsible_dev_id,'dev',auth.uid()) on conflict(request_id,user_id) do update set source='dev';
  perform public.service_request_add_event(p_request_id,'sent-dev','Solicitação encaminhada ao DEV',p_aqs_summary,v_old,'waiting-dev');
  perform public.service_request_notify(p_request_id,p_responsible_dev_id,'request-assigned','Nova solicitação para o DEV','O AQS encaminhou uma solicitação para sua fila.');
end; $$;

create or replace function public.assign_service_request_executor(p_request_id uuid,p_executor_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_workspace uuid; v_responsible uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  select status,workspace_id,responsible_dev_id into v_old,v_workspace,v_responsible from public.service_requests where id=p_request_id for update;
  if v_role<>'admin' and not (v_role='developer' and (v_responsible=auth.uid() or v_responsible is null)) then raise exception 'Apenas o responsável DEV ou Administrador pode designar o executor'; end if;
  if v_old not in ('waiting-dev','waiting-executor','rework') then raise exception 'Esta solicitação não está aguardando executor'; end if;
  if not exists(select 1 from public.workspace_members wm where wm.workspace_id=v_workspace and wm.user_id=p_executor_id and wm.active and wm.role::text in ('developer','admin')) then raise exception 'Executor inválido'; end if;
  update public.service_requests set status='waiting-executor',executor_id=p_executor_id where id=p_request_id;
  insert into public.service_request_participants(request_id,user_id,source,added_by) values(p_request_id,p_executor_id,'executor',auth.uid()) on conflict(request_id,user_id) do update set source='executor';
  perform public.service_request_add_event(p_request_id,'executor-assigned','Executor designado',null,v_old,'waiting-executor');
  perform public.service_request_notify(p_request_id,p_executor_id,'request-assigned','Solicitação atribuída para execução','Você foi designado como executor desta solicitação.');
end; $$;

create or replace function public.start_service_request_dev(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_executor uuid; v_responsible uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  select status,executor_id,responsible_dev_id into v_old,v_executor,v_responsible from public.service_requests where id=p_request_id for update;
  if v_role<>'admin' and not (v_role='developer' and auth.uid() in (v_executor,v_responsible)) then raise exception 'Apenas o executor ou responsável DEV pode iniciar'; end if;
  if v_old not in ('waiting-dev','waiting-executor','rework') then raise exception 'Esta solicitação não pode ser iniciada agora'; end if;
  update public.service_requests set status='in-dev' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'dev-started','Execução DEV iniciada','O desenvolvimento iniciou o atendimento da solicitação.',v_old,'in-dev');
end; $$;

create or replace function public.send_service_request_to_aqs(p_request_id uuid,p_summary text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_executor uuid; v_responsible uuid; v_aqs uuid; v_rec record; v_workspace uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  select status,executor_id,responsible_dev_id,assigned_aqs_id,workspace_id into v_old,v_executor,v_responsible,v_aqs,v_workspace from public.service_requests where id=p_request_id for update;
  if v_role<>'admin' and not (v_role='developer' and auth.uid() in (v_executor,v_responsible)) then raise exception 'Apenas o executor ou responsável DEV pode devolver ao AQS'; end if;
  if v_old not in ('in-dev','rework','waiting-executor') then raise exception 'Esta solicitação não está em execução DEV'; end if;
  if length(btrim(coalesce(p_summary,'')))<5 then raise exception 'Informe um resumo da execução'; end if;
  update public.service_requests set status='waiting-aqs',dev_summary=btrim(p_summary) where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'waiting-aqs','Desenvolvimento enviado para validação AQS',p_summary,v_old,'waiting-aqs');
  if v_aqs is not null then perform public.service_request_notify(p_request_id,v_aqs,'request-assigned','Solicitação aguardando validação AQS',left(p_summary,180)); end if;
  for v_rec in select wm.user_id from public.workspace_members wm where wm.workspace_id=v_workspace and wm.active and wm.role::text='admin' loop
    perform public.service_request_notify(p_request_id,v_rec.user_id,'request-status','Solicitação aguardando AQS',left(p_summary,180));
  end loop;
end; $$;

create or replace function public.return_service_request_to_dev(p_request_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_target uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem solicitar reavaliação'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo da reavaliação'; end if;
  select status,coalesce(executor_id,responsible_dev_id) into v_old,v_target from public.service_requests where id=p_request_id for update;
  if v_old<>'waiting-aqs' then raise exception 'A solicitação precisa estar aguardando AQS'; end if;
  update public.service_requests set status='rework' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'rework','AQS solicitou reavaliação do DEV',p_reason,v_old,'rework');
  if v_target is not null then perform public.service_request_notify(p_request_id,v_target,'request-status','Solicitação devolvida para reavaliação',p_reason); end if;
end; $$;

create or replace function public.approve_service_request_for_build(p_request_id uuid,p_note text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_creator uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem aprovar'; end if;
  select status,created_by into v_old,v_creator from public.service_requests where id=p_request_id for update;
  if v_old<>'waiting-aqs' then raise exception 'A solicitação precisa estar aguardando AQS'; end if;
  update public.service_requests set status='waiting-build' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'waiting-build','AQS aprovou a execução','A solução foi aprovada e aguarda disponibilização em versão/build. '||coalesce(p_note,''),v_old,'waiting-build');
  perform public.service_request_notify(p_request_id,v_creator,'request-status','Solicitação aprovada pelo AQS','A solução aguarda disponibilização em uma build.');
end; $$;

create or replace function public.complete_service_request(p_request_id uuid,p_build text,p_note text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old text; v_creator uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem concluir'; end if;
  if length(btrim(coalesce(p_build,'')))<2 then raise exception 'Informe a build/versão disponibilizada'; end if;
  select status,created_by into v_old,v_creator from public.service_requests where id=p_request_id for update;
  if v_old<>'waiting-build' then raise exception 'A solicitação precisa estar aguardando versão'; end if;
  update public.service_requests set status='completed',final_build=btrim(p_build),closed_at=now() where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'completed','Solicitação concluída','Disponível a partir da build '||btrim(p_build)||case when nullif(btrim(coalesce(p_note,'')),'') is not null then '. '||btrim(p_note) else '' end,v_old,'completed');
  perform public.service_request_notify(p_request_id,v_creator,'request-status','Solicitação concluída','Disponível a partir da build '||btrim(p_build)||'.');
end; $$;

-- RLS: leitura é derivada do papel/participação. Escritas operacionais passam somente pelas RPCs acima.
alter table public.service_requests enable row level security;
alter table public.service_request_participants enable row level security;
alter table public.service_request_messages enable row level security;
alter table public.service_request_events enable row level security;
alter table public.service_request_attachments enable row level security;

drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select to authenticated using (public.can_view_service_request(id));
drop policy if exists service_request_participants_select on public.service_request_participants;
create policy service_request_participants_select on public.service_request_participants for select to authenticated using (public.can_view_service_request(request_id));
drop policy if exists service_request_messages_select on public.service_request_messages;
create policy service_request_messages_select on public.service_request_messages for select to authenticated using (public.can_view_service_request(request_id));
drop policy if exists service_request_events_select on public.service_request_events;
create policy service_request_events_select on public.service_request_events for select to authenticated using (public.can_view_service_request(request_id));
drop policy if exists service_request_attachments_select on public.service_request_attachments;
create policy service_request_attachments_select on public.service_request_attachments for select to authenticated using (public.can_view_service_request(request_id));

-- Storage privado das solicitações.
insert into storage.buckets(id,name,public,file_size_limit)
values('devboard-request-media','devboard-request-media',false,209715200)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;

create or replace function public.service_request_storage_request_id(p_name text)
returns uuid language plpgsql immutable security definer set search_path=public,pg_temp as $$
begin return nullif(split_part(p_name,'/',2),'')::uuid; exception when others then return null; end; $$;
create or replace function public.service_request_storage_write_allowed(p_name text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.service_requests r
    where r.id=public.service_request_storage_request_id(p_name)
      and r.workspace_id::text=split_part(p_name,'/',1)
      and auth.uid()::text=split_part(p_name,'/',3)
      and public.can_view_service_request(r.id)
  );
$$;

drop policy if exists service_request_media_select on storage.objects;
create policy service_request_media_select on storage.objects for select to authenticated
using(bucket_id='devboard-request-media' and public.can_view_service_request(public.service_request_storage_request_id(name)));
drop policy if exists service_request_media_insert on storage.objects;
create policy service_request_media_insert on storage.objects for insert to authenticated
with check(bucket_id='devboard-request-media' and public.service_request_storage_write_allowed(name));
drop policy if exists service_request_media_delete on storage.objects;
create policy service_request_media_delete on storage.objects for delete to authenticated
using(bucket_id='devboard-request-media' and public.service_request_storage_write_allowed(name));

-- Realtime para filas/timeline.
do $$ begin alter publication supabase_realtime add table public.service_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.service_request_participants; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.service_request_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.service_request_events; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.service_request_attachments; exception when duplicate_object then null; end $$;

revoke all on function public.service_request_add_event(uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.service_request_notify(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.can_view_service_request(uuid), public.service_request_actor_role(uuid), public.service_request_workspace_id(uuid) from public,anon;
grant execute on function public.can_view_service_request(uuid), public.service_request_actor_role(uuid), public.service_request_workspace_id(uuid) to authenticated;
grant execute on function public.service_request_storage_request_id(text), public.service_request_storage_write_allowed(text) to authenticated;
grant execute on function public.create_service_request(text,text,text,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.add_service_request_attachment(uuid,uuid,text,text,text,bigint,public.attachment_kind,text) to authenticated;
grant execute on function public.add_service_request_message(uuid,text,jsonb) to authenticated;
grant execute on function public.start_service_request_aqs(uuid), public.request_service_request_info(uuid,text), public.reject_service_request(uuid,text), public.send_service_request_to_dev(uuid,uuid,uuid,uuid,text,boolean), public.assign_service_request_executor(uuid,uuid), public.start_service_request_dev(uuid), public.send_service_request_to_aqs(uuid,text), public.return_service_request_to_dev(uuid,text), public.approve_service_request_for_build(uuid,text), public.complete_service_request(uuid,text,text) to authenticated;

grant select on public.service_requests,public.service_request_participants,public.service_request_messages,public.service_request_events,public.service_request_attachments to authenticated;

commit;
