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
   'rosterMax',30,'unlocksEnabled',true,
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

select '--- 2b guarda de versao do catalogo';
select expect_err($$select open_pack('T1','bronze','A','p1','checksum-velho')$$,'catalog_outdated');
select expect_eq('checksum correto passa', (open_pack('T1','bronze','A','p1',(select source_checksum from player_catalog_meta)) ->> 'balanceAfter'), '220');
select rollback_pack_opening((select id from pack_openings where team_id='A' order by created_at desc limit 1),'adm') is not null;

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

select '--- 10 catalogos diferentes (ids colidem de proposito com o default)';
-- catalogo "alt": conjunto diferente; o id '195' (Henry no default) aqui e outro jogador
insert into player_catalog(catalog_id,player_id,name,position,overall,value) values
 ('alt','195','Alt Star','CF',99,500),('alt','A1','Alt Mid','CM',60,5),('alt','A2','Alt Mid 2','CM',60,5),('alt','A3','Alt Mid 3','CM',60,5);
insert into player_catalog_meta(catalog_id,player_count,source_checksum) values ('alt',4,'alt-sum');
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T6','Alt','ongoing','{}', jsonb_build_object('mode','packs','catalogId','alt','packSettings', jsonb_build_object('rosterMax',30,'packs', jsonb_build_array(
   jsonb_build_object('id','star','label','Star','price',1,'cards',1,'weights','{"99":1}'::jsonb),
   jsonb_build_object('id','mid','label','Mid','price',1,'cards',3,'weights','{"60":1}'::jsonb))))),
 ('T7','SemCatalogo','ongoing','{}', jsonb_build_object('mode','packs','catalogId','nope','packSettings', jsonb_build_object('rosterMax',30,'packs', jsonb_build_array(
   jsonb_build_object('id','mid','label','Mid','price',1,'cards',1,'weights','{"60":1}'::jsonb)))));
insert into teams(id,tournament_id,profile_id,name,budget) values ('X','T6','p1','X',100),('Y','T7','p1','Y',100);
-- override global no id '195' (default: Henry). Nao pode afetar o catalogo alt.
insert into player_catalog_overrides(player_id,overall) values ('195',50);
-- (com o override 195->50 ativo, o Alt Star de 99 ainda sai: overrides nao valem fora do default)
select expect_eq('alt sorteia so do proprio catalogo e ignora override', open_pack('T6','star','X','p1')->'cards'->0->>'name', 'Alt Star');
delete from player_catalog_overrides where player_id='195';
select expect_err($$select open_pack('T6','star','X','p1')$$,'pool_empty');
select expect_err($$select open_pack('T7','mid','Y','p1')$$,'catalog_not_loaded');
select expect_err($$select open_pack('T6','mid','X','p1','checksum-do-default')$$,'catalog_outdated');
select expect_eq('checksum do alt passa', jsonb_array_length(open_pack('T6','mid','X','p1','alt-sum')->'cards')::text, '3');
select expect_eq('mesmo id 195 pode pertencer no T6 sem conflito com outros torneios', (select count(*)::text from player_ownership where tournament_id='T6' and player_id='195'), '1');

select '--- 11 time orfao (profile_id nulo) nao pode ser gasto';
insert into teams(id,tournament_id,profile_id,name,budget) values ('ORF','T6',null,'Orfao',100);
select expect_err($$select open_pack('T6','mid','ORF',null)$$,'not_team_owner');
select expect_err($$select open_pack('T6','mid','ORF','p1')$$,'not_team_owner');
select expect_eq('saldo do orfao intacto', (select budget::text from teams where id='ORF'), '100');

select '--- 12 limite do elenco vem do rosterSettings do campeonato (nao do packSettings legado)';
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T8','Limite40','ongoing','{}', jsonb_build_object('mode','packs','rosterSettings',jsonb_build_object('minPlayers',23,'maxPlayers',40),
   'packSettings', jsonb_build_object('rosterMax',30,'packs', jsonb_build_array(
     jsonb_build_object('id','b','label','B','price',1,'cards',3,'weights','{"75":1}'::jsonb)))));
