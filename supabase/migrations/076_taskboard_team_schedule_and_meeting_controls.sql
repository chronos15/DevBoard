-- TaskBoard V92 · Gestão de equipe, jornada diária e controle de participantes da reunião
-- Execute depois da migration 075.

begin;

-- Jornada configurável por usuário no workspace. 0=domingo ... 6=sábado.
alter table public.workspace_members
  add column if not exists work_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  add column if not exists daily_hours numeric(5,2) not null default 8.00;

alter table public.workspace_members
  drop constraint if exists workspace_members_work_days_check,
  add constraint workspace_members_work_days_check
    check (
      cardinality(work_days) <= 7
      and work_days <@ array[0,1,2,3,4,5,6]::smallint[]
    ),
  drop constraint if exists workspace_members_daily_hours_check,
  add constraint workspace_members_daily_hours_check
    check (daily_hours > 0 and daily_hours <= 24);

-- Lista administrativa da equipe, incluindo contas inativas. A listagem normal
-- do produto continua usando apenas workspace_members.active = true.
create or replace function public.list_workspace_team_members()
returns table(
  user_id uuid,
  email text,
  name text,
  initials text,
  color text,
  avatar_path text,
  role text,
  active boolean,
  work_days smallint[],
  daily_hours numeric,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
begin
  if auth.uid() is null or v_workspace is null then
    raise exception 'Não autenticado';
  end if;
  if not public.is_workspace_admin(v_workspace) then
    raise exception 'Somente administradores podem gerenciar a equipe';
  end if;

  return query
  select
    wm.user_id,
    p.email,
    p.name,
    p.initials,
    p.color,
    p.avatar_path,
    wm.role::text,
    wm.active,
    coalesce(wm.work_days, array[1,2,3,4,5]::smallint[]),
    coalesce(wm.daily_hours, 8.00::numeric),
    wm.joined_at
  from public.workspace_members wm
  join public.profiles p on p.id = wm.user_id
  where wm.workspace_id = v_workspace
  order by wm.active desc, p.name, p.email;
end;
$$;

create or replace function public.set_workspace_member_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_target_role public.workspace_role;
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem alterar o status da equipe'; end if;
  if p_user_id is null then raise exception 'Usuário inválido'; end if;

  select wm.role into v_target_role
  from public.workspace_members wm
  where wm.workspace_id=v_workspace and wm.user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;

  if p_active is false and p_user_id = auth.uid() then
    raise exception 'Você não pode inativar sua própria conta por esta tela';
  end if;

  if p_active is false and v_target_role='admin' and not exists(
    select 1
    from public.workspace_members wm
    where wm.workspace_id=v_workspace
      and wm.user_id<>p_user_id
      and wm.active
      and wm.role='admin'
  ) then
    raise exception 'O workspace precisa manter ao menos um administrador ativo';
  end if;

  update public.workspace_members
     set active=p_active
   where workspace_id=v_workspace and user_id=p_user_id;
end;
$$;

create or replace function public.set_workspace_member_schedule(
  p_user_id uuid,
  p_work_days smallint[],
  p_daily_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_days smallint[];
begin
  if auth.uid() is null or v_workspace is null then raise exception 'Não autenticado'; end if;
  if not public.is_workspace_admin(v_workspace) then raise exception 'Somente administradores podem alterar a jornada da equipe'; end if;
  if p_user_id is null then raise exception 'Usuário inválido'; end if;
  if p_daily_hours is null or p_daily_hours <= 0 or p_daily_hours > 24 then raise exception 'A carga diária deve estar entre 0 e 24 horas'; end if;

  select coalesce(array_agg(distinct day order by day), '{}'::smallint[])
    into v_days
  from unnest(coalesce(p_work_days, '{}'::smallint[])) as t(day);

  if cardinality(v_days) > 7 or not (v_days <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Dias de trabalho inválidos';
  end if;

  update public.workspace_members
     set work_days=v_days,
         daily_hours=round(p_daily_hours::numeric,2)
   where workspace_id=v_workspace and user_id=p_user_id;
  if not found then raise exception 'Usuário não pertence ao workspace'; end if;
end;
$$;

-- Admin, criador da reunião ou responsável do item de origem pode moderar a sala.
create or replace function public.can_manage_meeting_members(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
    from public.meetings m
    left join public.activity_meeting_runs r on r.meeting_id=m.id
    left join public.subactivities s on s.id=r.subactivity_id
    where m.id=p_meeting_id
      and m.ended_at is null
      and (
        public.is_workspace_admin(m.workspace_id)
        or m.created_by=auth.uid()
        or s.assignee_id=auth.uid()
        or exists(
          select 1 from public.activity_assignees aa
          where aa.activity_id=r.activity_id and aa.user_id=auth.uid()
        )
      )
  );
$$;

create or replace function public.meeting_remove_user(p_meeting_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_user_id is null or p_user_id=auth.uid() then raise exception 'Use Sair da reunião para remover a si próprio'; end if;

  select m.workspace_id into v_workspace
  from public.meetings m
  where m.id=p_meeting_id and m.ended_at is null;
  if not found then raise exception 'Reunião não encontrada ou já encerrada'; end if;

  if not public.can_manage_meeting_members(p_meeting_id) then
    raise exception 'Você não tem permissão para remover participantes desta reunião';
  end if;

  delete from public.meeting_members
  where meeting_id=p_meeting_id and user_id=p_user_id;
  if not found then return false; end if;

  update public.notifications
     set read_at=coalesce(read_at,now())
   where meeting_id=p_meeting_id and recipient_id=p_user_id and type='meeting-invite';

  update public.meetings set updated_at=now() where id=p_meeting_id;
  return true;
end;
$$;

revoke execute on function public.list_workspace_team_members() from public, anon;
grant execute on function public.list_workspace_team_members() to authenticated;
revoke execute on function public.set_workspace_member_active(uuid,boolean) from public, anon;
grant execute on function public.set_workspace_member_active(uuid,boolean) to authenticated;
revoke execute on function public.set_workspace_member_schedule(uuid,smallint[],numeric) from public, anon;
grant execute on function public.set_workspace_member_schedule(uuid,smallint[],numeric) to authenticated;
revoke execute on function public.can_manage_meeting_members(uuid) from public, anon;
grant execute on function public.can_manage_meeting_members(uuid) to authenticated;
revoke execute on function public.meeting_remove_user(uuid,uuid) from public, anon;
grant execute on function public.meeting_remove_user(uuid,uuid) to authenticated;

commit;
