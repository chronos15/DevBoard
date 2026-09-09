-- TaskBoard V62
-- Respostas genéricas no Acompanhamento: mensagens, anexos, logs e sessões de trabalho.

alter table public.subactivity_comments
  add column if not exists reply_target_kind text,
  add column if not exists reply_target_id uuid,
  add column if not exists reply_snapshot jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.subactivity_comments'::regclass
       and conname = 'subactivity_comments_reply_target_kind_check'
  ) then
    alter table public.subactivity_comments
      add constraint subactivity_comments_reply_target_kind_check
      check (reply_target_kind is null or reply_target_kind in ('comment','attachment','log','session'));
  end if;
end $$;

create index if not exists subactivity_comments_reply_target_idx
  on public.subactivity_comments(reply_target_kind, reply_target_id)
  where reply_target_id is not null;

-- Converte referências antigas de comentário para o novo formato sem perder
-- compatibilidade com reply_to_comment_id.
update public.subactivity_comments c
   set reply_target_kind = 'comment',
       reply_target_id = c.reply_to_comment_id,
       reply_snapshot = jsonb_build_object(
         'authorId', original.author_id,
         'label', 'Mensagem',
         'content', left(regexp_replace(original.content, '[[:space:]]+', ' ', 'g'), 180)
       )
  from public.subactivity_comments original
 where c.reply_to_comment_id = original.id
   and c.reply_target_id is null;

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
  v_author_id uuid;
  v_label text;
  v_content text;
begin
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
         and a.subactivity_id = p_subactivity_id;
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
      v_project_id := public.subactivity_project_id(p_subactivity_id);
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

  -- Reaproveita toda a regra existente de acesso, menções, vínculo e notificações.
  v_comment_id := public.add_followup_comment(
    p_subactivity_id,
    p_content,
    coalesce(p_mentions, '[]'::jsonb),
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
end;
$$;

revoke execute on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) to authenticated;

comment on function public.add_followup_comment_v2(uuid,text,jsonb,jsonb) is
  'Envia mensagem no Acompanhamento com resposta opcional a mensagem, anexo, log ou sessão.';