insert into teams(id,tournament_id,profile_id,name,budget) values ('L','T8','p1','L',100);
insert into player_ownership(tournament_id,player_id,team_id,acquisition_source,acquired_at)
 select 'T8', player_id, 'L','initial_roster', now() from (select player_id from player_catalog where catalog_id='default' and overall < 74 order by player_id limit 35) q;
select expect_eq('35+3=38 <= 40 abre mesmo com packSettings.rosterMax=30', jsonb_array_length(open_pack('T8','b','L','p1')->'cards')::text, '3');
select expect_eq('elenco de partida tem 35 + 3 da abertura', (select count(*)::text from player_ownership where tournament_id='T8' and team_id='L'), '38');
select expect_err($$select open_pack('T8','b','L','p1')$$,'roster_full');

select '--- 13 marcos desligados por padrao (unlocksEnabled ausente): pacote com unlock abre direto';
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T9','SemMarcos','ongoing','{}', jsonb_build_object('mode','packs','rosterSettings',jsonb_build_object('minPlayers',23,'maxPlayers',40),
   'packSettings', jsonb_build_object('packs', jsonb_build_array(
     jsonb_build_object('id','prata','label','Prata','price',1,'cards',3,'weights','{"75":1}'::jsonb,'unlock',jsonb_build_object('packId','bronze','count',50))))));
insert into teams(id,tournament_id,profile_id,name,budget) values ('M9','T9','p1','M9',100);
select expect_eq('prata abre sem cumprir o marco', jsonb_array_length(open_pack('T9','prata','M9','p1')->'cards')::text, '3');

select '--- 14 estorno de multa rescisoria (usa a pay_player_release_clause real)';
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T10','Multa','ongoing', jsonb_build_object('isOpen',true,'releaseClause',jsonb_build_object('enabled',true,'multiplier',2,'revalueMultiplier',1.5,'protectedGames',50,'maxSufferedPerTeam',2,'blockDirectRepurchase',false)),
 jsonb_build_object('rosterSettings',jsonb_build_object('minPlayers',23,'maxPlayers',30)));
insert into teams(id,tournament_id,profile_id,name,budget) values ('SEL','T10','p2','Vendedor',100),('BUY','T10','p1','Comprador',500);
-- vendedor com 24 jogadores (o primeiro e o alvo da multa); comprador com 5
insert into player_ownership(tournament_id,player_id,team_id,acquisition_source,acquired_at)
 select 'T10', player_id, 'SEL','initial_roster', now() from (select player_id from player_catalog where catalog_id='default' order by player_id limit 24) q;
insert into player_ownership(tournament_id,player_id,team_id,acquisition_source,acquired_at)
 select 'T10', player_id, 'BUY','initial_roster', now() from (select player_id from player_catalog where catalog_id='default' order by player_id offset 100 limit 5) q;
create temp table _rc as select player_id pid from player_catalog where catalog_id='default' order by player_id limit 1;
insert into player_catalog_overrides(player_id,overall,market_value) select pid,null,50 from _rc;
select expect_eq('multa paga (2 x 50 = 100)', (pay_player_release_clause('T10',(select pid from _rc),'Alvo','BUY','SEL',50,100,'p1')->>'clausePaid'), '100');
select expect_eq('apos pagar: saldos comprador/vendedor', (select string_agg(id||'='||budget, ' ' order by id) from teams where tournament_id='T10'), 'BUY=400 SEL=200');
select expect_eq('apos pagar: valor de mercado reavaliado', (select market_value::text from player_catalog_overrides where player_id=(select pid from _rc)), '75');

