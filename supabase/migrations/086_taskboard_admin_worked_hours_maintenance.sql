begin;

-- 086 · Manutenção administrativa completa das horas da subatividade.
--
-- Mantemos tracked_seconds como o tempo produzido pelo cronômetro e registramos
-- correções manuais em manual_adjustment_seconds. Isso evita reescrever sessões
-- históricas e permite ajustar inclusive uma subatividade que esteja em execução.

alter table public.subactivities
  add column if not exists manual_adjustment_seconds bigint not null default 0;

create table if not exists public.subactivity_time_adjustments (
  id uuid primary key default gen_random_uuid(),
  subactivity_id uuid not null references public.subactivities(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  adjustment_seconds bigint not null check (adjustment_seconds <> 0),
  previous_total_seconds bigint not null check (previous_total_seconds >= 0),
  new_total_seconds bigint not null check (new_total_seconds >= 0),
  adjusted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists subactivity_time_adjustments_sub_idx
  on public.subactivity_time_adjustments(subactivity_id, created_at desc);
create index if not exists subactivity_time_adjustments_user_idx
  on public.subactivity_time_adjustments(user_id, created_at desc);

alter table public.subactivity_time_adjustments enable row level security;

-- Não há acesso direto pelo cliente. A escrita ocorre somente pela RPC SECURITY
-- DEFINER abaixo e a leitura para relatórios ocorre por hours_report().
revoke all on table public.subactivity_time_adjustments from public, anon, authenticated;

create or replace function public.update_subactivity_time_maintenance_admin(
  p_subactivity_id uuid,
  p_estimated_hours numeric,
  p_tracked_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.subactivities%rowtype;
  v_project uuid;
  v_workspace uuid;
  v_now timestamptz := now();
  v_elapsed bigint := 0;
  v_old_total bigint := 0;
  v_new_total bigint := 0;
  v_delta bigint := 0;
  v_new_estimate numeric := 0;
  v_estimate_changed boolean := false;
  v_tracked_changed boolean := false;
  v_old_estimate_label text;
  v_new_estimate_label text;
  v_old_tracked_label text;
  v_new_tracked_label text;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_estimated_hours is null or p_estimated_hours < 0 or p_estimated_hours > 100000 then
    raise exception 'A estimativa precisa ser um valor válido igual ou maior que zero';
  end if;

  if p_tracked_hours is not null and (p_tracked_hours < 0 or p_tracked_hours > 1000000) then
    raise exception 'As horas trabalhadas precisam ser um valor válido igual ou maior que zero';
  end if;

  select *
    into v_sub
    from public.subactivities
   where id = p_subactivity_id
   for update;

  if not found then
    raise exception 'Subatividade não encontrada';
  end if;

  v_project := public.subactivity_project_id(p_subactivity_id);
  v_workspace := public.project_workspace_id(v_project);

  if public.workspace_role_of(v_workspace, auth.uid()) <> 'admin' then
    raise exception 'Somente Administradores podem fazer manutenção das horas';
  end if;

  if v_sub.status = 'in-progress' and v_sub.timer_started_at is not null then
    v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_sub.timer_started_at)))::bigint);
  end if;

  v_old_total := greatest(0, coalesce(v_sub.tracked_seconds, 0) + coalesce(v_sub.manual_adjustment_seconds, 0) + v_elapsed);
  v_new_total := v_old_total;
  if p_tracked_hours is not null then
    v_new_total := greatest(0, round(p_tracked_hours * 3600)::bigint);
  end if;
  v_delta := v_new_total - v_old_total;
  v_new_estimate := round(p_estimated_hours, 2);

  v_estimate_changed := coalesce(v_sub.estimated_hours, 0) is distinct from v_new_estimate;
  v_tracked_changed := p_tracked_hours is not null and v_delta <> 0;

  if not v_estimate_changed and not v_tracked_changed then
    return;
  end if;

  update public.subactivities
     set estimated_hours = case when v_estimate_changed then v_new_estimate else estimated_hours end,
         manual_adjustment_seconds = case
           when v_tracked_changed then coalesce(manual_adjustment_seconds, 0) + v_delta
           else manual_adjustment_seconds
         end,
         updated_at = v_now
   where id = p_subactivity_id;

  if v_tracked_changed then
    insert into public.subactivity_time_adjustments(
      subactivity_id,
      user_id,
      adjustment_seconds,
      previous_total_seconds,
      new_total_seconds,
      adjusted_by,
      created_at
    ) values (
      p_subactivity_id,
      v_sub.assignee_id,
      v_delta,
      v_old_total,
      v_new_total,
      auth.uid(),
      v_now
    );
  end if;

  v_old_estimate_label := trim(to_char(coalesce(v_sub.estimated_hours, 0), 'FM999999990.##'));
  v_new_estimate_label := trim(to_char(v_new_estimate, 'FM999999990.##'));
  v_old_tracked_label := trim(to_char(v_old_total::numeric / 3600, 'FM999999990.##'));
  v_new_tracked_label := trim(to_char(v_new_total::numeric / 3600, 'FM999999990.##'));

  perform public.add_project_log(
    v_project,
    'subactivity-updated',
    'Manutenção de horas da subatividade',
    format(
      '“%s” · estimativa: %sh → %sh · trabalhado: %sh → %sh.',
      v_sub.title,
      v_old_estimate_label,
      v_new_estimate_label,
      v_old_tracked_label,
      v_new_tracked_label
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.update_subactivity_time_maintenance_admin(uuid,numeric,numeric) from public, anon;
grant execute on function public.update_subactivity_time_maintenance_admin(uuid,numeric,numeric) to authenticated;

-- O relatório de horas passa a considerar também correções administrativas.
-- A correção é atribuída ao momento em que foi realizada, preservando intactas
-- as sessões originais do cronômetro.
drop function if exists public.hours_report(timestamptz,timestamptz,uuid,uuid);

create function public.hours_report(
  p_start timestamptz,
  p_end timestamptz,
  p_project_id uuid default null,
  p_user_id uuid default null
)
returns table (
  session_id uuid,
  subactivity_id uuid,
  user_id uuid,
  project_id uuid,
  project_name text,
  activity_id uuid,
  activity_title text,
  subactivity_title text,
  subactivity_status text,
  estimated_hours numeric,
  started_at timestamptz,
  ended_at timestamptz,
  reported_seconds bigint,
  is_adjustment boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid;
  v_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Período inválido';
  end if;

  v_workspace := public.current_workspace_id();
  if v_workspace is null then
    raise exception 'Workspace não encontrado';
  end if;

  select exists (
    select 1
      from public.workspace_members wm
     where wm.workspace_id = v_workspace
       and wm.user_id = auth.uid()
       and wm.active
       and wm.role = 'admin'
  ) into v_is_admin;

  if p_project_id is not null and not exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.workspace_id = v_workspace
  ) then
    raise exception 'Projeto inválido para este workspace';
  end if;

  if not v_is_admin and p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'Você pode consultar somente seus próprios registros';
  end if;

  return query
  with report_rows as (
    select
      ws.id as row_id,
      ws.subactivity_id,
      ws.user_id,
      p.id as project_id,
      p.name as project_name,
      a.id as activity_id,
      a.title as activity_title,
      s.title as subactivity_title,
      s.status::text as subactivity_status,
      s.estimated_hours,
      ws.started_at,
      ws.ended_at,
      case
        when ws.ended_at is null then
          greatest(0, floor(extract(epoch from (least(now(), p_end) - greatest(ws.started_at, p_start))))::bigint)
        when ws.started_at >= p_start and ws.ended_at <= p_end then ws.duration_seconds
        else greatest(
          0,
          floor(
            ws.duration_seconds::numeric
            * greatest(0, extract(epoch from (least(ws.ended_at, p_end) - greatest(ws.started_at, p_start))))
            / greatest(1, extract(epoch from (ws.ended_at - ws.started_at)))
          )::bigint
        )
      end as seconds,
      false as adjustment
    from public.work_sessions ws
    join public.subactivities s on s.id = ws.subactivity_id
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
    where p.workspace_id = v_workspace
      and ws.started_at < p_end
      and coalesce(ws.ended_at, now()) > p_start
      and (p_project_id is null or p.id = p_project_id)
      and (
        (v_is_admin and (p_user_id is null or ws.user_id = p_user_id))
        or (not v_is_admin and ws.user_id = auth.uid())
      )

    union all

    select
      adj.id as row_id,
      adj.subactivity_id,
      adj.user_id,
      p.id as project_id,
      p.name as project_name,
      a.id as activity_id,
      a.title as activity_title,
      s.title as subactivity_title,
      s.status::text as subactivity_status,
      s.estimated_hours,
      adj.created_at as started_at,
      adj.created_at as ended_at,
      adj.adjustment_seconds as seconds,
      true as adjustment
    from public.subactivity_time_adjustments adj
    join public.subactivities s on s.id = adj.subactivity_id
    join public.activities a on a.id = s.activity_id
    join public.projects p on p.id = a.project_id
    where p.workspace_id = v_workspace
      and adj.created_at >= p_start
      and adj.created_at < p_end
      and (p_project_id is null or p.id = p_project_id)
      and (
        (v_is_admin and (p_user_id is null or adj.user_id = p_user_id))
        or (not v_is_admin and adj.user_id = auth.uid())
      )
  )
  select
    row_id,
    subactivity_id,
    user_id,
    project_id,
    project_name,
    activity_id,
    activity_title,
    subactivity_title,
    subactivity_status,
    estimated_hours,
    started_at,
    ended_at,
    seconds,
    adjustment
  from report_rows
  order by started_at desc;
end;
$$;

revoke all on function public.hours_report(timestamptz,timestamptz,uuid,uuid) from public, anon, authenticated;
grant execute on function public.hours_report(timestamptz,timestamptz,uuid,uuid) to authenticated;

commit;
