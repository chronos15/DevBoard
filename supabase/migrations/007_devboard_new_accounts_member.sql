-- Devboard · novos cadastros sempre como Membro
-- Incremental: execute após as migrations já aplicadas.
-- Não altera a role de nenhum usuário existente.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Usuário'), '@', 1)
  );

  insert into public.profiles(id, email, name, initials)
  values (new.id, coalesce(new.email, ''), v_name, coalesce(nullif(public.make_initials(v_name), ''), 'US'))
  on conflict (id) do update
    set email = excluded.email,
        name = excluded.name,
        initials = excluded.initials,
        updated_at = now();

  -- Nunca promove automaticamente. O Administrador define a role posteriormente.
  insert into public.workspace_members(workspace_id, user_id, role)
  values ('00000000-0000-0000-0000-000000000001', new.id, 'member'::public.workspace_role)
  on conflict (workspace_id, user_id) do nothing;

  insert into public.user_preferences(user_id)
  values(new.id)
  on conflict(user_id) do nothing;

  return new;
end;
$$;

commit;