select expect_err($$select rollback_release_clause((select id from transfers where transfer_type='release_clause' and tournament_id='T10'),'p2')$$,'not_admin');
select expect_err($$select rollback_release_clause('inexistente','adm')$$,'transfer_not_found');
select expect_eq('estorno devolve a multa', (rollback_release_clause((select id from transfers where transfer_type='release_clause' and tournament_id='T10'),'adm')->>'refunded'), '100');
select expect_eq('apos estorno: saldos voltaram', (select string_agg(id||'='||budget, ' ' order by id) from teams where tournament_id='T10'), 'BUY=500 SEL=100');
select expect_eq('apos estorno: jogador voltou ao vendedor', (select team_id from player_ownership where tournament_id='T10' and player_id=(select pid from _rc)), 'SEL');
select expect_eq('apos estorno: fonte de aquisicao', (select acquisition_source from player_ownership where tournament_id='T10' and player_id=(select pid from _rc)), 'rollback');
select expect_eq('apos estorno: valor de mercado restaurado', (select market_value::text from player_catalog_overrides where player_id=(select pid from _rc)), '50');
select expect_eq('apos estorno: contrato do comprador removido', (select (not (raw_data->'releaseClauseState'->'contracts' ? (select pid from _rc)))::text from tournaments where id='T10'), 'true');
select expect_eq('apos estorno: multa sofrida do vendedor volta a 0', (select raw_data->'releaseClauseState'->'sufferedByTeam'->>'SEL' from tournaments where id='T10'), '0');
select expect_eq('apos estorno: transferencia marcada como revertida', (select (coalesce(raw_data->>'rolledBackAt','')<>'')::text from transfers where tournament_id='T10' and transfer_type='release_clause'), 'true');
select expect_eq('apos estorno: lancamentos originais marcados', (select count(*)::text from financial_transactions where tournament_id='T10' and transaction_type in ('release_clause_purchase','release_clause_sale') and coalesce(raw_data->>'rolledBackAt','')<>''), '2');
select expect_eq('apos estorno: 2 lancamentos de estorno somando zero', (select sum(amount)::text||'/'||count(*) from financial_transactions where tournament_id='T10' and transaction_type='release_clause_rollback'), '0/2');
select expect_err($$select rollback_release_clause((select id from transfers where transfer_type='release_clause' and tournament_id='T10'),'adm')$$,'already_rolled_back');

select '--- 14b estorno bloqueado se o jogador ja saiu do comprador';
select pay_player_release_clause('T10',(select pid from _rc),'Alvo','BUY','SEL',50,100,'p1') is not null;
update player_ownership set team_id='SEL' where tournament_id='T10' and player_id=(select pid from _rc);
select expect_err($$select rollback_release_clause((select id from transfers where transfer_type='release_clause' and tournament_id='T10' and coalesce(raw_data->>'rolledBackAt','')='' limit 1),'adm')$$,'player_changed');

select '--- 15 pacote de escolher 1 carta (interaction=pick)';
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T11','Pick','ongoing','{}', jsonb_build_object('mode','packs','rosterSettings',jsonb_build_object('minPlayers',1,'maxPlayers',5),
   'packSettings', jsonb_build_object('packs', jsonb_build_array(
     jsonb_build_object('id','pk','label','Pick','price',10,'cards',4,'interaction','pick','weights','{"75":1,"76":1}'::jsonb),
     jsonb_build_object('id','all','label','Todas','price',10,'cards',2,'weights','{"75":1,"76":1}'::jsonb)))));
insert into teams(id,tournament_id,profile_id,name,budget) values ('PK','T11','p1','PK',100);
select expect_err($$select open_pack('T11','pk','PK','p1',null,4)$$,'pick_required');
select expect_err($$select open_pack('T11','pk','PK','p1',null,-1)$$,'pick_required');
select expect_eq('nada foi cobrado nos erros', (select budget::text from teams where id='PK'), '100');
select open_pack('T11','pk','PK','p1',null,2) as r \gset
select expect_eq('devolve as 4 cartas', jsonb_array_length(:'r'::jsonb->'cards')::text, '4');
select expect_eq('chosenIndex', (:'r'::jsonb)->>'chosenIndex', '2');
select expect_eq('so 1 carta no elenco', (select count(*)::text from player_ownership where tournament_id='T11' and team_id='PK'), '1');
select expect_eq('a do elenco e a da posicao 2', (select player_id from player_ownership where tournament_id='T11' and team_id='PK'), (:'r'::jsonb)->'cards'->2->>'playerId');
select expect_eq('1 pack_pull', (select count(*)::text from transfers where tournament_id='T11' and transfer_type='pack_pull'), '1');
select expect_eq('cobrou o preco', (select budget::text from teams where id='PK'), '90');
select expect_eq('log guarda 4 com 1 chosen', (select count(*)||'/'||count(*) filter (where (c->>'chosen')::boolean) from pack_openings, jsonb_array_elements(cards) c where tournament_id='T11'), '4/1');
select expect_eq('4 cartas sao jogadores distintos', (select count(distinct c->>'playerId')::text from pack_openings, jsonb_array_elements(cards) c where tournament_id='T11'), '4');
-- limite do elenco conta 1 carta (max 5): da para abrir 4 vezes seguidas com 1 no elenco; o pacote "all" (2 cartas) nao
select open_pack('T11','pk','PK','p1',null,0) is not null;
select open_pack('T11','pk','PK','p1',null,3) is not null;
select open_pack('T11','pk','PK','p1',null,1) is not null;
select expect_eq('4 no elenco', (select count(*)::text from player_ownership where tournament_id='T11' and team_id='PK'), '4');
select expect_err($$select open_pack('T11','all','PK','p1')$$,'roster_full');
update teams set budget=100 where id='PK';
select rollback_pack_opening((select id from pack_openings where tournament_id='T11' order by created_at limit 1),'adm') is not null;
select expect_eq('estorno remove so a escolhida', (select count(*)::text from player_ownership where tournament_id='T11' and team_id='PK'), '3');
select expect_eq('estorno devolve o preco', (select budget::text from teams where id='PK'), '110');

