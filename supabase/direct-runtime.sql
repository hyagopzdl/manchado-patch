begin;

create or replace function public.direct_ms(v jsonb)
returns timestamptz
language sql
immutable
as $$
  select case
    when v is null or v = 'null'::jsonb or trim(both '"' from v::text) = '' then null
    else to_timestamp((trim(both '"' from v::text))::double precision / 1000.0)
  end
$$;

create or replace function public.sync_profile_document(p_id text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_value is null or p_value = 'null'::jsonb then
    delete from public.profiles where id = p_id;
    return;
  end if;

  insert into public.profiles(
    id,name,color,avatar,role,active,pin_hash,pin_updated_at,
    recovered_from_tournament,recovered_at,created_at,updated_at,raw_data
  ) values (
    p_id,
    coalesce(nullif(p_value->>'name',''),'Perfil'),
    p_value->>'color',
    p_value->>'avatar',
    coalesce(nullif(p_value->>'role',''),'player'),
    coalesce((p_value->>'active')::boolean,true),
    nullif(p_value->>'pinHash',''),
    public.direct_ms(p_value->'pinUpdatedAt'),
    coalesce((p_value->>'recoveredFromTournament')::boolean,false),
    public.direct_ms(p_value->'recoveredAt'),
    coalesce(public.direct_ms(p_value->'createdAt'),now()),
    now(),
    '{}'::jsonb
  )
  on conflict (id) do update set
    name=excluded.name,color=excluded.color,avatar=excluded.avatar,role=excluded.role,
    active=excluded.active,pin_hash=excluded.pin_hash,pin_updated_at=excluded.pin_updated_at,
    recovered_from_tournament=excluded.recovered_from_tournament,recovered_at=excluded.recovered_at,
    updated_at=now(),raw_data='{}'::jsonb;
end;
$$;

create or replace function public.sync_tournament_document(p_id text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  child jsonb;
  k text;
  ord bigint;
  offer_id text;
  teams_json jsonb := coalesce(p_value#>'{context,teams}','[]'::jsonb);
  matches_json jsonb := coalesce(p_value#>'{context,matches}',p_value->'matches','[]'::jsonb);
begin
  if p_value is null or p_value = 'null'::jsonb then
    delete from public.tournaments where id = p_id;
    return;
  end if;

  insert into public.tournaments(
    id,name,format,type,status,champion,cup_stage,groups_data,cup_snapshot,final_standings,
    economy_settings,final_prize_settings,market_balance_settings,market_settings,
    created_at,finished_at,reset_at,reset_by_profile_id,updated_at,raw_data
  ) values (
    p_id,coalesce(nullif(p_value->>'name',''),'Competição'),p_value->>'format',p_value->>'type',
    coalesce(nullif(p_value->>'status',''),'draft'),p_value->>'champion',p_value->>'cupStage',
    p_value->'groups',p_value->'cupSnapshot',p_value->'finalStandings',p_value->'economySettings',
    p_value->'finalPrizeSettings',p_value->'marketBalanceSettings',p_value->'marketSettings',
    public.direct_ms(p_value->'createdAt'),public.direct_ms(p_value->'finishedAt'),
    public.direct_ms(p_value->'resetAt'),nullif(p_value->>'resetByProfileId',''),now(),'{}'::jsonb
  )
  on conflict (id) do update set
    name=excluded.name,format=excluded.format,type=excluded.type,status=excluded.status,
    champion=excluded.champion,cup_stage=excluded.cup_stage,groups_data=excluded.groups_data,
    cup_snapshot=excluded.cup_snapshot,final_standings=excluded.final_standings,
    economy_settings=excluded.economy_settings,final_prize_settings=excluded.final_prize_settings,
    market_balance_settings=excluded.market_balance_settings,market_settings=excluded.market_settings,
    finished_at=excluded.finished_at,reset_at=excluded.reset_at,reset_by_profile_id=excluded.reset_by_profile_id,
    updated_at=now(),raw_data='{}'::jsonb;

  delete from public.tournament_participants where tournament_id=p_id;
  for child, ord in select value, ordinality from jsonb_array_elements(coalesce(p_value->'participants','[]'::jsonb)) with ordinality loop
    insert into public.tournament_participants(tournament_id,profile_id,position)
    values(p_id,trim(both '"' from child::text),ord-1)
    on conflict do nothing;
  end loop;

  delete from public.trade_offer_history where offer_id in (select id from public.trade_offers where tournament_id=p_id);
  delete from public.trade_offers where tournament_id=p_id;
  delete from public.financial_transactions where tournament_id=p_id;
  delete from public.transfers where tournament_id=p_id;
  delete from public.player_stats where tournament_id=p_id;
  delete from public.player_ownership where tournament_id=p_id;
  delete from public.matches where tournament_id=p_id;
  delete from public.admin_imports where tournament_id=p_id;
  delete from public.teams where tournament_id=p_id;

  for child, ord in select value, ordinality from jsonb_array_elements(teams_json) with ordinality loop
    insert into public.teams(id,tournament_id,profile_id,name,color,budget,active,historical,lineup,source_order,updated_at,raw_data)
    values(
      child->>'id',p_id,nullif(child->>'profileId',''),coalesce(nullif(child->>'name',''),'Time'),
      child->>'color',coalesce((child->>'budget')::numeric,0),coalesce((child->>'active')::boolean,true),
      coalesce((child->>'historical')::boolean,false),child->'lineup',ord-1,now(),'{}'::jsonb
    );
  end loop;

  for child, ord in select value, ordinality from jsonb_array_elements(matches_json) with ordinality loop
    insert into public.matches(
      id,tournament_id,home_team_id,away_team_id,home_profile_id,away_profile_id,stage,round,leg,status,
      played,home_score,away_score,played_at,created_at,source_order,raw_data
    ) values (
      child->>'id',p_id,nullif(coalesce(child->>'homeTeamId',child->>'homeId'),''),
      nullif(coalesce(child->>'awayTeamId',child->>'awayId'),''),nullif(child->>'homeProfileId',''),
      nullif(child->>'awayProfileId',''),child->>'stage',nullif(child->>'round','')::integer,
      nullif(child->>'leg','')::integer,child->>'status',coalesce((child->>'played')::boolean,false),
      nullif(child->>'homeScore','')::integer,nullif(child->>'awayScore','')::integer,
      public.direct_ms(child->'playedAt'),public.direct_ms(child->'createdAt'),ord-1,'{}'::jsonb
    );
  end loop;

  for k, child in select key,value from jsonb_each(coalesce(p_value#>'{context,ownership}','{}'::jsonb)) loop
    insert into public.player_ownership(tournament_id,player_id,team_id,initial_team_id,squad_role,acquisition_source,acquired_at,for_sale,raw_data)
    values(p_id,k,nullif(child->>'teamId',''),nullif(child->>'initialTeamId',''),child->>'squadRole',
      child->>'acquisitionSource',public.direct_ms(child->'acquiredAt'),coalesce((child->>'forSale')::boolean,false),'{}'::jsonb);
  end loop;

  for k, child in select key,value from jsonb_each(coalesce(p_value#>'{context,playerStats}','{}'::jsonb)) loop
    insert into public.player_stats(tournament_id,player_id,team_id,player_name_snapshot,goals,red_cards,updated_at,raw_data)
    values(p_id,k,nullif(child->>'teamId',''),child->>'playerNameSnapshot',coalesce((child->>'goals')::integer,0),
      coalesce((child->>'redCards')::integer,0),coalesce(public.direct_ms(child->'updatedAt'),now()),'{}'::jsonb);
  end loop;

  for k, child in select key,value from jsonb_each(coalesce(p_value#>'{context,tradeOffers}','{}'::jsonb)) loop
    offer_id:=coalesce(nullif(child->>'id',''),k);
    insert into public.trade_offers(
      id,tournament_id,player_id,player_name,buyer_team_id,seller_team_id,buyer_profile_id,seller_profile_id,
      current_amount,market_value_at_creation,last_actor_team_id,status,expires_at,created_at,updated_at,raw_data
    ) values (
      offer_id,p_id,child->>'playerId',child->>'playerName',child->>'buyerTeamId',child->>'sellerTeamId',
      nullif(child->>'buyerProfileId',''),nullif(child->>'sellerProfileId',''),coalesce((child->>'currentAmount')::numeric,0),
      nullif(child->>'marketValueAtCreation','')::numeric,nullif(child->>'lastActorTeamId',''),
      coalesce(nullif(child->>'status',''),'pending'),public.direct_ms(child->'expiresAt'),
      coalesce(public.direct_ms(child->'createdAt'),now()),coalesce(public.direct_ms(child->'updatedAt'),now()),'{}'::jsonb
    );
    for item in select value from jsonb_array_elements(coalesce(child->'history','[]'::jsonb)) loop
      insert into public.trade_offer_history(id,offer_id,actor_team_id,action_type,amount,created_at,raw_data)
      values(item->>'id',offer_id,nullif(item->>'actorTeamId',''),coalesce(item->>'type','update'),
        nullif(item->>'amount','')::numeric,coalesce(public.direct_ms(item->'createdAt'),now()),'{}'::jsonb);
    end loop;
  end loop;

  for child in select value from jsonb_array_elements(coalesce(p_value#>'{context,transfers}','[]'::jsonb)) loop
    insert into public.transfers(id,tournament_id,player_id,player_name,transfer_type,from_team_id,to_team_id,offer_id,price,market_value,depreciation_pct,transfer_date,created_at,raw_data)
    values(child->>'id',p_id,child->>'playerId',child->>'playerName',coalesce(child->>'type','transfer'),
      nullif(child->>'fromTeamId',''),nullif(child->>'toTeamId',''),nullif(child->>'offerId',''),
      coalesce((child->>'price')::numeric,0),nullif(child->>'marketValue','')::numeric,
      nullif(child->>'depreciationPct','')::numeric,child->>'date',coalesce(public.direct_ms(child->'createdAt'),now()),'{}'::jsonb);
  end loop;

  for child in select value from jsonb_array_elements(coalesce(p_value#>'{context,financialTransactions}','[]'::jsonb)) loop
    insert into public.financial_transactions(id,tournament_id,team_id,transaction_type,amount,balance_before,balance_after,label,reference_id,created_at,raw_data)
    values(child->>'id',p_id,child->>'teamId',coalesce(child->>'type','adjustment'),
      coalesce((child->>'amount')::numeric,0),coalesce((child->>'balanceBefore')::numeric,0),
      coalesce((child->>'balanceAfter')::numeric,0),child->>'label',child->>'referenceId',
      coalesce(public.direct_ms(child->'createdAt'),now()),'{}'::jsonb);
  end loop;

  for child in select value from jsonb_array_elements(coalesce(p_value#>'{context,adminImports}','[]'::jsonb)) loop
    insert into public.admin_imports(id,tournament_id,imported_by_profile_id,import_type,mode,player_count,team_count,imported_at,raw_data)
    values(child->>'id',p_id,nullif(child->>'importedByProfileId',''),child->>'type',child->>'mode',
      nullif(child->>'playerCount','')::integer,nullif(child->>'teamCount','')::integer,
      coalesce(public.direct_ms(child->'importedAt'),now()),'{}'::jsonb);
  end loop;
end;
$$;

create or replace function public.sync_review_document(p_id text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare k text; v jsonb;
begin
  if p_value is null or p_value='null'::jsonb then delete from public.player_reviews where id=p_id; return; end if;
  insert into public.player_reviews(id,player_id,player_name_snapshot,created_by_profile_id,created_by_name_snapshot,original,proposed,status,applying_by_profile_id,applying_at,resolved_by_profile_id,resolved_at,resolution_reason,created_at,updated_at,raw_data)
  values(p_id,p_value->>'playerId',p_value->>'playerNameSnapshot',nullif(p_value->>'createdByProfileId',''),p_value->>'createdByNameSnapshot',
    coalesce(p_value->'original','{}'::jsonb),coalesce(p_value->'proposed','{}'::jsonb),coalesce(p_value->>'status','pending'),
    nullif(p_value->>'applyingByProfileId',''),public.direct_ms(p_value->'applyingAt'),nullif(p_value->>'resolvedByProfileId',''),
    public.direct_ms(p_value->'resolvedAt'),p_value->>'resolutionReason',coalesce(public.direct_ms(p_value->'createdAt'),now()),
    coalesce(public.direct_ms(p_value->'updatedAt'),now()),'{}'::jsonb)
  on conflict(id) do update set player_id=excluded.player_id,player_name_snapshot=excluded.player_name_snapshot,
    created_by_profile_id=excluded.created_by_profile_id,created_by_name_snapshot=excluded.created_by_name_snapshot,
    original=excluded.original,proposed=excluded.proposed,status=excluded.status,applying_by_profile_id=excluded.applying_by_profile_id,
    applying_at=excluded.applying_at,resolved_by_profile_id=excluded.resolved_by_profile_id,resolved_at=excluded.resolved_at,
    resolution_reason=excluded.resolution_reason,updated_at=excluded.updated_at,raw_data='{}'::jsonb;
  delete from public.player_review_votes where review_id=p_id;
  for k,v in select key,value from jsonb_each(coalesce(p_value->'votes','{}'::jsonb)) loop
    insert into public.player_review_votes(review_id,profile_id,vote,avatar_snapshot,name_snapshot,created_at,raw_data)
    values(p_id,k,coalesce(v->>'decision',v->>'vote'),v->>'avatarSnapshot',v->>'nameSnapshot',coalesce(public.direct_ms(v->'createdAt'),now()),'{}'::jsonb);
  end loop;
end;
$$;

create or replace function public.apply_direct_patch(
  p_documents jsonb,
  p_delete_keys text[] default '{}',
  p_actor_profile_id text default null,
  p_event_type text default 'state_change'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  k text; v jsonb; id text; tournament_id text; profile_id text; player_id text;
begin
  set constraints all deferred;

  foreach k in array coalesce(p_delete_keys,'{}') loop
    if k like 'profile:%' then delete from public.profiles where id=substr(k,9);
    elsif k like 'tournament:%' then delete from public.tournaments where id=substr(k,12);
    elsif k like 'review:%' then delete from public.player_reviews where id=substr(k,8);
    end if;
  end loop;

  for k,v in select key,value from jsonb_each(coalesce(p_documents,'{}'::jsonb)) loop
    if k like 'profile:%' then
      perform public.sync_profile_document(substr(k,9),v);
    elsif k like 'tournament:%' then
      perform public.sync_tournament_document(substr(k,12),v);
    elsif k like 'review:%' then
      perform public.sync_review_document(substr(k,8),v);
    elsif k='meta' then
      update public.app_meta set
        current_tournament_id=nullif(v->>'currentTournamentId',''),
        identity_schema_version=coalesce((v->>'identitySchemaVersion')::integer,0),
        identity_migrated_at=public.direct_ms(v->'identityMigratedAt'),
        season_counter=coalesce((v->>'seasonCounter')::integer,0),updated_at=now()
      where id=true;
    elsif k='adminSecurity' then
      update public.admin_security set password_hash=v->>'passwordHash',updated_at=now(),updated_by_profile_id=p_actor_profile_id where id=true;
    elsif k='ownership' then
      delete from public.global_player_ownership;
      for id,v in select key,value from jsonb_each(coalesce(v,'{}'::jsonb)) loop
        insert into public.global_player_ownership(player_id,team_id,for_sale,raw_data)
        values(id,nullif(v->>'teamId',''),coalesce((v->>'forSale')::boolean,false),'{}'::jsonb);
      end loop;
    elsif k='presence' then
      for id,v in select key,value from jsonb_each(coalesce(v,'{}'::jsonb)) loop
        insert into public.presence(profile_id,online,updated_at)
        values(id,coalesce((v->>'online')::boolean,false),coalesce(public.direct_ms(v->'updatedAt'),now()))
        on conflict(profile_id) do update set online=excluded.online,updated_at=excluded.updated_at;
      end loop;
    elsif k='playerCatalogOverrides' then
      delete from public.player_catalog_overrides;
      for id,v in select key,value from jsonb_each(coalesce(v,'{}'::jsonb)) loop
        insert into public.player_catalog_overrides(player_id,overall,market_value,updated_by_profile_id,updated_at,raw_data)
        values(id,nullif(v->>'overall','')::integer,nullif(coalesce(v->>'value',v->>'marketValue'),'')::numeric,
          nullif(v->>'updatedByProfileId',''),coalesce(public.direct_ms(v->'updatedAt'),now()),'{}'::jsonb);
      end loop;
    elsif k='profileChampionshipPreferences' then
      delete from public.profile_favorites;
      for tournament_id,v in select key,value from jsonb_each(coalesce(v,'{}'::jsonb)) loop
        for profile_id,v in select key,value from jsonb_each(coalesce(v,'{}'::jsonb)) loop
          for player_id,v in select key,value from jsonb_each(coalesce(v->'favorites','{}'::jsonb)) loop
            if coalesce((v::text)::boolean,false) then
              insert into public.profile_favorites(tournament_id,profile_id,player_id) values(tournament_id,profile_id,player_id) on conflict do nothing;
            end if;
          end loop;
        end loop;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'eventType',p_event_type);
end;
$$;


create or replace function public.get_app_security()
returns jsonb
language sql
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'passwordHash', password_hash,
    'updatedAt', case when updated_at is null then null else extract(epoch from updated_at)*1000 end,
    'updatedByProfileId', updated_by_profile_id
  )
  from public.admin_security
  where id=true
$$;

grant execute on function public.get_app_security() to anon, authenticated;

grant execute on function public.apply_direct_patch(jsonb,text[],text,text) to anon, authenticated;
grant execute on function public.sync_profile_document(text,jsonb) to anon, authenticated;
grant execute on function public.sync_tournament_document(text,jsonb) to anon, authenticated;
grant execute on function public.sync_review_document(text,jsonb) to anon, authenticated;

-- A camada antiga deixa de participar do runtime. Mantemos as tabelas apenas para rollback manual.
revoke all on public.sync_events from anon, authenticated;

commit;
