-- Cópia de public.pay_player_release_clause tal como existe no banco de produção
-- (extraída pelo supabase/INSPECT-SCHEMA.sql). Usada só nos testes do estorno da multa.
create table if not exists public.matches(
  id text primary key, tournament_id text not null references public.tournaments(id) on delete cascade,
  home_team_id text, away_team_id text, played boolean not null default false, raw_data jsonb not null default '{}');
create table if not exists public.trade_offers(
  id text primary key, tournament_id text not null references public.tournaments(id) on delete cascade,
  player_id text not null, status text not null, updated_at timestamptz, raw_data jsonb not null default '{}');

CREATE OR REPLACE FUNCTION public.pay_player_release_clause(p_tournament_id text, p_player_id text, p_player_name text, p_buyer_team_id text, p_expected_seller_team_id text, p_expected_market_value numeric, p_expected_clause_amount numeric, p_actor_profile_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments%rowtype;
  v_buyer public.teams%rowtype;
  v_seller public.teams%rowtype;
  v_owner public.player_ownership%rowtype;
  v_settings jsonb;
  v_state jsonb;
  v_shielding jsonb;
  v_contracts jsonb;
  v_suffered jsonb;
  v_shield_entry jsonb;
  v_contract jsonb;
  v_multiplier numeric;
  v_revalue numeric;
  v_protected_games integer;
  v_max_suffered integer;
  v_block_repurchase boolean;
  v_min_players integer;
  v_max_players integer;
  v_buyer_size integer;
  v_seller_size integer;
  v_min_games_enabled boolean;
  v_min_games integer;
  v_buyer_games integer;
  v_seller_games integer;
  v_contract_start integer;
  v_contract_required integer;
  v_contract_remaining integer;
  v_suffered_count integer;
  v_shield numeric;
  v_base numeric;
  v_clause numeric;
  v_new_market_value numeric;
  v_buyer_before numeric;
  v_seller_before numeric;
  v_now timestamptz:=clock_timestamp();
  v_transfer_id text;
  v_latest_from text;
  v_latest_to text;
begin
  if coalesce(p_expected_market_value,0)<=0 then raise exception 'invalid_market_value' using errcode='P0001'; end if;

  select * into v_t from public.tournaments where id=p_tournament_id for update;
  if not found then raise exception 'tournament_not_found' using errcode='P0001'; end if;
  if coalesce(v_t.status,'')='finished' then raise exception 'tournament_finished' using errcode='P0001'; end if;
  if coalesce((v_t.market_settings->>'isOpen')::boolean,true)=false then raise exception 'market_closed' using errcode='P0001'; end if;

  v_settings:=coalesce(v_t.market_settings->'releaseClause','{}'::jsonb);
  if coalesce((v_settings->>'enabled')::boolean,false)=false then raise exception 'release_clause_disabled' using errcode='P0001'; end if;
  v_multiplier:=greatest(1,coalesce(nullif(v_settings->>'multiplier','')::numeric,2));
  v_revalue:=greatest(1,coalesce(nullif(v_settings->>'revalueMultiplier','')::numeric,1.5));
  v_protected_games:=greatest(0,coalesce(nullif(v_settings->>'protectedGames','')::integer,50));
  v_max_suffered:=greatest(0,coalesce(nullif(v_settings->>'maxSufferedPerTeam','')::integer,2));
  v_block_repurchase:=coalesce((v_settings->>'blockDirectRepurchase')::boolean,true);

  select * into v_owner from public.player_ownership where tournament_id=p_tournament_id and player_id=p_player_id for update;
  if not found then raise exception 'player_not_owned' using errcode='P0001'; end if;
  if v_owner.team_id is distinct from p_expected_seller_team_id then raise exception 'owner_changed' using errcode='P0001'; end if;
  if v_owner.team_id=p_buyer_team_id then raise exception 'same_team' using errcode='P0001'; end if;

  select * into v_buyer from public.teams where tournament_id=p_tournament_id and id=p_buyer_team_id for update;
  select * into v_seller from public.teams where tournament_id=p_tournament_id and id=v_owner.team_id for update;
  if v_buyer.id is null or v_seller.id is null then raise exception 'team_not_found' using errcode='P0001'; end if;
  if v_buyer.profile_id is distinct from p_actor_profile_id then raise exception 'not_buyer_owner' using errcode='P0001'; end if;

  v_min_players:=greatest(0,coalesce(nullif(v_t.raw_data->'rosterSettings'->>'minPlayers','')::integer,nullif(v_t.raw_data->>'minPlayers','')::integer,23));
  v_max_players:=greatest(v_min_players,coalesce(nullif(v_t.raw_data->'rosterSettings'->>'maxPlayers','')::integer,nullif(v_t.raw_data->>'maxPlayers','')::integer,30));
  select count(*) into v_buyer_size from public.player_ownership where tournament_id=p_tournament_id and team_id=p_buyer_team_id;
  select count(*) into v_seller_size from public.player_ownership where tournament_id=p_tournament_id and team_id=v_seller.id;
  if v_buyer_size>=v_max_players then raise exception 'buyer_roster_full' using errcode='P0001'; end if;
  if v_seller_size<=v_min_players then raise exception 'seller_min_roster' using errcode='P0001'; end if;

  v_min_games_enabled:=coalesce((v_t.market_settings->'minimumGamesForMarket'->>'enabled')::boolean,false);
  v_min_games:=greatest(0,coalesce(nullif(v_t.market_settings->'minimumGamesForMarket'->>'gamesRequired','')::integer,0));
  select count(*) into v_buyer_games from public.matches where tournament_id=p_tournament_id and played=true and (home_team_id=p_buyer_team_id or away_team_id=p_buyer_team_id) and coalesce(raw_data->>'bye','false')<>'true';
  select count(*) into v_seller_games from public.matches where tournament_id=p_tournament_id and played=true and (home_team_id=v_seller.id or away_team_id=v_seller.id) and coalesce(raw_data->>'bye','false')<>'true';
  if v_min_games_enabled and (v_buyer_games<v_min_games or v_seller_games<v_min_games) then raise exception 'minimum_games_market' using errcode='P0001'; end if;

  v_state:=coalesce(v_t.raw_data->'releaseClauseState','{}'::jsonb);
  v_contracts:=coalesce(v_state->'contracts','{}'::jsonb);
  v_contract:=coalesce(v_contracts->p_player_id,'{}'::jsonb);
  if coalesce(v_contract->>'teamId','')=v_seller.id then
    v_contract_start:=greatest(0,coalesce(nullif(v_contract->>'startGames','')::integer,0));
    v_contract_required:=greatest(0,coalesce(nullif(v_contract->>'gamesRequired','')::integer,0));
    v_contract_remaining:=greatest(0,v_contract_required-(v_seller_games-v_contract_start));
    if v_contract_remaining>0 then raise exception 'contract_protected' using errcode='P0001'; end if;
  end if;

  v_suffered:=coalesce(v_state->'sufferedByTeam','{}'::jsonb);
  v_suffered_count:=greatest(0,coalesce(nullif(v_suffered->>v_seller.id,'')::integer,0));
  if v_max_suffered>0 and v_suffered_count>=v_max_suffered then raise exception 'seller_clause_limit' using errcode='P0001'; end if;

  if v_block_repurchase then
    select from_team_id,to_team_id into v_latest_from,v_latest_to
    from public.transfers
    where tournament_id=p_tournament_id and player_id=p_player_id and to_team_id=v_seller.id
      and coalesce(raw_data->>'rolledBackAt','')=''
    order by created_at desc nulls last limit 1;
    if v_latest_from=p_buyer_team_id and v_latest_to=v_seller.id then raise exception 'direct_repurchase_blocked' using errcode='P0001'; end if;
  end if;

  v_shielding:=coalesce(v_state->'shielding','{}'::jsonb);
  v_shield_entry:=coalesce(v_shielding->p_player_id,'{}'::jsonb);
  v_shield:=case when coalesce(v_shield_entry->>'teamId','')=v_seller.id then greatest(0,coalesce(nullif(v_shield_entry->>'amount','')::numeric,0)) else 0 end;
  v_base:=ceil(p_expected_market_value*v_multiplier);
  v_clause:=ceil(v_base+v_shield);
  if abs(v_clause-coalesce(p_expected_clause_amount,0))>0.001 then raise exception 'clause_changed' using errcode='P0001'; end if;
  if coalesce(v_buyer.budget,0)<v_clause then raise exception 'insufficient_funds' using errcode='P0001'; end if;

  v_new_market_value:=ceil(p_expected_market_value*v_revalue);
  v_buyer_before:=coalesce(v_buyer.budget,0); v_seller_before:=coalesce(v_seller.budget,0);
  update public.teams set budget=v_buyer_before-v_clause where tournament_id=p_tournament_id and id=v_buyer.id;
  update public.teams set budget=v_seller_before+v_clause where tournament_id=p_tournament_id and id=v_seller.id;

  update public.player_ownership set team_id=v_buyer.id,for_sale=false,acquisition_source='release_clause',acquired_at=v_now,raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('releaseClause',true,'previousTeamId',v_seller.id,'clausePaid',v_clause,'marketValueBefore',p_expected_market_value,'marketValueAfter',v_new_market_value)
  where tournament_id=p_tournament_id and player_id=p_player_id;

  update public.trade_offers set status='invalid',updated_at=v_now,raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('invalidReason','release_clause')
  where tournament_id=p_tournament_id and player_id=p_player_id and status in ('pending','countered');

  v_transfer_id:='release_clause_'||substr(md5(p_tournament_id||':'||p_player_id||':'||extract(epoch from v_now)::text),1,20);
  insert into public.transfers(id,tournament_id,player_id,player_name,transfer_type,from_team_id,to_team_id,offer_id,price,market_value,depreciation_pct,transfer_date,created_at,raw_data)
  values(v_transfer_id,p_tournament_id,p_player_id,coalesce(nullif(p_player_name,''),'Jogador'),'release_clause',v_seller.id,v_buyer.id,null,v_clause,p_expected_market_value,null,to_char(v_now at time zone 'America/Sao_Paulo','DD/MM/YYYY'),v_now,jsonb_build_object('newMarketValue',v_new_market_value,'shieldingUsed',v_shield,'protectedGames',v_protected_games));

  insert into public.financial_transactions(id,tournament_id,team_id,transaction_type,amount,balance_before,balance_after,label,reference_id,operation_id,created_at,raw_data)
  values
    ('release_clause_buy_'||substr(md5(v_transfer_id||':buy'),1,20),p_tournament_id,v_buyer.id,'release_clause_purchase',-v_clause,v_buyer_before,v_buyer_before-v_clause,'Multa rescisoria - '||coalesce(p_player_name,'Jogador'),v_transfer_id,gen_random_uuid(),v_now,jsonb_build_object('playerId',p_player_id,'sellerTeamId',v_seller.id)),
    ('release_clause_sell_'||substr(md5(v_transfer_id||':sell'),1,20),p_tournament_id,v_seller.id,'release_clause_sale',v_clause,v_seller_before,v_seller_before+v_clause,'Multa rescisoria - '||coalesce(p_player_name,'Jogador'),v_transfer_id,gen_random_uuid(),v_now,jsonb_build_object('playerId',p_player_id,'buyerTeamId',v_buyer.id));

  update public.player_catalog_overrides set market_value=v_new_market_value,updated_by_profile_id=p_actor_profile_id,updated_at=v_now where player_id=p_player_id;
  if not found then
    insert into public.player_catalog_overrides(player_id,overall,market_value,attack,defense,attributes,updated_by_profile_id,updated_at) values(p_player_id,null,v_new_market_value,null,null,'{}'::jsonb,p_actor_profile_id,v_now);
  end if;

  v_shielding:=v_shielding-p_player_id;
  v_contracts:=jsonb_set(v_contracts,array[p_player_id],jsonb_build_object('teamId',v_buyer.id,'startGames',v_buyer_games,'gamesRequired',v_protected_games,'startedAt',floor(extract(epoch from v_now)*1000)::bigint,'source','release_clause'),true);
  v_suffered:=jsonb_set(v_suffered,array[v_seller.id],to_jsonb(v_suffered_count+1),true);
  v_state:=jsonb_set(v_state,'{shielding}',v_shielding,true);
  v_state:=jsonb_set(v_state,'{contracts}',v_contracts,true);
  v_state:=jsonb_set(v_state,'{sufferedByTeam}',v_suffered,true);
  update public.tournaments set raw_data=jsonb_set(coalesce(raw_data,'{}'::jsonb),'{releaseClauseState}',v_state,true) where id=p_tournament_id;

  return jsonb_build_object('ok',true,'transferId',v_transfer_id,'playerId',p_player_id,'sellerTeamId',v_seller.id,'buyerTeamId',v_buyer.id,'clausePaid',v_clause,'newMarketValue',v_new_market_value,'protectedGames',v_protected_games,'sellerSufferedCount',v_suffered_count+1);
end;
$function$;
