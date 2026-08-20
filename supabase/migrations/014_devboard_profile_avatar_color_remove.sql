-- Devboard · Migration 014
-- Avatar personalizável por usuário + remoção segura da foto.
-- Incremental: preserva perfis, cores e fotos existentes.

begin;

-- A tabela profiles já possui `color` e `avatar_path`. A RPC é ampliada para:
-- 1) permitir trocar a cor do avatar sem foto;
-- 2) permitir limpar avatar_path de forma explícita;
-- 3) manter compatibilidade com clientes antigos que enviam somente nome/avatar.
--
-- É necessário recriar a função porque o PostgreSQL não permite alterar a
-- assinatura de argumentos de uma função existente via CREATE OR REPLACE.
drop function if exists public.update_my_profile(text, text);

create function public.update_my_profile(
  p_name text,
  p_avatar_path text default null,
  p_color text default null,
  p_remove_avatar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_color text := upper(btrim(coalesce(p_color, '')));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if length(v_name) < 2 then
    raise exception 'Informe um nome válido';
  end if;

  if p_color is not null and v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'Cor do avatar inválida';
  end if;

  if p_avatar_path is not null
     and split_part(p_avatar_path, '/', 1) is distinct from auth.uid()::text then
    raise exception 'Caminho de avatar inválido';
  end if;

  update public.profiles
  set name = v_name,
      initials = coalesce(nullif(public.make_initials(v_name), ''), initials),
      color = case when p_color is null then color else v_color end,
      avatar_path = case
        when coalesce(p_remove_avatar, false) then null
        when p_avatar_path is not null then p_avatar_path
        else avatar_path
      end
  where id = auth.uid();
end;
$$;

revoke execute on function public.update_my_profile(text,text,text,boolean) from public, anon;
grant execute on function public.update_my_profile(text,text,text,boolean) to authenticated;

commit;
