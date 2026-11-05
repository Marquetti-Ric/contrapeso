\set ON_ERROR_STOP 1
-- usuários
insert into auth.users(id,email,email_confirmed_at,last_sign_in_at,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','alice@a.com',now(),now(),'{"nome":"Alice","empresa_nome":"Mercado A","empresa_cnpj":"11.111.111/0001-11"}'),
 ('00000000-0000-0000-0000-00000000000b','bob@b.com',now(),now(),'{"nome":"Bob","empresa_nome":"Mercado B"}'),
 ('00000000-0000-0000-0000-00000000000c','carol@a.com',now(),null,'{}'),
 ('00000000-0000-0000-0000-00000000000d','dan@a.com',now(),now(),'{}'),
 ('00000000-0000-0000-0000-0000000000ff','MarquettiRic@gmail.com',now(),now(),'{}'),
 ('00000000-0000-0000-0000-0000000000ee','falso@x.com',null,null,'{}');
-- convites (feitos pela função com chave de serviço)
set role service_role;
insert into public.membros(empresa_id,user_id,email,papel)
  select id,'00000000-0000-0000-0000-00000000000c','carol@a.com','leitor' from public.empresas where nome='Mercado A';
insert into public.membros(empresa_id,user_id,email,papel)
  select id,'00000000-0000-0000-0000-00000000000d','dan@a.com','editor' from public.empresas where nome='Mercado A';
select public.id_por_email('CAROL@a.com') = '00000000-0000-0000-0000-00000000000c' as id_por_email_ok;
reset role;

create temp table r(t text, ok boolean);
grant all on r to authenticated, anon;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.empresa(n text) returns uuid language sql as $$ select id from public.empresas where nome=n $$;
\set A '(select id from public.empresas where nome=''Mercado A'')'

-- guarda ids antes de mudar de papel
select pg_temp.empresa('Mercado A') as ea \gset
select pg_temp.empresa('Mercado B') as eb \gset
select cnpj='11111111000111' as cnpj_limpo from public.empresas where id=:'ea';

-- ALICE (admin A)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into r select 'alice vê só A', (select array_agg(nome) from public.empresas)=array['Mercado A'];
insert into r select 'alice minhas_empresas', (select array_agg(nome||':'||papel) from public.minhas_empresas())=array['Mercado A:admin'];
insert into r select 'alice salva A', public.salvar_dados(:'ea','negociador','{"items":[1]}',0)=1;
insert into r select 'alice salva A v2', public.salvar_dados(:'ea','negociador','{"items":[1,2]}',1)=2;
insert into r select 'alice usuarios de B vazio', (select count(*) from public.usuarios_da_empresa(:'eb'))=0;
insert into r select 'alice usuarios de A', (select count(*) from public.usuarios_da_empresa(:'ea'))=3;
insert into r select 'carol pendente', (select situacao from public.usuarios_da_empresa(:'ea') where email='carol@a.com')='convite pendente';
with u as (update public.empresas set nome='hack' where id=:'eb' returning 1) insert into r select 'alice não altera B', count(*)=0 from u;
reset role;
do $$ begin
  set local role authenticated;
  perform public.salvar_dados((select id from public.empresas where nome='Mercado B'),'negociador','{}',0);
  insert into r values ('alice NÃO salva em B', false);
exception when insufficient_privilege then insert into r values ('alice NÃO salva em B', true); end $$;
do $$ begin
  set local role authenticated;
  perform public.salvar_dados((select id from public.empresas where nome='Mercado A'),'negociador','{}',1);
  insert into r values ('conflito de versão detectado', false);
exception when sqlstate 'P0002' then insert into r values ('conflito de versão detectado', true); end $$;
do $$ begin
  set local role authenticated;
  delete from public.membros where user_id='00000000-0000-0000-0000-00000000000a';
  insert into r values ('último admin protegido', false);
exception when sqlstate 'P0001' then insert into r values ('último admin protegido', true); end $$;
do $$ begin
  set local role authenticated;
  perform 1 from public.masters;
  insert into r values ('masters inacessível', false);
exception when insufficient_privilege then insert into r values ('masters inacessível', true); end $$;

-- BOB (admin B)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set role authenticated;
insert into r select 'bob não vê dados de A', (select count(*) from public.dados)=0;
insert into r select 'bob não vê membros de A', (select count(*) from public.membros where empresa_id=:'ea')=0;
with u as (update public.membros set papel='admin' where empresa_id=:'ea' returning 1) insert into r select 'bob não promove em A', count(*)=0 from u;
insert into r select 'bob cria 2a empresa', public.criar_empresa('Mercado B2','22.222.222/0001-22') is not null;
insert into r select 'bob vê 2 empresas', (select count(*) from public.minhas_empresas())=2;
reset role;

-- CAROL (leitor A)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set role authenticated;
insert into r select 'leitor lê A', (select conteudo->'items' from public.dados where empresa_id=:'ea')='[1,2]'::jsonb;
reset role;
do $$ begin
  set local role authenticated;
  perform public.salvar_dados((select id from public.empresas where nome='Mercado A'),'negociador','{}',2);
  insert into r values ('leitor não grava', false);
exception when insufficient_privilege then insert into r values ('leitor não grava', true); end $$;
set role authenticated;
with u as (update public.dados set conteudo='{}' returning 1) insert into r select 'leitor não altera direto', count(*)=0 from u;
reset role;

-- DAN (editor A)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
set role authenticated;
insert into r select 'editor grava', public.salvar_dados(:'ea','simulador','{"x":1}',0)=1;
with u as (update public.membros set papel='admin' where user_id='00000000-0000-0000-0000-00000000000d' returning 1) insert into r select 'editor não se promove', count(*)=0 from u;
reset role;

-- ALICE promove dan e sai
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
with u as (update public.membros set papel='admin' where user_id='00000000-0000-0000-0000-00000000000d' and empresa_id=:'ea' returning 1) insert into r select 'admin promove', count(*)=1 from u;
with u as (delete from public.membros where user_id='00000000-0000-0000-0000-00000000000a' returning 1) insert into r select 'admin sai com outro admin', count(*)=1 from u;
insert into r select 'alice perde acesso', (select count(*) from public.empresas)=0;
reset role;

-- MASTER
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
set role authenticated;
insert into r select 'master vê todas', (select count(*) from public.minhas_empresas())=3 and (select bool_and(papel='master') from public.minhas_empresas());
insert into r select 'master lê A', (select count(*) from public.dados where empresa_id=:'ea')=2;
insert into r select 'master grava em B', public.salvar_dados(:'eb','negociador','{"m":1}',0)=1;
insert into r select 'eu().master', (public.eu()->>'master')::boolean;
reset role;

-- e-mail não confirmado não é master
insert into public.masters values ('falso@x.com');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ee');
set role authenticated;
insert into r select 'master sem e-mail confirmado bloqueado', not public.is_master() and (select count(*) from public.empresas)=0;
reset role;

-- ANON
select pg_temp.as_user('');
do $$ begin
  set local role anon;
  perform 1 from public.empresas;
  insert into r values ('anônimo bloqueado', false);
exception when insufficient_privilege then insert into r values ('anônimo bloqueado', true); end $$;

-- exclusão de empresa em cascata (master)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
set role authenticated;
with u as (delete from public.empresas where nome='Mercado B2' returning 1) insert into r select 'master exclui empresa', count(*)=1 from u;
reset role;

select t, ok from r order by ok, t;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception 'Há regras de isolamento falhando.'; end if; end $$;
