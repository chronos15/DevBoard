-- TaskBoard V91 · Mensagem + anexos como uma única publicação visual
-- Execute após 074_taskboard_admin_subactivity_edit_and_team_expand.sql.

begin;

alter table public.subactivity_comments
  add column if not exists message_group_id uuid;

alter table public.attachments
  add column if not exists message_group_id uuid;

create index if not exists subactivity_comments_message_group_idx
  on public.subactivity_comments(subactivity_id, message_group_id)
  where message_group_id is not null;

create index if not exists attachments_message_group_idx
  on public.attachments(subactivity_id, message_group_id, created_at)
  where subactivity_id is not null and message_group_id is not null;

-- A associação é feita logo após a criação do comentário. Não alteramos a
-- assinatura das RPCs antigas, preservando compatibilidade com clientes/PWA
-- que ainda estejam em cache durante a publicação da V91.
create or replace function public.set_followup_comment_message_group(
  p_comment_id uuid,
  p_message_group_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subactivity_id uuid;
  v_author_id uuid;
  v_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_comment_id is null or p_message_group_id is null then raise exception 'Agrupamento inválido'; end if;

  select c.subactivity_id, c.author_id
    into v_subactivity_id, v_author_id
    from public.subactivity_comments c
   where c.id = p_comment_id
   for update;

  if not found then raise exception 'Mensagem não encontrada'; end if;
  if v_author_id is distinct from auth.uid() then raise exception 'Sem permissão para agrupar esta mensagem'; end if;

  v_workspace_id := public.project_workspace_id(public.subactivity_project_id(v_subactivity_id));
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Sem acesso à subatividade';
  end if;

  update public.subactivity_comments
     set message_group_id = p_message_group_id
   where id = p_comment_id;

  return true;
end;
$$;

create or replace function public.set_followup_attachment_message_group(
  p_attachment_id uuid,
  p_message_group_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subactivity_id uuid;
  v_uploaded_by uuid;
  v_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_attachment_id is null or p_message_group_id is null then raise exception 'Agrupamento inválido'; end if;

  select a.subactivity_id, a.uploaded_by
    into v_subactivity_id, v_uploaded_by
    from public.attachments a
   where a.id = p_attachment_id
     and a.active = true
   for update;

  if not found or v_subactivity_id is null then raise exception 'Anexo de subatividade não encontrado'; end if;
  if v_uploaded_by is distinct from auth.uid() then raise exception 'Sem permissão para agrupar este anexo'; end if;

  v_workspace_id := public.project_workspace_id(public.subactivity_project_id(v_subactivity_id));
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Sem acesso à subatividade';
  end if;

  update public.attachments
     set message_group_id = p_message_group_id
   where id = p_attachment_id;

  return true;
end;
$$;

revoke execute on function public.set_followup_comment_message_group(uuid,uuid) from public, anon;
revoke execute on function public.set_followup_attachment_message_group(uuid,uuid) from public, anon;
grant execute on function public.set_followup_comment_message_group(uuid,uuid) to authenticated;
grant execute on function public.set_followup_attachment_message_group(uuid,uuid) to authenticated;

comment on column public.subactivity_comments.message_group_id is
  'Agrupa visualmente uma mensagem e os anexos enviados na mesma ação do compositor.';
comment on column public.attachments.message_group_id is
  'Agrupa visualmente anexos da subatividade à mensagem enviada na mesma ação do compositor.';

commit;
