-- =============================================================================
-- Devboard V49 — modo de interface por usuário
-- Mantém o modo Completo como padrão para preservar a experiência atual.
-- =============================================================================

alter table public.user_preferences
  add column if not exists interface_mode text not null default 'complete';

alter table public.user_preferences
  drop constraint if exists user_preferences_interface_mode_check;

alter table public.user_preferences
  add constraint user_preferences_interface_mode_check
  check (interface_mode in ('complete', 'focused'));

-- A assinatura passa a persistir também o modo de interface.
drop function if exists public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text,text);

create function public.update_my_preferences(
  p_notify_assignments boolean,
  p_notify_comments boolean,
  p_notify_team_activity boolean,
  p_notify_deadlines boolean,
  p_timer_sticky boolean,
  p_reduced_motion boolean,
  p_density text,
  p_primary_color text default null,
  p_interface_mode text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary_color text := upper(nullif(btrim(coalesce(p_primary_color, '')), ''));
  v_interface_mode text := lower(nullif(btrim(coalesce(p_interface_mode, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if p_density not in ('comfortable','compact') then
    raise exception 'Densidade inválida';
  end if;

  if v_primary_color is not null and v_primary_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Cor primária inválida';
  end if;

  if v_interface_mode is not null and v_interface_mode not in ('complete','focused') then
    raise exception 'Modo de interface inválido';
  end if;

  insert into public.user_preferences(
    user_id,
    notify_assignments,
    notify_comments,
    notify_team_activity,
    notify_deadlines,
    timer_sticky,
    reduced_motion,
    density,
    primary_color,
    interface_mode,
    updated_at
  ) values (
    auth.uid(),
    p_notify_assignments,
    p_notify_comments,
    p_notify_team_activity,
    p_notify_deadlines,
    p_timer_sticky,
    p_reduced_motion,
    p_density,
    v_primary_color,
    coalesce(v_interface_mode, 'complete'),
    now()
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
    -- Clientes/PWAs antigos ainda podem chamar a RPC sem p_interface_mode.
    -- Nesse caso preservamos a escolha já gravada em vez de voltar ao padrão.
    interface_mode = coalesce(v_interface_mode, public.user_preferences.interface_mode),
    updated_at = now();
end;
$$;

revoke execute on function public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text,text,text) from public, anon;
grant execute on function public.update_my_preferences(boolean,boolean,boolean,boolean,boolean,boolean,text,text,text) to authenticated;
