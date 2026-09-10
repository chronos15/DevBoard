-- TaskBoard V70 - Tipografia personalizada + anexos genéricos em comandos
begin;

alter table public.user_preferences
  add column if not exists font_family text not null default 'jakarta',
  add column if not exists chat_text_size text not null default 'medium',
  add column if not exists chat_line_spacing text not null default 'comfortable';

alter table public.user_preferences drop constraint if exists user_preferences_font_family_check;
alter table public.user_preferences add constraint user_preferences_font_family_check
  check (font_family in ('jakarta','system','arial','verdana','tahoma'));

alter table public.user_preferences drop constraint if exists user_preferences_chat_text_size_check;
alter table public.user_preferences add constraint user_preferences_chat_text_size_check
  check (chat_text_size in ('small','medium','large','xlarge'));

alter table public.user_preferences drop constraint if exists user_preferences_chat_line_spacing_check;
alter table public.user_preferences add constraint user_preferences_chat_line_spacing_check
  check (chat_line_spacing in ('compact','comfortable','relaxed'));

-- Substitui a assinatura anterior preservando compatibilidade via parâmetros default.
drop function if exists public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text,text,text);

create function public.update_my_preferences(
  p_notify_assignments boolean,
  p_notify_comments boolean,
  p_notify_team_activity boolean,
  p_notify_deadlines boolean,
  p_timer_sticky boolean,
  p_reduced_motion boolean,
  p_density text,
  p_primary_color text default null,
  p_interface_mode text default null,
  p_font_family text default null,
  p_chat_text_size text default null,
  p_chat_line_spacing text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary_color text := upper(nullif(btrim(coalesce(p_primary_color, '')), ''));
  v_interface_mode text := lower(nullif(btrim(coalesce(p_interface_mode, '')), ''));
  v_font_family text := lower(nullif(btrim(coalesce(p_font_family, '')), ''));
  v_chat_text_size text := lower(nullif(btrim(coalesce(p_chat_text_size, '')), ''));
  v_chat_line_spacing text := lower(nullif(btrim(coalesce(p_chat_line_spacing, '')), ''));
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_density not in ('comfortable','compact') then raise exception 'Densidade inválida'; end if;
  if v_primary_color is not null and v_primary_color !~ '^#[0-9A-F]{6}$' then raise exception 'Cor primária inválida'; end if;
  if v_interface_mode is not null and v_interface_mode not in ('complete','focused') then raise exception 'Modo de interface inválido'; end if;
  if v_font_family is not null and v_font_family not in ('jakarta','system','arial','verdana','tahoma') then raise exception 'Fonte inválida'; end if;
  if v_chat_text_size is not null and v_chat_text_size not in ('small','medium','large','xlarge') then raise exception 'Tamanho de texto inválido'; end if;
  if v_chat_line_spacing is not null and v_chat_line_spacing not in ('compact','comfortable','relaxed') then raise exception 'Espaçamento de texto inválido'; end if;

  insert into public.user_preferences(
    user_id, notify_assignments, notify_comments, notify_team_activity, notify_deadlines,
    timer_sticky, reduced_motion, density, primary_color, interface_mode,
    font_family, chat_text_size, chat_line_spacing, updated_at
  ) values (
    auth.uid(), p_notify_assignments, p_notify_comments, p_notify_team_activity, p_notify_deadlines,
    p_timer_sticky, p_reduced_motion, p_density, v_primary_color, coalesce(v_interface_mode,'complete'),
    coalesce(v_font_family,'jakarta'), coalesce(v_chat_text_size,'medium'), coalesce(v_chat_line_spacing,'comfortable'), now()
  )
  on conflict(user_id) do update set
    notify_assignments = excluded.notify_assignments,
    notify_comments = excluded.notify_comments,
    notify_team_activity = excluded.notify_team_activity,
    notify_deadlines = excluded.notify_deadlines,
    timer_sticky = excluded.timer_sticky,
    reduced_motion = excluded.reduced_motion,
    density = excluded.density,
    primary_color = excluded.primary_color,
    interface_mode = coalesce(v_interface_mode, public.user_preferences.interface_mode),
    font_family = coalesce(v_font_family, public.user_preferences.font_family),
    chat_text_size = coalesce(v_chat_text_size, public.user_preferences.chat_text_size),
    chat_line_spacing = coalesce(v_chat_line_spacing, public.user_preferences.chat_line_spacing),
    updated_at = now();
end;
$$;

revoke execute on function public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text,text) from public, anon;
grant execute on function public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text,text) to authenticated;

-- Bucket privado dos arquivos usados por comandos de canal.
insert into storage.buckets(id, name, public, file_size_limit)
values ('taskboard-command-files','taskboard-command-files',false,52428800)
on conflict(id) do update set public=false, file_size_limit=52428800;

drop policy if exists taskboard_command_files_select on storage.objects;
create policy taskboard_command_files_select
on storage.objects for select to authenticated
using (
  bucket_id='taskboard-command-files'
  and public.is_workspace_member(public.safe_path_workspace_id(name))
);

drop policy if exists taskboard_command_files_insert on storage.objects;
create policy taskboard_command_files_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='taskboard-command-files'
  and public.is_workspace_admin(public.safe_path_workspace_id(name))
  and split_part(name,'/',3)=auth.uid()::text
);

drop policy if exists taskboard_command_files_delete on storage.objects;
create policy taskboard_command_files_delete
on storage.objects for delete to authenticated
using (
  bucket_id='taskboard-command-files'
  and public.is_workspace_admin(public.safe_path_workspace_id(name))
);

commit;
