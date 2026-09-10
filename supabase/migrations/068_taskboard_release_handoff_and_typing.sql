begin;

-- TaskBoard V78
-- 1) Ao concluir uma subatividade ou enviá-la para AQS, permite registrar dados
--    opcionais da entrega (pasta, versão, build e nome do ZIP) sem alterar a
--    estrutura das tabelas. As informações ficam no histórico do projeto.
-- 2) O indicador "digitando..." usa Supabase Realtime Presence no frontend e,
--    por isso, não exige tabela, trigger ou policy adicional.

create or replace function public.set_subactivity_status_with_release_info(
  p_subactivity_id uuid,
  p_status text,
  p_folder_path text default null,
  p_version text default null,
  p_build text default null,
  p_zip_name text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_sub_title text;
  v_folder_path text := nullif(btrim(coalesce(p_folder_path, '')), '');
  v_version text := nullif(btrim(coalesce(p_version, '')), '');
  v_build text := nullif(btrim(coalesce(p_build, '')), '');
  v_zip_name text := nullif(btrim(coalesce(p_zip_name, '')), '');
  v_details text := '';
  v_title text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_status not in ('waiting-aqs', 'done') then
    raise exception 'As informações de entrega só podem ser registradas ao concluir ou enviar para AQS';
  end if;

  if length(coalesce(v_folder_path, '')) > 1000 then
    raise exception 'O caminho da pasta é muito longo';
  end if;
  if length(coalesce(v_version, '')) > 120 then
    raise exception 'O número da versão é muito longo';
  end if;
  if length(coalesce(v_build, '')) > 120 then
    raise exception 'O número da build é muito longo';
  end if;
  if length(coalesce(v_zip_name, '')) > 255 then
    raise exception 'O nome do arquivo ZIP é muito longo';
  end if;

  select a.project_id, s.title
    into v_project_id, v_sub_title
    from public.subactivities s
    join public.activities a on a.id = s.activity_id
   where s.id = p_subactivity_id;

  if v_project_id is null then
    raise exception 'Subatividade não encontrada';
  end if;

  -- Mantém todas as validações já consolidadas no fluxo oficial de status:
  -- responsável/admin, checklist, OS vinculada, AQS e estados terminais.
  perform public.set_subactivity_status(p_subactivity_id, p_status);

  if v_folder_path is not null then
    v_details := v_details || format(E'\nPasta da versão: %s', v_folder_path);
  end if;
  if v_version is not null then
    v_details := v_details || format(E'\nVersão: %s', v_version);
  end if;
  if v_build is not null then
    v_details := v_details || format(E'\nBuild: %s', v_build);
  end if;
  if v_zip_name is not null then
    v_details := v_details || format(E'\nArquivo ZIP: %s', v_zip_name);
  end if;

  if btrim(v_details) = '' then
    v_details := E'\nNenhuma informação de versão/build, caminho de pasta ou arquivo ZIP foi informada nesta etapa.';
  end if;

  v_title := case
    when p_status = 'waiting-aqs' then 'Informações da entrega para AQS'
    else 'Informações da conclusão da subatividade'
  end;

  perform public.add_project_log(
    v_project_id,
    'subactivity-status',
    v_title,
    format('“%s”%s', v_sub_title, v_details),
    auth.uid()
  );
end;
$$;

revoke execute on function public.set_subactivity_status_with_release_info(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.set_subactivity_status_with_release_info(uuid,text,text,text,text,text) to authenticated;

commit;
