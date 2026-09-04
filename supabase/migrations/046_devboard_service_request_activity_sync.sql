-- Devboard · Solicitações V33
-- Integração obrigatória Solicitação -> Atividade -> Subatividades -> AQS.
-- Ao encaminhar uma solicitação ao DEV, uma atividade é criada automaticamente.
-- O histórico técnico passa a ser espelhado no protocolo e a conclusão direta
-- de subatividades vinculadas é bloqueada: a aprovação deve ocorrer pelo AQS.

begin;

create index if not exists service_requests_activity_idx
  on public.service_requests(activity_id)
  where activity_id is not null;

create or replace function public.service_request_for_activity(p_activity_id uuid)
returns uuid
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select r.id
  from public.service_requests r
  where r.activity_id=p_activity_id
  order by r.created_at desc
  limit 1;
$$;

create or replace function public.service_request_for_subactivity(p_subactivity_id uuid)
returns uuid
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select public.service_request_for_activity(s.activity_id)
  from public.subactivities s
  where s.id=p_subactivity_id;
$$;

revoke execute on function public.service_request_for_activity(uuid) from public,anon;
revoke execute on function public.service_request_for_subactivity(uuid) from public,anon;
grant execute on function public.service_request_for_activity(uuid) to authenticated;
grant execute on function public.service_request_for_subactivity(uuid) to authenticated;