select '--- 16 escolher 1 em duas etapas (abre sem indice: cobra, sorteia e reserva; pick_pack_card entrega)';
insert into player_catalog(catalog_id,player_id,name,position,overall,value) values
 ('two','T1','Two A','CM',60,10),('two','T2','Two B','CM',60,10),('two','T3','Two C','CM',60,10),('two','T4','Two D','CM',60,10),('two','T5','Two E','CM',60,10),('two','T6','Two F','CM',60,10);
insert into player_catalog_meta(catalog_id,player_count,source_checksum) values ('two',6,'two-sum');
insert into tournaments(id,name,status,market_settings,raw_data) values
 ('T12','Duas','ongoing','{}', jsonb_build_object('mode','packs','catalogId','two','rosterSettings',jsonb_build_object('minPlayers',1,'maxPlayers',2),
   'packSettings', jsonb_build_object('packs', jsonb_build_array(
     jsonb_build_object('id','pk','label','Pick','price',10,'cards',3,'interaction','pick','weights','{"60":1}'::jsonb)))));
insert into teams(id,tournament_id,profile_id,name,budget) values ('D1','T12','p1','D1',100),('D2','T12','p2','D2',100);
select open_pack('T12','pk','D1','p1') as r \gset
select expect_eq('pendente: pending=true', (:'r'::jsonb)->>'pending', 'true');
select expect_eq('pendente: 3 cartas todas chosen=false', (select count(*)::text from jsonb_array_elements((:'r'::jsonb)->'cards') c where not (c->>'chosen')::boolean), '3');
select expect_eq('pendente: cobrou o preco', (select budget::text from teams where id='D1'), '90');
select expect_eq('pendente: nenhuma posse', (select count(*)::text from player_ownership where tournament_id='T12'), '0');
select expect_eq('pendente: nenhum pack_pull', (select count(*)::text from transfers where tournament_id='T12'), '0');
-- as 3 cartas reservadas: so sobram 3 jogadores, mas o outro time nao pode sortear 3 (pool tem 3 livres de 6? -> 3 reservados + 3 livres)
select expect_eq('outro time ainda sorteia dos 3 livres', jsonb_array_length(open_pack('T12','pk','D2','p2')->'cards')::text, '3');
select expect_err($$select open_pack('T12','pk','D2','p2')$$,'pool_empty');
select expect_err($$select pick_pack_card((select id from pack_openings where team_id='D1'), 1, 'p2')$$,'not_team_owner');
select expect_err($$select pick_pack_card((select id from pack_openings where team_id='D1'), 3, 'p1')$$,'pick_required');
select expect_err($$select pick_pack_card('nope', 1, 'p1')$$,'opening_not_found');
select pick_pack_card((select id from pack_openings where team_id='D1'), 1, 'p1') as pk \gset
select expect_eq('escolha: dono recebe a carta da posicao 1', (select player_id from player_ownership where tournament_id='T12' and team_id='D1'), (:'r'::jsonb)->'cards'->1->>'playerId');
select expect_eq('escolha: marca chosen so na 1', (select string_agg((c->>'chosen'), ',' order by ord) from pack_openings, jsonb_array_elements(cards) with ordinality t(c,ord) where team_id='D1'), 'false,true,false');
select expect_eq('escolha: 1 pack_pull', (select count(*)::text from transfers where tournament_id='T12' and transfer_type='pack_pull'), '1');
select expect_err($$select pick_pack_card((select id from pack_openings where team_id='D1'), 0, 'p1')$$,'already_picked');
-- as 2 nao escolhidas voltaram ao pool: D1 abre de novo (3 cartas) -> pool = 6 - 1 dono - 3 reservados de D2 = 2 livres
select expect_err($$select open_pack('T12','pk','D1','p1')$$,'pool_empty');
-- carta reservada roubada por posse de outro (simulacao): pick falha com card_taken
update teams set budget=100 where id='D2';
delete from player_ownership where tournament_id='T12';
select open_pack('T12','pk','D2','p2') is not null;
insert into player_ownership(tournament_id,player_id,team_id,acquisition_source,acquired_at)
 select 'T12', c->>'playerId', 'D1', 'initial_roster', now() from pack_openings po, jsonb_array_elements(po.cards) c where po.team_id='D2' and po.id=(select id from pack_openings where team_id='D2' order by created_at desc limit 1) limit 1;
