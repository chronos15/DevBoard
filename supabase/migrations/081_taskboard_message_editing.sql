-- TaskBoard V99 · Edição de mensagens pelo próprio autor
-- Execute depois da migration 080.
--
-- Regra central: nem Administrador pode editar texto de outro usuário.
-- A autoria é validada novamente no banco, independentemente da UI.

begin;

alter table public.subactivity_comments
  add column if not exists edited_at timestamptz;

alter table public.service_request_messages
  add column if not exists edited_at timestamptz;

alter table public.chat_messages
  add column if not exists edited_at timestamptz;

create or replace function public.edit_subactivity_comment(
  p_comment_id uuid,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment public.subactivity_comments%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_content text := btrim(coalesce(p_content,''));
  v_mentions jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if length(v_content)=0 then raise exception 'A mensagem não pode ficar vazia'; end if;
  if length(v_content)>8000 then raise exception 'Mensagem muito longa'; end if;

  select * into v_comment
    from public.subactivity_comments
   where id=p_comment_id
   for update;
  if not found then raise exception 'Mensagem não encontrada'; end if;

  if v_comment.author_id<>auth.uid() then
    raise exception 'Você só pode editar mensagens enviadas por você';
  end if;

  v_project:=public.subactivity_project_id(v_comment.subactivity_id);
  v_workspace:=public.project_workspace_id(v_project);
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'Sem acesso ao projeto';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_mentions
    from jsonb_array_elements(coalesce(v_comment.mentions,'[]'::jsonb)) value
   where position(lower('@'||coalesce(value->>'label','')) in lower(v_content))>0;

  update public.subactivity_comments
     set content=v_content,
         mentions=coalesce(v_mentions,'[]'::jsonb),
         edited_at=now()
   where id=p_comment_id;

  return true;
end;
$$;

create or replace function public.edit_service_request_message(
  p_message_id uuid,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.service_request_messages%rowtype;
  v_content text := btrim(coalesce(p_content,''));
  v_mentions jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if length(v_content)=0 then raise exception 'A mensagem não pode ficar vazia'; end if;
  if length(v_content)>8000 then raise exception 'Mensagem muito longa'; end if;

  select * into v_message
    from public.service_request_messages
   where id=p_message_id
   for update;
  if not found then raise exception 'Mensagem não encontrada'; end if;

  if v_message.author_id<>auth.uid() then
    raise exception 'Você só pode editar mensagens enviadas por você';
  end if;
  if not public.can_view_service_request(v_message.request_id) then
    raise exception 'Sem acesso a esta solicitação';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_mentions
    from jsonb_array_elements(coalesce(v_message.mentions,'[]'::jsonb)) value
   where position(lower('@'||coalesce(value->>'label','')) in lower(v_content))>0;

  update public.service_request_messages
     set content=v_content,
         mentions=coalesce(v_mentions,'[]'::jsonb),
         edited_at=now()
   where id=p_message_id;

  return true;
end;
$$;

create or replace function public.edit_chat_message(
  p_message_id uuid,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.chat_messages%rowtype;
  v_content text := btrim(coalesce(p_content,''));
  v_mentions jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if length(v_content)=0 then raise exception 'A mensagem não pode ficar vazia'; end if;
  if length(v_content)>8000 then raise exception 'Mensagem muito longa'; end if;

  select * into v_message
    from public.chat_messages
   where id=p_message_id
   for update;
  if not found then raise exception 'Mensagem não encontrada'; end if;

  if v_message.sender_id<>auth.uid() then
    raise exception 'Você só pode editar mensagens enviadas por você';
  end if;
  if not public.is_conversation_member(v_message.conversation_id) then
    raise exception 'Sem acesso a esta conversa';
  end if;

  -- Snapshots de /comandos representam um registro imutável da execução.
  if v_message.command_payload is not null then
    raise exception 'Mensagens de comando não podem ser editadas';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_mentions
    from jsonb_array_elements(coalesce(v_message.mentions,'[]'::jsonb)) value
   where position(lower('@'||coalesce(value->>'label','')) in lower(v_content))>0;

  update public.chat_messages
     set content=v_content,
         mentions=coalesce(v_mentions,'[]'::jsonb),
         edited_at=now()
   where id=p_message_id;

  return true;
end;
$$;

revoke execute on function public.edit_subactivity_comment(uuid,text) from public,anon;
revoke execute on function public.edit_service_request_message(uuid,text) from public,anon;
revoke execute on function public.edit_chat_message(uuid,text) from public,anon;

grant execute on function public.edit_subactivity_comment(uuid,text) to authenticated;
grant execute on function public.edit_service_request_message(uuid,text) to authenticated;
grant execute on function public.edit_chat_message(uuid,text) to authenticated;

commit;