-- =============================================================================
-- Encaminhar ao DEV = criar/vincular atividade automaticamente
-- =============================================================================
create or replace function public.send_service_request_to_dev(
  p_request_id uuid,
  p_responsible_dev_id uuid,
  p_project_id uuid default null,
  p_activity_id uuid default null,
  p_aqs_summary text default null,
  p_priority_approved boolean default false
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text;
  v_req public.service_requests%rowtype;
  v_activity_id uuid;
  v_activity_title text;
  v_type_id uuid;
  v_project_name text;
  v_type_names text[];
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then
    raise exception 'Apenas AQS ou Administrador podem encaminhar ao DEV';
  end if;

  select * into v_req
  from public.service_requests
  where id=p_request_id
  for update;

  if not found then raise exception 'Solicitação não encontrada'; end if;
  if v_req.status<>'aqs-analysis' then raise exception 'Finalize a análise AQS antes de encaminhar'; end if;
  if p_project_id is null then raise exception 'Selecione o projeto que receberá a atividade técnica'; end if;

  if not exists(
    select 1
    from public.workspace_members wm
    where wm.workspace_id=v_req.workspace_id
      and wm.user_id=p_responsible_dev_id
      and wm.active
      and wm.role::text in ('developer','admin')
  ) then
    raise exception 'Responsável DEV inválido';
  end if;

  select p.name into v_project_name
  from public.projects p
  where p.id=p_project_id and p.workspace_id=v_req.workspace_id;
  if v_project_name is null then raise exception 'Projeto inválido'; end if;

  -- Compatibilidade com protocolos antigos já vinculados manualmente. Para novos
  -- encaminhamentos, o front-end não envia p_activity_id e a atividade nasce aqui.
  if p_activity_id is not null then
    if not exists(select 1 from public.activities a where a.id=p_activity_id and a.project_id=p_project_id) then
      raise exception 'Atividade não pertence ao projeto selecionado';
    end if;
    v_activity_id:=p_activity_id;
  elsif v_req.activity_id is not null then
    if not exists(select 1 from public.activities a where a.id=v_req.activity_id and a.project_id=p_project_id) then
      raise exception 'A atividade já vinculada não pertence ao projeto selecionado';
    end if;
    v_activity_id:=v_req.activity_id;
  else
    v_activity_title:=left(
      '[' || case
        when upper(btrim(v_req.order_number)) like 'OS %' then btrim(v_req.order_number)
        else 'OS ' || btrim(v_req.order_number)
      end || '] ' || coalesce(nullif(btrim(v_req.title),''),nullif(btrim(v_req.subject),''),'Solicitação'),
      240
    );

    v_type_names:=case v_req.request_type
      when 'failure' then array['Erro','Correção']
      when 'adjustment' then array['Ajuste']
      when 'development' then array['Desenvolvimento','Implementação']
      when 'improvement' then array['Implementação','Desenvolvimento']
      else array['Desenvolvimento']
    end;

    select wit.id into v_type_id
    from public.work_item_types wit
    where wit.workspace_id=v_req.workspace_id
      and wit.active
      and wit.name=any(v_type_names)
    order by array_position(v_type_names,wit.name)
    limit 1;

    -- O responsável precisa participar do projeto para conseguir criar e executar
    -- as subatividades dessa OS sem intervenção manual do administrador.
    insert into public.project_members(project_id,user_id,added_by)
    values(p_project_id,p_responsible_dev_id,auth.uid())
    on conflict(project_id,user_id) do nothing;

    insert into public.activities(project_id,title,created_by,type_id)
    values(p_project_id,v_activity_title,auth.uid(),v_type_id)
    returning id into v_activity_id;

    insert into public.activity_assignees(activity_id,user_id)
    values(v_activity_id,p_responsible_dev_id)
    on conflict(activity_id,user_id) do nothing;

    perform public.add_project_log(
      p_project_id,
      'activity-added',
      'Atividade criada a partir de solicitação',
      format('“%s” criada e vinculada ao protocolo OS %s.',v_activity_title,v_req.order_number),
      auth.uid()
    );
  end if;

  update public.service_requests
     set status='waiting-dev',
         responsible_dev_id=p_responsible_dev_id,
         project_id=p_project_id,
         activity_id=v_activity_id,
         aqs_summary=nullif(btrim(coalesce(p_aqs_summary,'')),''),
         priority_approved=coalesce(p_priority_approved,false)
   where id=p_request_id;

  insert into public.service_request_participants(request_id,user_id,source,added_by)
  values(p_request_id,p_responsible_dev_id,'dev',auth.uid())
  on conflict(request_id,user_id) do update set source='dev';

  perform public.service_request_add_event(
    p_request_id,
    'technical-activity-created',
    'Atividade técnica criada e encaminhada ao DEV',
    format(
      '%s · %s%s',
      v_project_name,
      (select a.title from public.activities a where a.id=v_activity_id),
      case when nullif(btrim(coalesce(p_aqs_summary,'')),'') is not null then E'\n\nAnálise AQS: '||btrim(p_aqs_summary) else '' end
    ),
    v_req.status,
    'waiting-dev'
  );

  perform public.service_request_notify(
    p_request_id,
    p_responsible_dev_id,
    'request-assigned',
    'Nova atividade vinculada à solicitação',
    format('OS %s · %s',v_req.order_number,(select a.title from public.activities a where a.id=v_activity_id))
  );
end;
$$;

-- O executor também passa a integrar o projeto e a atividade vinculada.
create or replace function public.assign_service_request_executor(p_request_id uuid,p_executor_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text;
  v_req public.service_requests%rowtype;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  select * into v_req from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;

  if v_role<>'admin' and not (v_role='developer' and (v_req.responsible_dev_id=auth.uid() or v_req.responsible_dev_id is null)) then
    raise exception 'Apenas o responsável DEV ou Administrador pode designar o executor';
  end if;
  if v_req.status not in ('waiting-dev','waiting-executor','rework') then
    raise exception 'Esta solicitação não está aguardando executor';
  end if;
  if not exists(
    select 1 from public.workspace_members wm
    where wm.workspace_id=v_req.workspace_id and wm.user_id=p_executor_id and wm.active
      and wm.role::text in ('developer','admin')
  ) then raise exception 'Executor inválido'; end if;

  update public.service_requests set status='waiting-executor',executor_id=p_executor_id where id=p_request_id;

  if v_req.project_id is not null then
    insert into public.project_members(project_id,user_id,added_by)
    values(v_req.project_id,p_executor_id,auth.uid())
    on conflict(project_id,user_id) do nothing;
  end if;
  if v_req.activity_id is not null then
    insert into public.activity_assignees(activity_id,user_id)
    values(v_req.activity_id,p_executor_id)
    on conflict(activity_id,user_id) do nothing;
  end if;

  insert into public.service_request_participants(request_id,user_id,source,added_by)
  values(p_request_id,p_executor_id,'executor',auth.uid())
  on conflict(request_id,user_id) do update set source='executor';

  perform public.service_request_add_event(p_request_id,'executor-assigned','Executor designado para a atividade técnica',null,v_req.status,'waiting-executor');
  perform public.service_request_notify(p_request_id,p_executor_id,'request-assigned','Solicitação atribuída para execução','Você foi incluído na atividade técnica vinculada a esta solicitação.');
end;
$$;

-- =============================================================================
-- Histórico técnico espelhado no protocolo
-- =============================================================================
create or replace function public.service_request_subactivity_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_request_id uuid;
  v_req public.service_requests%rowtype;
  v_open_count integer;
  v_waiting_aqs_count integer;
  v_pending_dev_count integer;
  v_done_count integer;
  v_actor_name text;
  v_description text;
begin
  v_request_id:=public.service_request_for_activity(new.activity_id);
  if v_request_id is null then return new; end if;

  select * into v_req from public.service_requests where id=v_request_id for update;
  if not found then return new; end if;

  if tg_op='INSERT' then
    select name into v_actor_name from public.profiles where id=new.assignee_id;
    perform public.service_request_add_event(
      v_request_id,
      'technical-subactivity-created',
      'Subatividade criada na OS',
      format('“%s”%s',new.title,case when v_actor_name is not null then ' · responsável: '||v_actor_name else '' end),
      null,
      null
    );

    -- Se o AQS já havia validado o conjunto e alguém acrescenta novo trabalho,
    -- o protocolo volta para reavaliação técnica automaticamente.
    if v_req.status in ('waiting-aqs','waiting-build') then
      update public.service_requests set status='rework' where id=v_request_id;
      perform public.service_request_add_event(
        v_request_id,'technical-scope-reopened','Escopo técnico reaberto',
        'Uma nova subatividade foi adicionada à atividade vinculada. O protocolo voltou para o DEV.',
        v_req.status,'rework'
      );
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then return new; end if;

  -- Reabrir uma etapa já aprovada reabre também o protocolo técnico (enquanto
  -- ele ainda não foi encerrado definitivamente).
  if old.status in ('done','cancelled') and new.status not in ('done','cancelled') and v_req.status<>'completed' then
    update public.service_requests set status='rework' where id=v_request_id and status not in ('rejected','cancelled');
    v_req.status:='rework';
    perform public.service_request_add_event(
      v_request_id,'technical-scope-reopened','Etapa técnica reaberta',
      format('“%s” foi reaberta e voltou ao fluxo DEV.',new.title),v_req.status,'rework'
    );
  end if;

  if new.status='in-progress' then
    v_description:=format('“%s” entrou em execução.',new.title);
    perform public.service_request_add_event(v_request_id,'technical-subactivity-started','Execução iniciada',v_description,old.status::text,new.status::text);
    if v_req.status in ('waiting-dev','waiting-executor','rework') then
      update public.service_requests set status='in-dev' where id=v_request_id;
      perform public.service_request_add_event(v_request_id,'technical-dev-started','Atendimento DEV em execução','O cronômetro da atividade vinculada foi iniciado.',v_req.status,'in-dev');
    end if;

  elsif new.status='paused' then
    perform public.service_request_add_event(
      v_request_id,'technical-subactivity-paused','Execução pausada',
      format('“%s” foi pausada · %s acumulados.',new.title,to_char(make_interval(secs=>greatest(new.tracked_seconds,0)),'HH24:MI:SS')),
      old.status::text,new.status::text
    );

  elsif new.status='waiting-aqs' then
    perform public.service_request_add_event(
      v_request_id,'technical-subactivity-waiting-aqs','Subatividade enviada para validação AQS',
      format('“%s” foi finalizada pelo DEV e entrou na fila AQS.',new.title),
      old.status::text,new.status::text
    );

    select
      count(*) filter (where s.status not in ('done','cancelled')),
      count(*) filter (where s.status='waiting-aqs'),
      count(*) filter (where s.status not in ('waiting-aqs','done','cancelled')),
      count(*) filter (where s.status='done')
    into v_open_count,v_waiting_aqs_count,v_pending_dev_count,v_done_count
    from public.subactivities s
    where s.activity_id=new.activity_id;

    if v_waiting_aqs_count>0 and v_pending_dev_count=0 and v_req.status not in ('completed','rejected','cancelled','waiting-build') then
      update public.service_requests set status='waiting-aqs' where id=v_request_id;
      if v_req.status<>'waiting-aqs' then
        perform public.service_request_add_event(
          v_request_id,'technical-activity-waiting-aqs','Atividade enviada para validação AQS',
          'Todas as subatividades abertas da OS foram entregues pelo DEV. A validação agora acontece na Análise AQS.',
          v_req.status,'waiting-aqs'
        );
      end if;
    end if;

  elsif new.status='done' then
    perform public.service_request_add_event(
      v_request_id,'technical-subactivity-approved','AQS aprovou a subatividade',
      format('“%s” foi concluída após validação AQS.',new.title),
      old.status::text,new.status::text
    );

    select
      count(*) filter (where s.status not in ('done','cancelled')),
      count(*) filter (where s.status='waiting-aqs'),
      count(*) filter (where s.status not in ('waiting-aqs','done','cancelled')),
      count(*) filter (where s.status='done')
    into v_open_count,v_waiting_aqs_count,v_pending_dev_count,v_done_count
    from public.subactivities s
    where s.activity_id=new.activity_id;

    if v_open_count=0 and v_done_count>0 and v_req.status not in ('completed','rejected','cancelled') then
      update public.service_requests set status='waiting-build' where id=v_request_id;
      if v_req.status<>'waiting-build' then
        perform public.service_request_add_event(
          v_request_id,'technical-activity-approved','Atividade aprovada pelo AQS',
          'Todas as subatividades da OS foram aprovadas pelo AQS. O protocolo aguarda somente a versão/build de disponibilização.',
          v_req.status,'waiting-build'
        );
        if v_req.created_by is not null then
          perform public.service_request_notify(
            v_request_id,v_req.created_by,'request-status','Execução aprovada pelo AQS',
            'A atividade técnica foi validada e agora aguarda a versão/build.'
          );
        end if;
      end if;
    end if;

  elsif new.status='waiting' and old.status='waiting-aqs' then
    update public.service_requests set status='rework' where id=v_request_id and status not in ('completed','rejected','cancelled');
    perform public.service_request_add_event(
      v_request_id,'technical-subactivity-revoked','AQS solicitou ajustes',
      format('“%s” voltou para o DEV%s.',new.title,case when nullif(btrim(coalesce(new.attention_message,'')),'') is not null then ' · '||new.attention_message else '' end),
      v_req.status,'rework'
    );

  else
    perform public.service_request_add_event(
      v_request_id,'technical-subactivity-status','Situação da subatividade alterada',
      format('“%s”: %s → %s.',new.title,old.status::text,new.status::text),
      old.status::text,new.status::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists service_request_subactivity_sync on public.subactivities;
create trigger service_request_subactivity_sync
after insert or update of status on public.subactivities
for each row execute function public.service_request_subactivity_sync_trigger();

-- Comentários do detalhe e do Acompanhamento usam a mesma tabela.
create or replace function public.service_request_subactivity_comment_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_request_id uuid;
  v_sub_id uuid;
  v_sub_title text;
  v_preview text;
  v_actor uuid;
begin
  if tg_op='DELETE' then
    v_sub_id:=old.subactivity_id;
    v_actor:=auth.uid();
  else
    v_sub_id:=new.subactivity_id;
    v_actor:=new.author_id;
  end if;

  v_request_id:=public.service_request_for_subactivity(v_sub_id);
  if v_request_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  select title into v_sub_title from public.subactivities where id=v_sub_id;

  if tg_op='DELETE' then
    perform public.service_request_add_event(
      v_request_id,'technical-comment-removed','Comentário removido da atividade',
      format('“%s” · uma mensagem foi removida do acompanhamento.',coalesce(v_sub_title,'Subatividade')),null,null,v_actor
    );
    return old;
  end if;

  v_preview:=left(regexp_replace(btrim(new.content),'\s+',' ','g'),220);
  perform public.service_request_add_event(
    v_request_id,'technical-comment','Comentário registrado na atividade',
    format('“%s” · %s',v_sub_title,v_preview),null,null,v_actor
  );
  return new;
end;
$$;

drop trigger if exists service_request_subactivity_comment_sync on public.subactivity_comments;
create trigger service_request_subactivity_comment_sync
after insert or delete on public.subactivity_comments
for each row execute function public.service_request_subactivity_comment_sync_trigger();

-- Anexos/evidências adicionados às subatividades também entram no histórico da OS.
create or replace function public.service_request_attachment_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_request_id uuid;
  v_sub_id uuid;
  v_sub_title text;
  v_name text;
  v_actor uuid;
begin
  if tg_op='DELETE' then
    v_sub_id:=old.subactivity_id;
    v_name:=old.name;
    v_actor:=auth.uid();
  else
    v_sub_id:=new.subactivity_id;
    v_name:=new.name;
    v_actor:=coalesce(new.status_changed_by,new.uploaded_by,auth.uid());
  end if;

  if v_sub_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  v_request_id:=public.service_request_for_subactivity(v_sub_id);
  if v_request_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  select title into v_sub_title from public.subactivities where id=v_sub_id;

  if tg_op='INSERT' then
    perform public.service_request_add_event(
      v_request_id,'technical-attachment','Evidência adicionada à atividade',
      format('“%s” · arquivo “%s”.',v_sub_title,v_name),null,null,v_actor
    );
  elsif tg_op='UPDATE' and old.active is distinct from new.active then
    perform public.service_request_add_event(
      v_request_id,'technical-attachment-status',
      case when new.active then 'Evidência reativada' else 'Evidência marcada como inativa' end,
      format('“%s” · arquivo “%s”.',v_sub_title,v_name),null,null,v_actor
    );
  elsif tg_op='DELETE' then
    perform public.service_request_add_event(
      v_request_id,'technical-attachment-removed','Evidência removida da atividade',
      format('“%s” · arquivo “%s”.',coalesce(v_sub_title,'Subatividade'),v_name),null,null,v_actor
    );
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists service_request_attachment_sync on public.attachments;
create trigger service_request_attachment_sync
after insert or update of active or delete on public.attachments
for each row execute function public.service_request_attachment_sync_trigger();

-- A entrada do AQS na revisão não muda o status da subatividade, então possui um
-- trigger próprio para aparecer no histórico do protocolo.
create or replace function public.service_request_aqs_review_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_request_id uuid; v_sub_title text;
begin
  if old.status is not distinct from new.status or new.status<>'evaluating' then return new; end if;
  v_request_id:=public.service_request_for_activity(new.activity_id);
  if v_request_id is null then return new; end if;
  select title into v_sub_title from public.subactivities where id=new.subactivity_id;
  perform public.service_request_add_event(
    v_request_id,'technical-aqs-started','AQS iniciou a validação',
    format('“%s” está em análise.',v_sub_title),old.status::text,new.status::text,new.assigned_aqs_id
  );
  return new;
end;
$$;

drop trigger if exists service_request_aqs_review_sync on public.aqs_reviews;
create trigger service_request_aqs_review_sync
after update of status on public.aqs_reviews
for each row execute function public.service_request_aqs_review_sync_trigger();

-- Renomear a atividade vinculada também fica auditado no protocolo.
create or replace function public.service_request_activity_title_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_request_id uuid;
begin
  if old.title is not distinct from new.title then return new; end if;
  v_request_id:=public.service_request_for_activity(new.id);
  if v_request_id is not null then
    perform public.service_request_add_event(
      v_request_id,'technical-activity-renamed','Atividade técnica renomeada',
      format('“%s” → “%s”.',old.title,new.title)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists service_request_activity_title_sync on public.activities;
create trigger service_request_activity_title_sync
after update of title on public.activities
for each row execute function public.service_request_activity_title_sync_trigger();

-- Uma atividade vinculada é parte do histórico da OS e não pode ser excluída.
create or replace function public.service_request_activity_delete_guard_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_request public.service_requests%rowtype;
begin
  select * into v_request
  from public.service_requests
  where activity_id=old.id
  order by created_at desc
  limit 1;
  if found then
    raise exception 'A atividade está vinculada à OS % e não pode ser excluída. O vínculo técnico faz parte do histórico do protocolo.',v_request.order_number;
  end if;
  return old;
end;
$$;

drop trigger if exists service_request_activity_delete_guard on public.activities;
create trigger service_request_activity_delete_guard
before delete on public.activities
for each row execute function public.service_request_activity_delete_guard_trigger();

-- =============================================================================
-- Conclusão protegida: somente complete_aqs_review pode marcar DONE.
-- =============================================================================
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

-- Criação também respeita o fluxo protegido: uma subatividade nova não pode
-- nascer como concluída/cancelada dentro de uma atividade vinculada à OS.
create or replace function public.add_subactivity(
  p_project_id uuid,p_activity_id uuid,p_title text,p_estimated_hours numeric,p_assignee_id uuid,p_status text default 'backlog'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid:=public.project_workspace_id(p_project_id);
  v_id uuid;
  v_activity_title text;
  v_project_name text;
  v_role text;
  v_request_id uuid;
  v_order_number text;
begin
  if public.activity_project_id(p_activity_id) is distinct from p_project_id then
    raise exception 'Atividade não pertence ao projeto';
  end if;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'Sem permissão para criar subatividades';
  end if;

  v_role:=public.workspace_role_of(v_workspace,auth.uid());
  if v_role<>'admin' and not exists(
    select 1 from public.project_members pm
     where pm.project_id=p_project_id and pm.user_id=auth.uid()
  ) then
    raise exception 'Você precisa estar integrado ao projeto para criar subatividades';
  end if;

  if length(btrim(coalesce(p_title,'')))=0 then
    raise exception 'Título da subatividade é obrigatório';
  end if;

  if public.workspace_role_of(v_workspace,p_assignee_id) not in ('admin','developer') then
    raise exception 'Subatividades de desenvolvimento só podem ser atribuídas a Administrador ou Desenvolvedor';
  end if;

  if p_status not in ('backlog','waiting','waiting-aqs','in-progress','paused','done','cancelled') then
    raise exception 'Status inválido';
  end if;

  v_request_id:=public.service_request_for_activity(p_activity_id);
  if v_request_id is not null and p_status in ('done','cancelled') then
    select order_number into v_order_number from public.service_requests where id=v_request_id;
    raise exception 'A atividade pertence à OS %. A nova subatividade não pode nascer concluída/cancelada; envie-a para Aguardando AQS ao finalizar.',v_order_number;
  end if;

  if p_status='in-progress' and p_assignee_id<>auth.uid() and v_role<>'admin' then
    raise exception 'Você só pode iniciar uma subatividade atribuída a você';
  end if;

  insert into public.subactivities(
    activity_id,title,status,estimated_hours,tracked_seconds,timer_started_at,
    assignee_id,created_by,completed_at,cancelled_at
  ) values(
    p_activity_id,btrim(p_title),'backlog',greatest(coalesce(p_estimated_hours,0),0),0,null,
    p_assignee_id,auth.uid(),null,null
  ) returning id into v_id;

  insert into public.subactivity_members(subactivity_id,user_id,added_by)
  values
    (v_id,p_assignee_id,auth.uid()),
    (v_id,auth.uid(),auth.uid())
  on conflict (subactivity_id,user_id) do nothing;

  select title into v_activity_title from public.activities where id=p_activity_id;
  select name into v_project_name from public.projects where id=p_project_id;

  perform public.add_project_log(
    p_project_id,'subactivity-added','Subatividade adicionada',
    format('“%s” adicionada em “%s”.',btrim(p_title),v_activity_title),auth.uid()
  );

  perform public.push_notification(
    p_assignee_id,auth.uid(),'subactivity-assigned','Você recebeu uma nova subatividade',
    format('“%s” · %s · %s',btrim(p_title),v_activity_title,v_project_name),
    p_project_id,p_activity_id,v_id
  );

  if p_status<>'backlog' then
    perform public.set_subactivity_status(v_id,p_status);
  end if;

  return v_id;
end;
$$;

-- Para protocolos vinculados, os botões antigos do fluxo de Solicitações deixam
-- de ser uma rota alternativa. O ciclo é comandado pela atividade/subatividades.
create or replace function public.start_service_request_dev(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_req public.service_requests%rowtype;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  select * into v_req from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if v_req.activity_id is not null then
    raise exception 'Esta solicitação possui atividade vinculada. Inicie a execução pela subatividade no projeto; o protocolo será atualizado automaticamente.';
  end if;
  if v_role<>'admin' and not (v_role='developer' and auth.uid() in (v_req.executor_id,v_req.responsible_dev_id)) then raise exception 'Apenas o executor ou responsável DEV pode iniciar'; end if;
  if v_req.status not in ('waiting-dev','waiting-executor','rework') then raise exception 'Esta solicitação não pode ser iniciada agora'; end if;
  update public.service_requests set status='in-dev' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'dev-started','Execução DEV iniciada','O desenvolvimento iniciou o atendimento da solicitação.',v_req.status,'in-dev');
end;
$$;

create or replace function public.send_service_request_to_aqs(p_request_id uuid,p_summary text)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_req public.service_requests%rowtype; v_rec record;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  select * into v_req from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if v_req.activity_id is not null then
    raise exception 'Esta solicitação possui atividade vinculada. Envie as subatividades para Aguardando AQS; o protocolo mudará automaticamente quando todo o trabalho estiver entregue.';
  end if;
  if v_role<>'admin' and not (v_role='developer' and auth.uid() in (v_req.executor_id,v_req.responsible_dev_id)) then raise exception 'Apenas o executor ou responsável DEV pode devolver ao AQS'; end if;
  if v_req.status not in ('in-dev','rework','waiting-executor') then raise exception 'Esta solicitação não está em execução DEV'; end if;
  if length(btrim(coalesce(p_summary,'')))<5 then raise exception 'Informe um resumo da execução'; end if;
  update public.service_requests set status='waiting-aqs',dev_summary=btrim(p_summary) where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'waiting-aqs','Desenvolvimento enviado para validação AQS',p_summary,v_req.status,'waiting-aqs');
  if v_req.assigned_aqs_id is not null then perform public.service_request_notify(p_request_id,v_req.assigned_aqs_id,'request-assigned','Solicitação aguardando validação AQS',left(p_summary,180)); end if;
  for v_rec in select wm.user_id from public.workspace_members wm where wm.workspace_id=v_req.workspace_id and wm.active and wm.role::text='admin' loop
    perform public.service_request_notify(p_request_id,v_rec.user_id,'request-status','Solicitação aguardando AQS',left(p_summary,180));
  end loop;
end;
$$;

create or replace function public.return_service_request_to_dev(p_request_id uuid,p_reason text)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_req public.service_requests%rowtype; v_target uuid;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem solicitar reavaliação'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo da reavaliação'; end if;
  select * into v_req from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if v_req.activity_id is not null then
    raise exception 'Esta solicitação possui atividade vinculada. Revogue a subatividade na tela Análise AQS; ela voltará ao DEV e o protocolo será sincronizado automaticamente.';
  end if;
  if v_req.status<>'waiting-aqs' then raise exception 'A solicitação precisa estar aguardando AQS'; end if;
  v_target:=coalesce(v_req.executor_id,v_req.responsible_dev_id);
  update public.service_requests set status='rework' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'rework','AQS solicitou reavaliação do DEV',p_reason,v_req.status,'rework');
  if v_target is not null then perform public.service_request_notify(p_request_id,v_target,'request-status','Solicitação devolvida para reavaliação',p_reason); end if;
end;
$$;

create or replace function public.approve_service_request_for_build(p_request_id uuid,p_note text default null)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text; v_req public.service_requests%rowtype;
begin
  v_role:=public.service_request_actor_role(p_request_id);
  if v_role not in ('admin','aqs') then raise exception 'Apenas AQS ou Administrador podem aprovar'; end if;
  select * into v_req from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if v_req.activity_id is not null then
    raise exception 'Esta solicitação possui atividade vinculada. A aprovação ocorre pelas subatividades na tela Análise AQS e o protocolo irá para Aguardando versão automaticamente.';
  end if;
  if v_req.status<>'waiting-aqs' then raise exception 'A solicitação precisa estar aguardando AQS'; end if;
  update public.service_requests set status='waiting-build' where id=p_request_id;
  perform public.service_request_add_event(p_request_id,'waiting-build','AQS aprovou a execução','A solução foi aprovada e aguarda disponibilização em versão/build. '||coalesce(p_note,''),v_req.status,'waiting-build');
  perform public.service_request_notify(p_request_id,v_req.created_by,'request-status','Solicitação aprovada pelo AQS','A solução aguarda disponibilização em uma build.');
end;
$$;

-- Funções continuam expostas com as mesmas assinaturas para não quebrar clientes.
revoke execute on function public.send_service_request_to_dev(uuid,uuid,uuid,uuid,text,boolean) from public,anon;
revoke execute on function public.assign_service_request_executor(uuid,uuid) from public,anon;
revoke execute on function public.start_service_request_dev(uuid) from public,anon;
revoke execute on function public.send_service_request_to_aqs(uuid,text) from public,anon;
revoke execute on function public.return_service_request_to_dev(uuid,text) from public,anon;
revoke execute on function public.approve_service_request_for_build(uuid,text) from public,anon;
revoke execute on function public.set_subactivity_status(uuid,text) from public,anon;
revoke execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) from public,anon;

grant execute on function public.send_service_request_to_dev(uuid,uuid,uuid,uuid,text,boolean) to authenticated;
grant execute on function public.assign_service_request_executor(uuid,uuid) to authenticated;
grant execute on function public.start_service_request_dev(uuid) to authenticated;
grant execute on function public.send_service_request_to_aqs(uuid,text) to authenticated;
grant execute on function public.return_service_request_to_dev(uuid,text) to authenticated;
grant execute on function public.approve_service_request_for_build(uuid,text) to authenticated;
grant execute on function public.set_subactivity_status(uuid,text) to authenticated;
grant execute on function public.add_subactivity(uuid,uuid,text,numeric,uuid,text) to authenticated;

commit;
