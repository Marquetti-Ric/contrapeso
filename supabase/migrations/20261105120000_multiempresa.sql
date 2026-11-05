-- Contrapeso multiempresa
-- Cada empresa só enxerga os próprios dados. O isolamento é garantido no banco (Row Level Security),
-- não na tela. Usuários master (tabela masters) enxergam e administram todas as empresas.

create table if not exists public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 2 and 120),
  cnpj        text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  criada_em   timestamptz not null default now(),
  criada_por  uuid references auth.users(id) on delete set null
);

create table if not exists public.membros (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  nome        text,
  papel       text not null check (papel in ('admin','editor','leitor')),
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index if not exists membros_user_idx on public.membros(user_id);

create table if not exists public.masters (
  email text primary key check (email = lower(email))
);
insert into public.masters(email) values ('marquettiric@gmail.com') on conflict do nothing;

create table if not exists public.dados (
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  ferramenta     text not null check (ferramenta in ('simulador','negociador')),
  conteudo       jsonb not null default '{}'::jsonb,
  versao         integer not null default 1,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  primary key (empresa_id, ferramenta)
);

-- ---------- funções de permissão ----------
create or replace function public.is_master() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.masters m join auth.users u on lower(u.email) = m.email
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create or replace function public.papel_em(p_empresa uuid) returns text
language sql stable security definer set search_path = public as $$
  select papel from public.membros where empresa_id = p_empresa and user_id = auth.uid();
$$;

create or replace function public.pode_ler(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_master() or public.papel_em(p_empresa) is not null;
$$;

create or replace function public.pode_editar(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_master() or coalesce(public.papel_em(p_empresa) in ('admin','editor'), false);
$$;

create or replace function public.e_admin(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_master() or coalesce(public.papel_em(p_empresa) = 'admin', false);
$$;

-- ---------- RLS ----------
alter table public.empresas enable row level security;
alter table public.membros  enable row level security;
alter table public.masters  enable row level security;
alter table public.dados    enable row level security;

drop policy if exists empresas_ler on public.empresas;
drop policy if exists empresas_alterar on public.empresas;
drop policy if exists empresas_excluir on public.empresas;
create policy empresas_ler     on public.empresas for select to authenticated using (public.pode_ler(id));
create policy empresas_alterar on public.empresas for update to authenticated using (public.e_admin(id)) with check (public.e_admin(id));
create policy empresas_excluir on public.empresas for delete to authenticated using (public.is_master());

drop policy if exists membros_ler on public.membros;
drop policy if exists membros_alterar on public.membros;
drop policy if exists membros_excluir on public.membros;
create policy membros_ler     on public.membros for select to authenticated using (public.pode_ler(empresa_id));
create policy membros_alterar on public.membros for update to authenticated using (public.e_admin(empresa_id)) with check (public.e_admin(empresa_id));
create policy membros_excluir on public.membros for delete to authenticated using (public.e_admin(empresa_id) or user_id = auth.uid());

drop policy if exists dados_ler on public.dados;
drop policy if exists dados_inserir on public.dados;
drop policy if exists dados_alterar on public.dados;
drop policy if exists dados_excluir on public.dados;
create policy dados_ler     on public.dados for select to authenticated using (public.pode_ler(empresa_id));
create policy dados_inserir on public.dados for insert to authenticated with check (public.pode_editar(empresa_id));
create policy dados_alterar on public.dados for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy dados_excluir on public.dados for delete to authenticated using (public.e_admin(empresa_id));
-- masters: sem políticas = ninguém lê nem altera pela API.

revoke all on public.empresas, public.membros, public.masters, public.dados from anon;
revoke all on public.masters from authenticated;
grant select, update, delete on public.empresas to authenticated;
grant select, update, delete on public.membros  to authenticated;
grant select, insert, update, delete on public.dados to authenticated;

-- membros: só papel e nome podem mudar; a empresa precisa manter pelo menos um admin
create or replace function public.membros_protege() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.empresa_id <> old.empresa_id or new.user_id <> old.user_id or new.email <> old.email then
      raise exception 'Só o papel e o nome do usuário podem ser alterados.' using errcode = '42501';
    end if;
  end if;
  if old.papel = 'admin' and (tg_op = 'DELETE' or new.papel <> 'admin')
     and exists (select 1 from public.empresas where id = old.empresa_id)
     and not exists (select 1 from public.membros where empresa_id = old.empresa_id and papel = 'admin' and user_id <> old.user_id) then
    raise exception 'A empresa precisa ter pelo menos um administrador.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists membros_protege on public.membros;
create trigger membros_protege before update or delete on public.membros
  for each row execute function public.membros_protege();

-- dados: carimbo de quem alterou e quando
create or replace function public.dados_carimbo() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists dados_carimbo on public.dados;
create trigger dados_carimbo before insert or update on public.dados
  for each row execute function public.dados_carimbo();

-- ---------- cadastro: quem se cadastra com "empresa_nome" cria a empresa e vira admin ----------
create or replace function public.ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_cnpj text;
begin
  if coalesce(new.raw_user_meta_data ->> 'empresa_nome', '') <> '' then
    v_cnpj := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'empresa_cnpj', ''), '\D', '', 'g'), '');
    if v_cnpj is not null and length(v_cnpj) <> 14 then v_cnpj := null; end if;
    insert into public.empresas(nome, cnpj, criada_por)
      values (left(btrim(new.raw_user_meta_data ->> 'empresa_nome'), 120), v_cnpj, new.id)
      returning id into v_empresa;
    insert into public.membros(empresa_id, user_id, email, nome, papel)
      values (v_empresa, new.id, lower(new.email), new.raw_user_meta_data ->> 'nome', 'admin');
  end if;
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- ---------- RPCs usadas pelas telas ----------
create or replace function public.criar_empresa(p_nome text, p_cnpj text default null) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_empresa uuid; v_email text; v_cnpj text;
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  v_cnpj := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  insert into public.empresas(nome, cnpj, criada_por) values (btrim(p_nome), v_cnpj, auth.uid()) returning id into v_empresa;
  insert into public.membros(empresa_id, user_id, email, papel) values (v_empresa, auth.uid(), v_email, 'admin');
  return v_empresa;
end $$;

create or replace function public.minhas_empresas()
returns table(id uuid, nome text, cnpj text, papel text, membros bigint)
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, e.cnpj,
         coalesce(m.papel, 'master') as papel,
         (select count(*) from public.membros x where x.empresa_id = e.id) as membros
  from public.empresas e
  left join public.membros m on m.empresa_id = e.id and m.user_id = auth.uid()
  where m.user_id is not null or public.is_master()
  order by e.nome;
$$;

create or replace function public.eu() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'nome', u.raw_user_meta_data ->> 'nome', 'master', public.is_master())
  from auth.users u where u.id = auth.uid();
