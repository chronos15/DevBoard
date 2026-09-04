-- Devboard · somente usuários com e-mail confirmado entram no workspace ativo
-- Execute depois da migration 048.
--
-- Objetivos:
--   • novos cadastros sem confirmação ficam com workspace_members.active = false;
--   • ao confirmar o e-mail, a associação é ativada automaticamente;
--   • usuários antigos ainda não confirmados são desativados do workspace;
--   • uma desativação administrativa posterior não é revertida por alterações comuns
--     no perfil do Auth.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_name text;
  v_email_confirmed boolean;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Usuário'), '@', 1)
  );

  v_email_confirmed := new.email_confirmed_at is not null;

  insert into public.profiles(id, email, name, initials)
  values (
    new.id,
    coalesce(new.email, ''),
    v_name,
    coalesce(nullif(public.make_initials(v_name), ''), 'US')
  )
  on conflict (id) do update
    set email = excluded.email,
        name = excluded.name,
        initials = excluded.initials,
        updated_at = now();

  -- A associação existe desde o cadastro para preservar o fluxo já usado pelo
  -- projeto, porém só fica ativa quando o Supabase confirmar o e-mail.
  insert into public.workspace_members(workspace_id, user_id, role, active)
  values (
    '00000000-0000-0000-0000-000000000001',
    new.id,
    'member'::public.workspace_role,
    v_email_confirmed
  )
  on conflict (workspace_id, user_id) do nothing;

  -- Enquanto não houver confirmação, nenhuma alteração de metadata/email pode
  -- tornar o usuário visível ou elegível nas regras que usam `active`.
  if not v_email_confirmed then
    update public.workspace_members
       set active = false
     where workspace_id = '00000000-0000-0000-0000-000000000001'
       and user_id = new.id
       and active is distinct from false;
  elsif tg_op = 'UPDATE' then
    -- Ativa somente na transição real "não confirmado -> confirmado".
    -- Assim, se um Admin desativar a conta depois, uma simples edição de nome ou
    -- e-mail no Auth não reativa o usuário indevidamente.
    if old.email_confirmed_at is null and new.email_confirmed_at is not null then
      update public.workspace_members
         set active = true
       where workspace_id = '00000000-0000-0000-0000-000000000001'
         and user_id = new.id;
    end if;
  end if;

  insert into public.user_preferences(user_id)
  values(new.id)
  on conflict(user_id) do nothing;

  return new;
end;
$$;

-- O trigger anterior não observava email_confirmed_at. Ele precisa ser recriado
-- para que a confirmação do link de e-mail ative o membro sem qualquer ação do Admin.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_profile_updated on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger on_auth_user_profile_updated
  after update of email, raw_user_meta_data, email_confirmed_at on auth.users
  for each row execute procedure public.handle_new_user();

-- Corrige imediatamente cadastros existentes que ainda não confirmaram o e-mail.
-- `workspace_members.active` já é a fonte usada por current_workspace_id,
-- is_workspace_member, is_workspace_admin e pela listagem da equipe.
update public.workspace_members wm
   set active = false
  from auth.users u
 where u.id = wm.user_id
   and u.email_confirmed_at is null
   and wm.active = true;

commit;