select expect_err($$select pick_pack_card((select id from pack_openings where team_id='D2' order by created_at desc limit 1), 0, 'p2')$$,'card_taken');
-- estorno de abertura pendente devolve o preco
select expect_eq('estorno de pendente reembolsa', rollback_pack_opening((select id from pack_openings where team_id='D2' order by created_at desc limit 1),'adm')->>'refunded', '10');

select '--- 9 pacotes de presente';
update teams set budget=777 where id='B';
delete from player_ownership where tournament_id='T1' and team_id='B';
select expect_err($$select grant_pack_gift('T1', array['B'], 'bronze', 1, 'p1')$$,'not_admin');
select expect_err($$select grant_pack_gift('T1', array['B'], 'nope', 1, 'adm')$$,'pack_not_found');
select expect_err($$select grant_pack_gift('T1', array['ZZ'], 'bronze', 1, 'adm')$$,'team_not_found');
select expect_eq('concedeu 2', grant_pack_gift('T1', array['B'], 'bronze', 2, 'adm')->>'granted', '2');
select id as g1 from pack_gifts where team_id='B' order by id limit 1 \gset
select id as g2 from pack_gifts where team_id='B' order by id offset 1 limit 1 \gset
select expect_err($$select open_pack('T1','bronze','B','p2',null,null,'nope')$$,'gift_not_found');
select expect_err($$select open_pack('T1','prata','B','p2',null,null,'$$ || :'g1' || $$')$$,'gift_mismatch') where false;
select expect_err('select open_pack(''T1'',''bronze'',''A'',''p1'',null,null,'''||:'g1'||''')','gift_mismatch');
select expect_err('select open_pack(''T1'',''bronze'',''B'',''p1'',null,null,'''||:'g1'||''')','not_team_owner');
select open_pack('T1','bronze','B','p2',null,null,:'g1') as gr \gset
select expect_eq('presente: saldo intacto', (:'gr'::jsonb)->>'balanceAfter', '777');
select expect_eq('presente: preco 0', (:'gr'::jsonb)->>'price', '0');
select expect_eq('presente: 3 cartas', (select count(*)::text from player_ownership where tournament_id='T1' and team_id='B'), '3');
select expect_err('select open_pack(''T1'',''bronze'',''B'',''p2'',null,null,'''||:'g1'||''')','gift_unavailable');
select expect_err($$select revoke_pack_gift((select id from pack_gifts where used_opening_id is not null limit 1),'adm')$$,'gift_already_used');
select expect_eq('revogou o outro', revoke_pack_gift(:'g2','adm')->>'ok', 'true');
select expect_err('select open_pack(''T1'',''bronze'',''B'',''p2'',null,null,'''||:'g2'||''')','gift_unavailable');
select rollback_pack_opening((:'gr'::jsonb)->>'openingId','adm') is not null;
select expect_eq('estorno devolve o presente', (select (used_opening_id is null)::text from pack_gifts where id=:'g1'), 'true');
select expect_eq('estorno nao mexe no saldo', (select budget::text from teams where id='B'), '777');
