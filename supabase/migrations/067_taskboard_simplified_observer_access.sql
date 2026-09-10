begin;

-- TaskBoard V77
-- Modo Resumido: desenvolvedor pode visualizar subatividades mesmo sem estar
-- vinculado a elas. Fora da subatividade ele atua como observador: consulta o
-- histórico/checklist, reage e pode comentar somente por meio de "Responder".
-- As permissões de alteração continuam restritas aos participantes e aos admins.
--
-- Esta migration NÃO altera a estrutura das tabelas. Apenas adiciona um helper
-- de leitura e ajusta políticas/RPCs do Acompanhamento.

create or replace function public.can_view_followup_subactivity(p_subactivity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists(
    select 1
      from public.subactivities s
      join public.activities a on a.id = s.activity_id
      join public.projects p on p.id = a.project_id
     where s.id = p_subactivity_id
       and public.is_workspace_member(p.workspace_id)
       and (
         public.workspace_role_of(p.workspace_id, auth.uid()) in ('admin','developer')
         or s.assignee_id = auth.uid()
         or exists(
           select 1
             from public.subactivity_members sm
            where sm.subactivity_id = s.id
              and sm.user_id = auth.uid()
         )
       )
  );
$$;

revoke execute on function public.can_view_followup_subactivity(uuid) from public, anon;
grant execute on function public.can_view_followup_subactivity(uuid) to authenticated;

comment on function public.can_view_followup_subactivity(uuid) is
  'Permissão de visualização do Acompanhamento. Admin e developer do workspace podem visualizar; demais perfis precisam participar da subatividade.';

-- Reações: observadores DEV podem ler e reagir, sem ganhar qualquer permissão
-- adicional sobre a subatividade.
drop policy if exists cadence_followup_reactions_select on public.followup_reactions;
create policy cadence_followup_reactions_select
  on public.followup_reactions for select to authenticated
  using (public.can_view_followup_subactivity(subactivity_id));

create or replace function public.set_followup_reaction(
  p_subactivity_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_emoji text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_valid boolean := false;
  v_emoji text := nullif(btrim(coalesce(p_emoji,'')), '');
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_subactivity_id is null or p_target_id is null then raise exception 'Item inválido'; end if;
  if p_target_kind not in ('comment','attachment','session','log') then raise exception 'Tipo de reação inválido'; end if;
  if not public.can_view_followup_subactivity(p_subactivity_id) then
    raise exception 'Sem acesso ao acompanhamento';
  end if;

  select a.project_id, p.workspace_id
    into v_project, v_workspace
    from public.subactivities s
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
   where s.id = p_subactivity_id;

  if p_target_kind = 'comment' then
    select exists(
      select 1 from public.subactivity_comments c
       where c.id = p_target_id and c.subactivity_id = p_subactivity_id
    ) into v_valid;
  elsif p_target_kind = 'attachment' then
    select exists(
      select 1 from public.attachments a
       where a.id = p_target_id and a.subactivity_id = p_subactivity_id and a.active = true
    ) into v_valid;
  elsif p_target_kind = 'session' then
    select exists(
      select 1 from public.work_sessions w
       where w.id = p_target_id and w.subactivity_id = p_subactivity_id
    ) into v_valid;
  else
    select exists(
      select 1 from public.project_logs l
       where l.id = p_target_id and l.project_id = v_project
    ) into v_valid;
  end if;

  if not v_valid then raise exception 'Item do acompanhamento não encontrado'; end if;

  if v_emoji is null then
    delete from public.followup_reactions
     where subactivity_id = p_subactivity_id
       and target_kind = p_target_kind
       and target_id = p_target_id
       and user_id = auth.uid();
    return true;
  end if;

  if v_emoji not in (
    '👍','👎','❤️','😂','😮','😢','😡','🎉','🔥','🚀',
    '👀','✅','💯','🤔','🙏','👏','💪','💡','⚠️','⭐'
  ) then
    raise exception 'Emoji de reação inválido';
  end if;

  insert into public.followup_reactions(
    workspace_id, project_id, subactivity_id, target_kind, target_id, user_id, emoji, created_at, updated_at
  ) values (
    v_workspace, v_project, p_subactivity_id, p_target_kind, p_target_id, auth.uid(), v_emoji, now(), now()
  )
  on conflict (subactivity_id, target_kind, target_id, user_id)
  do update set emoji = excluded.emoji, updated_at = now();

  return true;
end;
$$;

revoke execute on function public.set_followup_reaction(uuid,text,uuid,text) from public, anon;
grant execute on function public.set_followup_reaction(uuid,text,uuid,text) to authenticated;

-- Checklist: para observador é consulta apenas. Os RPCs de inclusão, conclusão
-- e exclusão continuam usando can_access_followup_subactivity(), portanto não
-- são ampliados por esta migration.
drop policy if exists taskboard_subactivity_checklist_select on public.subactivity_checklist_items;
create policy taskboard_subactivity_checklist_select
  on public.subactivity_checklist_items for select to authenticated
  using (public.can_view_followup_subactivity(subactivity_id));

-- Comentário/resposta do observador.
-- Participantes/admin mantêm exatamente o fluxo já existente. Um DEV que não
-- participa só pode escrever quando houver um alvo de resposta válido e não
-- pode usar menções para se autoelevar ou adicionar terceiros ao tópico.
create or replace function public.add_followup_comment_v2(
  p_subactivity_id uuid,
  p_content text,
  p_mentions jsonb default '[]'::jsonb,
  p_reply jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
  v_kind text;
  v_target_id uuid;
  v_snapshot jsonb;
  v_legacy_comment_id uuid;
  v_project_id uuid;
  v_workspace_id uuid;
  v_role text;
  v_author_id uuid;
  v_label text;
  v_content text;
  v_mentions jsonb := coalesce(p_mentions, '[]'::jsonb);
  v_is_participant boolean := false;
  v_sub public.subactivities%rowtype;
  v_actor_name text;
  v_preview text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if p_subactivity_id is null then raise exception 'Subatividade não informada'; end if;
  if length(btrim(coalesce(p_content,''))) = 0 then raise exception 'Comentário vazio'; end if;
  if jsonb_typeof(v_mentions) <> 'array' then raise exception 'Menções inválidas'; end if;
  if jsonb_array_length(v_mentions) > 25 then raise exception 'Muitas menções em uma única mensagem'; end if;

  v_project_id := public.subactivity_project_id(p_subactivity_id);
  v_workspace_id := public.project_workspace_id(v_project_id);
  if v_project_id is null or v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Sem acesso ao projeto';
  end if;

  select * into v_sub
    from public.subactivities
   where id = p_subactivity_id;
  if not found then raise exception 'Subatividade não encontrada'; end if;

  v_role := public.workspace_role_of(v_workspace_id, auth.uid())::text;
  v_is_participant := public.can_access_followup_subactivity(p_subactivity_id);

  if not v_is_participant then
    if v_role <> 'developer' or not public.can_view_followup_subactivity(p_subactivity_id) then
      raise exception 'Você não participa desta subatividade';
    end if;
    if p_reply is null or p_reply = 'null'::jsonb then
      raise exception 'Esta subatividade está em modo de observação. Use Responder para adicionar um comentário.';
    end if;
    if jsonb_array_length(v_mentions) > 0 then
      raise exception 'Observadores não podem mencionar usuários nesta subatividade';
    end if;
  end if;

  if p_reply is not null and p_reply <> 'null'::jsonb then
    if jsonb_typeof(p_reply) <> 'object' then
      raise exception 'Referência de resposta inválida';
    end if;

    v_kind := lower(btrim(coalesce(p_reply->>'kind', '')));
    if v_kind not in ('comment','attachment','log','session') then
      raise exception 'Tipo de item respondido inválido';
    end if;

    begin
      v_target_id := nullif(btrim(coalesce(p_reply->>'id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Item respondido inválido';
    end;

    if v_target_id is null then
      raise exception 'Item respondido inválido';
    end if;

    if v_kind = 'comment' then
      select c.author_id,
             'Mensagem',
             left(regexp_replace(c.content, '[[:space:]]+', ' ', 'g'), 180)
        into v_author_id, v_label, v_content
        from public.subactivity_comments c
       where c.id = v_target_id
         and c.subactivity_id = p_subactivity_id;
      if not found then
        raise exception 'A mensagem respondida não pertence a esta subatividade';
      end if;
      v_legacy_comment_id := v_target_id;

    elsif v_kind = 'attachment' then
      select a.uploaded_by,
             'Anexo',
             a.name
        into v_author_id, v_label, v_content
        from public.attachments a
       where a.id = v_target_id
         and a.subactivity_id = p_subactivity_id
         and a.active = true;
      if not found then
        raise exception 'O anexo respondido não pertence a esta subatividade';
      end if;

    elsif v_kind = 'session' then
      select ws.user_id,
             'Registro de trabalho',
             concat(
               lpad((ws.duration_seconds / 3600)::text, 2, '0'), ':',
               lpad(((ws.duration_seconds % 3600) / 60)::text, 2, '0'), ':',
               lpad((ws.duration_seconds % 60)::text, 2, '0'),
               ' registrados'
             )
        into v_author_id, v_label, v_content
        from public.work_sessions ws
       where ws.id = v_target_id
         and ws.subactivity_id = p_subactivity_id;
      if not found then
        raise exception 'O registro respondido não pertence a esta subatividade';
      end if;

    else
      select l.actor_id,
             'Log',
             left(
               concat_ws(' · ', nullif(btrim(l.title), ''), nullif(btrim(l.description), '')),
               220
             )
        into v_author_id, v_label, v_content
        from public.project_logs l
       where l.id = v_target_id
         and l.project_id = v_project_id;
      if not found then
        raise exception 'O log respondido não pertence a este projeto';
      end if;
    end if;

    v_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'authorId', v_author_id,
      'label', v_label,
      'content', v_content
    ));
  end if;

  if v_is_participant then
    -- Participantes/admin continuam usando a implementação consolidada, com
    -- menções, vínculo e notificações existentes.
    v_comment_id := public.add_followup_comment(
      p_subactivity_id,
      p_content,
      v_mentions,
      v_legacy_comment_id
    );

    if v_target_id is not null then
      update public.subactivity_comments
         set reply_target_kind = v_kind,
             reply_target_id = v_target_id,
             reply_snapshot = v_snapshot
       where id = v_comment_id;
    end if;

    return v_comment_id;
  end if;

  -- DEV observador: grava somente uma resposta sem transformar o usuário em
  -- participante da subatividade.
  insert into public.subactivity_comments(
    subactivity_id,
    author_id,
    content,
    mentions,
    reply_to_comment_id,
    reply_target_kind,
    reply_target_id,
    reply_snapshot
  ) values (
    p_subactivity_id,
    auth.uid(),
    btrim(p_content),
    '[]'::jsonb,
    v_legacy_comment_id,
    v_kind,
    v_target_id,
    v_snapshot
  ) returning id into v_comment_id;

  select name into v_actor_name from public.profiles where id = auth.uid();
  v_preview := left(regexp_replace(btrim(p_content), '[[:space:]]+', ' ', 'g'), 180);

  -- Mantém o responsável informado sem dar ao observador acesso de participante.
  if v_sub.assignee_id is not null and v_sub.assignee_id <> auth.uid() then
    perform public.push_notification(
      v_sub.assignee_id,
      auth.uid(),
      'subactivity-comment',
      format('%s comentou em sua subatividade', coalesce(nullif(v_actor_name,''), 'Um desenvolvedor')),
      format('“%s” · “%s”', v_sub.title, v_preview),
      v_project_id,
      v_sub.activity_id,
      p_subactivity_id
    );
  end if;

  return v_comment_id;
end;
$$;

revoke execute on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) to authenticated;

comment on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) is
  'Envia mensagem para participantes/admin; DEV observador pode apenas responder/comentar um item existente, sem virar participante.';

commit;