$$;

create or replace function public.usuarios_da_empresa(p_empresa uuid)
returns table(user_id uuid, email text, nome text, papel text, situacao text, ultimo_acesso timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, m.email, coalesce(m.nome, u.raw_user_meta_data ->> 'nome'), m.papel,
         case when u.last_sign_in_at is null then 'convite pendente' else 'ativo' end,
         u.last_sign_in_at
  from public.membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and public.pode_ler(p_empresa)
  order by m.papel, m.email;
$$;

create or replace function public.salvar_dados(p_empresa uuid, p_ferramenta text, p_conteudo jsonb, p_versao integer)
returns integer language plpgsql security invoker set search_path = public as $$
declare v integer;
begin
  if not public.pode_editar(p_empresa) then
    raise exception 'Seu perfil permite só consultar os dados desta empresa.' using errcode = '42501';
  end if;
  insert into public.dados as d (empresa_id, ferramenta, conteudo)
    values (p_empresa, p_ferramenta, p_conteudo)
  on conflict (empresa_id, ferramenta) do update
    set conteudo = excluded.conteudo, versao = d.versao + 1
    where d.versao = p_versao
  returning d.versao into v;
  if v is null then
    raise exception 'conflito' using errcode = 'P0002', hint = 'Outra pessoa salvou antes. Recarregue os dados.';
  end if;
  return v;
end $$;

-- uso exclusivo da função de convites (chave de serviço)
create or replace function public.id_por_email(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_master(), public.papel_em(uuid), public.pode_ler(uuid), public.pode_editar(uuid), public.e_admin(uuid),
  public.criar_empresa(text, text), public.minhas_empresas(), public.eu(), public.usuarios_da_empresa(uuid),
  public.salvar_dados(uuid, text, jsonb, integer) to authenticated;
revoke execute on function public.id_por_email(text) from authenticated;
grant execute on function public.id_por_email(text) to service_role;
