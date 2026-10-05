\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
create or replace function expect_err(sql text, want text) returns text language plpgsql as $$
begin execute sql; return 'FAIL (sem erro, esperado '||want||')';
exception when others then return case when sqlerrm = want then 'ok '||want else 'FAIL got '||sqlerrm||' want '||want end; end $$;
create or replace function expect_eq(label text, got text, want text) returns text language sql as
$$ select case when got = want then 'ok '||label||'='||got else 'FAIL '||label||' got '||got||' want '||want end $$;

insert into profiles values ('p1','Alice','user'),('p2','Bob','user'),('adm','Admin','admin');
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T1','Cartas','ongoing','{}', jsonb_build_object('mode','packs','packSettings', jsonb_build_object(
   'rosterMax',30,
   'packs', jsonb_build_array(
     jsonb_build_object('id','bronze','label','Bronze','price',40,'cards',3,'weights',(select jsonb_object_agg(o::text, exp(-0.5*power((o-72)/3.0,2))) from generate_series(65,97) o),'unlock',null),
     jsonb_build_object('id','prata','label','Prata','price',100,'cards',3,'weights',(select jsonb_object_agg(o::text, exp(-0.5*power((o-76)/3.5,2))) from generate_series(65,97) o),'unlock',jsonb_build_object('packId','bronze','count',3)),
     jsonb_build_object('id','top','label','Top','price',1,'cards',1,'weights','{"97":1}'::jsonb,'unlock',null),
     jsonb_build_object('id','dois97','label','Dois97','price',1,'cards',2,'weights','{"97":1}'::jsonb,'unlock',null))))),
 ('M1','Mercado','ongoing','{}','{}');
insert into teams(id,tournament_id,profile_id,name,budget) values ('A','T1','p1','Alice FC',300),('B','T1','p2','Bob FC',5000),('MA','M1','p1','Alice M',300);
-- Alice começa com 23 jogadores (elenco inicial)
insert into player_ownership(tournament_id,player_id,team_id,initial_team_id,squad_role,acquisition_source,acquired_at)
 select 'T1', player_id, 'A','A','starter','initial_roster', now() from (select player_id from player_catalog where overall < 70 order by player_id limit 23) q;

select '--- 1 abrir pacote';
select expect_eq('saldo apos', (open_pack('T1','bronze','A','p1')) ->> 'balanceAfter', '260');
select expect_eq('cartas com acquisition_source=pack', (select count(*)::text from player_ownership where tournament_id='T1' and team_id='A' and acquisition_source='pack'), '3');
select expect_eq('transfers pack_pull', (select count(*)::text from transfers where transfer_type='pack_pull'), '3');
select expect_eq('lancamento financeiro', (select sum(amount)::text from financial_transactions where transaction_type='pack_purchase'), '-40');
select expect_eq('linhas no log', (select count(*)::text from pack_openings), '1');

select '--- 2 validacoes';
select expect_err($$select open_pack('T1','bronze','A','p2')$$,'not_team_owner');
select expect_err($$select open_pack('T1','bronze','A',null)$$,'not_team_owner');
select expect_err($$select open_pack('M1','bronze','MA','p1')$$,'not_packs_mode');
select expect_err($$select open_pack('T1','inexistente','A','p1')$$,'pack_not_found');
select expect_err($$select open_pack('T1','prata','A','p1')$$,'pack_locked');
select expect_err($$select open_pack('NOPE','bronze','A','p1')$$,'tournament_not_found');

select '--- 3 marco: 3 bronze (somando times) liberam a prata';
select open_pack('T1','bronze','B','p2') is not null;
select open_pack('T1','bronze','B','p2') is not null;
select expect_eq('prata liberada, saldo', (open_pack('T1','prata','A','p1')) ->> 'balanceAfter', '160');

select '--- 4 elenco cheio e saldo';
select expect_err($$select open_pack('T1','bronze','A','p1')$$,'roster_full');
update teams set budget=10 where id='B';
select expect_err($$select open_pack('T1','bronze','B','p2')$$,'insufficient_funds');
update teams set budget=1000000 where id='B';

select '--- 5 pool esgotado desfaz tudo (so existe 1 jogador 97)';
select expect_err($$select open_pack('T1','dois97','B','p2')$$,'pool_empty');
select expect_eq('nenhum 97 com Bob', (select count(*)::text from player_ownership o join player_catalog c using(player_id) where o.team_id='B' and c.overall=97), '0');
select expect_eq('saldo Bob intacto', (select budget::text from teams where id='B'), '1000000');
select expect_eq('sem log do pacote falho', (select count(*)::text from pack_openings where pack_id='dois97'), '0');

select '--- 6 jogador com dono nunca sai';
select expect_eq('sorteou o 97', open_pack('T1','top','B','p2')->'cards'->0->>'name', 'Henry');
select expect_err($$select open_pack('T1','top','B','p2')$$,'pool_empty');

select '--- 7 overrides';
insert into player_catalog_overrides(player_id,overall) select player_id,97 from player_catalog where overall=95 order by player_id limit 1;
select expect_eq('override 95->97 entra no pool', open_pack('T1','top','B','p2')->'cards'->0->>'overall', '97');
update tournaments set market_settings='{"playerOverridesEnabled":false}' where id='T1';
select expect_err($$select open_pack('T1','top','B','p2')$$,'pool_empty');
update tournaments set market_settings='{}' where id='T1';
delete from player_catalog_overrides;

select '--- 8 rollback';
select expect_err($$select rollback_pack_opening((select id from pack_openings where team_id='B' order by created_at limit 1),'p2')$$,'not_admin');
select expect_eq('reembolso', rollback_pack_opening((select id from pack_openings where team_id='B' and pack_id='bronze' order by created_at limit 1),'adm')->>'refunded', '40');
select expect_err($$select rollback_pack_opening((select id from pack_openings where rolled_back_at is not null limit 1),'adm')$$,'already_rolled_back');
select expect_eq('marco ignora revertidas', (select count(*)::text from pack_openings where pack_id='bronze' and rolled_back_at is null), '2');
delete from player_ownership where tournament_id='T1' and player_id=(select cards->0->>'playerId' from pack_openings where team_id='A' order by created_at limit 1);
select expect_err($$select rollback_pack_opening((select id from pack_openings where team_id='A' order by created_at limit 1),'adm')$$,'cards_moved');

select '--- 9 distribuicao (pesos 75:3, 78:1, 80:1; 300 cartas; esperado ~180/60/60)';
insert into tournaments(id,name,status,market_settings,raw_data) values ('T4','Dist','ongoing','{}', jsonb_build_object('mode','packs','packSettings', jsonb_build_object('rosterMax',100000,'packs', jsonb_build_array(
 jsonb_build_object('id','b','label','B','price',1,'cards',3,'weights','{"75":3,"78":1,"80":1}'::jsonb)))));
insert into teams(id,tournament_id,profile_id,name,budget) values ('E','T4','p2','E',1000000);
select count(open_pack('T4','b','E','p2')) from generate_series(1,100);
with o as (select c.overall, count(*) n from player_ownership po join player_catalog c using(player_id) where po.tournament_id='T4' group by 1)
select case when (select n from o where overall=75) between 150 and 210
             and (select n from o where overall=78) between 35 and 85
             and (select n from o where overall=80) between 35 and 85
       then 'ok distribuicao dentro do esperado' else 'FAIL distribuicao fora do esperado' end;
select expect_eq('sem jogador repetido', (select (count(*)=count(distinct player_id))::text from player_ownership where tournament_id='T4'), 'true');
