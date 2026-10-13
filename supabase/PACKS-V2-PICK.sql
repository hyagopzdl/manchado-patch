-- PACKS-V2-PICK: pacotes de "escolher 1 carta" (pack.interaction = 'pick').
--
-- O que faz (requer PACKS-V1.sql já aplicado):
--   * open_pack ganha o parâmetro p_pick_index (posição escolhida às cegas, 0..cartas-1).
--     - pacote com interaction = 'pick': sorteia as N cartas, mas só a escolhida entra no elenco
--       (as outras voltam ao pool e ficam registradas em pack_openings.cards com chosen = false);
--       o limite do elenco considera apenas 1 carta.
--     - qualquer outro pacote funciona exatamente como antes (p_pick_index é ignorado).
--   * rollback_pack_opening passa a considerar só as cartas escolhidas (chosen <> false).
--   * remove a versão antiga de 5 parâmetros de open_pack (senão o PostgREST acusa ambiguidade).
-- Não altera tabelas. Idempotente.

begin;

drop function if exists public.open_pack(text, text, text, text, text);

create or replace function public.open_pack(
  p_tournament_id text,
  p_pack_id text,
  p_team_id text,
  p_actor_profile_id text default null,
  p_catalog_checksum text default null,
  p_pick_index integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.tournaments%rowtype;
  v_team public.teams%rowtype;
  v_settings jsonb;
  v_pack jsonb;
  v_weights jsonb;
  v_unlock jsonb;
  v_price numeric;
  v_cards integer;
  v_keep integer;
  v_interaction text;
  v_max integer;
  v_size integer;
  v_use_overrides boolean;
  v_catalog_id text;
  v_now timestamptz := clock_timestamp();
  v_opening_id text;
  v_drawn text[] := '{}'::text[];
  v_result jsonb := '[]'::jsonb;
  v_ovs integer[];
  v_ws numeric[];
  v_total numeric;
  v_roll numeric;
  v_acc numeric;
  v_pick integer;
  v_i integer;
  v_j integer;
  v_card record;
  v_before numeric;
  v_after numeric;
  v_pool_snapshot jsonb;
  v_unlock_count integer;
begin
  -- Serializa com apply_tournament_delta: ninguém muda posse enquanto sorteamos.
  perform pg_advisory_xact_lock(hashtext('manchado:tournament-delta:v7'));

  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found' using errcode = 'P0001'; end if;
  if coalesce(v_t.status, '') = 'finished' then raise exception 'tournament_finished' using errcode = 'P0001'; end if;
  if coalesce(v_t.raw_data->>'mode', 'market') <> 'packs' then raise exception 'not_packs_mode' using errcode = 'P0001'; end if;

  v_settings := v_t.raw_data->'packSettings';
  if v_settings is null or jsonb_typeof(v_settings) <> 'object' then raise exception 'packs_not_configured' using errcode = 'P0001'; end if;
  if coalesce((v_settings->>'isOpen')::boolean, true) = false then raise exception 'store_closed' using errcode = 'P0001'; end if;

  select e into v_pack
  from jsonb_array_elements(coalesce(v_settings->'packs', '[]'::jsonb)) e
  where e->>'id' = p_pack_id
  limit 1;
  if v_pack is null then raise exception 'pack_not_found' using errcode = 'P0001'; end if;
  if coalesce((v_pack->>'enabled')::boolean, true) = false then raise exception 'pack_disabled' using errcode = 'P0001'; end if;

  v_price := coalesce(nullif(v_pack->>'price', '')::numeric, 0);
  v_cards := coalesce(nullif(v_pack->>'cards', '')::integer, 0);
  if v_price <= 0 then raise exception 'invalid_price' using errcode = 'P0001'; end if;
  if v_cards < 1 or v_cards > 10 then raise exception 'invalid_card_count' using errcode = 'P0001'; end if;

  -- Interação do pacote: 'all' (todas as cartas ficam com o time) ou 'pick' (o usuário escolhe 1
  -- das N cartas, às cegas, pela posição; só a escolhida entra no elenco e as outras voltam ao pool).
  v_interaction := case when v_pack->>'interaction' = 'pick' then 'pick' else 'all' end;
  if v_interaction = 'pick' then
    if p_pick_index is null or p_pick_index < 0 or p_pick_index >= v_cards then raise exception 'pick_required' using errcode = 'P0001'; end if;
    v_keep := 1;
  else
    v_keep := v_cards;
  end if;

  v_weights := coalesce(v_pack->'weights', '{}'::jsonb);
  if jsonb_typeof(v_weights) <> 'object' or v_weights = '{}'::jsonb then raise exception 'invalid_weights' using errcode = 'P0001'; end if;

  -- Marco de desbloqueio: X aberturas (não revertidas) de outro pacote, somando todos os times.
  -- Só vale se packSettings.unlocksEnabled = true (por padrão desligado durante os testes).
  v_unlock := v_pack->'unlock';
  if coalesce((v_settings->>'unlocksEnabled')::boolean, false) and v_unlock is not null and jsonb_typeof(v_unlock) = 'object' then
    select count(*) into v_unlock_count
    from public.pack_openings
    where tournament_id = p_tournament_id and pack_id = v_unlock->>'packId' and rolled_back_at is null;
    if v_unlock_count < coalesce(nullif(v_unlock->>'count', '')::integer, 0) then
      raise exception 'pack_locked' using errcode = 'P0001';
    end if;
  end if;

  select * into v_team from public.teams where tournament_id = p_tournament_id and id = p_team_id for update;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
  -- Exige perfil informado: time órfão (perfil removido, profile_id nulo) não pode ser gasto por ninguém.
  if p_actor_profile_id is null or v_team.profile_id is distinct from p_actor_profile_id then
    raise exception 'not_team_owner' using errcode = 'P0001';
  end if;

  -- O limite do elenco é o do campeonato (rosterSettings.maxPlayers, editado pelo admin).
  -- packSettings.rosterMax é só legado, usado se o torneio não tiver rosterSettings.
  v_max := coalesce(
    nullif(v_t.raw_data->'rosterSettings'->>'maxPlayers', '')::integer,
    nullif(v_settings->>'rosterMax', '')::integer,
    30
  );
  select count(*) into v_size from public.player_ownership where tournament_id = p_tournament_id and team_id = p_team_id;
  if v_size + v_keep > v_max then raise exception 'roster_full' using errcode = 'P0001'; end if;

  v_before := coalesce(v_team.budget, 0);
  if v_before < v_price then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;

  v_catalog_id := coalesce(nullif(v_t.raw_data->>'catalogId', ''), 'default');
  if not exists (select 1 from public.player_catalog where catalog_id = v_catalog_id) then
    raise exception 'catalog_not_loaded' using errcode = 'P0001';
  end if;

  -- Guarda de versão: o cliente informa o sha256 do players.json que ele está exibindo.
  -- Se for diferente do catálogo carregado no banco, o sorteio seria sobre dados que o jogador não vê.
  if p_catalog_checksum is not null
     and p_catalog_checksum is distinct from (select source_checksum from public.player_catalog_meta where catalog_id = v_catalog_id) then
    raise exception 'catalog_outdated' using errcode = 'P0001';
  end if;

  -- Overrides são globais por player_id: só são seguros no catálogo 'default'.
  v_use_overrides := v_catalog_id = 'default' and coalesce((v_t.market_settings->>'playerOverridesEnabled')::boolean, true);

  select coalesce(jsonb_object_agg(overall::text, n), '{}'::jsonb) into v_pool_snapshot
  from (select overall, count(*) n from public._pack_pool(p_tournament_id, v_catalog_id, v_use_overrides, v_drawn) group by overall) s;

  for v_i in 1..v_cards loop
    select array_agg(overall order by overall), array_agg(weight order by overall)
      into v_ovs, v_ws
    from (
      select p.overall,
             coalesce(nullif(v_weights->>(p.overall::text), '')::numeric, 0) as weight
      from public._pack_pool(p_tournament_id, v_catalog_id, v_use_overrides, v_drawn) p
      group by p.overall
    ) x
    where weight > 0;

    if v_ovs is null then raise exception 'pool_empty' using errcode = 'P0001'; end if;

    v_total := 0;
    for v_j in 1..array_length(v_ws, 1) loop v_total := v_total + v_ws[v_j]; end loop;

    v_roll := random() * v_total;
    v_acc := 0;
    v_pick := v_ovs[array_length(v_ovs, 1)];
    for v_j in 1..array_length(v_ovs, 1) loop
      v_acc := v_acc + v_ws[v_j];
      if v_roll < v_acc then v_pick := v_ovs[v_j]; exit; end if;
    end loop;

    select * into v_card
    from public._pack_pool(p_tournament_id, v_catalog_id, v_use_overrides, v_drawn) p
    where p.overall = v_pick
    order by random()
    limit 1;

    v_drawn := v_drawn || v_card.player_id;
    v_result := v_result || jsonb_build_object(
      'playerId', v_card.player_id, 'name', v_card.name, 'position', v_card.pos,
      'overall', v_card.overall, 'value', v_card.value,
      'chosen', (v_interaction = 'all' or v_i - 1 = p_pick_index)
    );
  end loop;

  v_opening_id := 'pack_' || substr(md5(p_tournament_id || ':' || p_team_id || ':' || v_now::text || ':' || random()::text), 1, 20);
  v_after := v_before - v_price;

  update public.teams set budget = v_after, updated_at = now()
  where tournament_id = p_tournament_id and id = p_team_id;

  for v_i in 0..jsonb_array_length(v_result) - 1 loop
    continue when not (v_result->v_i->>'chosen')::boolean;
    insert into public.player_ownership as po (
      tournament_id, player_id, team_id, initial_team_id, squad_role,
      acquisition_source, acquired_at, for_sale, raw_data
    ) values (
      p_tournament_id, v_result->v_i->>'playerId', p_team_id, null, null,
      'pack', v_now, false,
      jsonb_build_object('packOpeningId', v_opening_id, 'packId', p_pack_id)
    )
    on conflict (tournament_id, player_id) do update set
      team_id = excluded.team_id,
      initial_team_id = null,
      squad_role = null,
      acquisition_source = 'pack',
      acquired_at = excluded.acquired_at,
      for_sale = false,
      raw_data = excluded.raw_data;

    insert into public.transfers(
      id, tournament_id, player_id, player_name, transfer_type, from_team_id, to_team_id,
      offer_id, price, market_value, depreciation_pct, transfer_date, created_at, raw_data
    ) values (
      v_opening_id || '_' || v_i, p_tournament_id, v_result->v_i->>'playerId', v_result->v_i->>'name',
      'pack_pull', null, p_team_id, null, 0, (v_result->v_i->>'value')::numeric, null,
      to_char(v_now at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v_now,
      jsonb_build_object('openingId', v_opening_id, 'packId', p_pack_id, 'overall', (v_result->v_i->>'overall')::integer)
    );
  end loop;

  insert into public.financial_transactions(
    id, tournament_id, team_id, transaction_type, amount, balance_before, balance_after,
    label, reference_id, operation_id, created_at, raw_data
  ) values (
    'pack_buy_' || v_opening_id, p_tournament_id, p_team_id, 'pack_purchase', -v_price, v_before, v_after,
    'Pacote ' || coalesce(nullif(v_pack->>'label', ''), p_pack_id), v_opening_id, gen_random_uuid(), v_now,
    jsonb_build_object('packId', p_pack_id, 'openingId', v_opening_id)
  );

  insert into public.pack_openings(id, tournament_id, team_id, profile_id, pack_id, price, cards, weights, pool_by_overall, created_at)
  values (v_opening_id, p_tournament_id, p_team_id, p_actor_profile_id, p_pack_id, v_price, v_result, v_weights, v_pool_snapshot, v_now);

  return jsonb_build_object(
    'ok', true, 'openingId', v_opening_id, 'packId', p_pack_id, 'catalogId', v_catalog_id, 'price', v_price,
    'balanceBefore', v_before, 'balanceAfter', v_after, 'cards', v_result,
    'interaction', v_interaction, 'chosenIndex', case when v_interaction = 'pick' then p_pick_index else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- rollback_pack_opening (somente admin)
-- ---------------------------------------------------------------------------
create or replace function public.rollback_pack_opening(
  p_opening_id text,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.pack_openings%rowtype;
  v_team public.teams%rowtype;
  v_actor public.profiles%rowtype;
  v_card jsonb;
  v_before numeric;
  v_after numeric;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('manchado:tournament-delta:v7'));

  select * into v_actor from public.profiles where id = p_actor_profile_id;
  if not found or not (v_actor.role = 'admin' or lower(trim(coalesce(v_actor.name, ''))) = 'admin') then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select * into v_o from public.pack_openings where id = p_opening_id for update;
  if not found then raise exception 'opening_not_found' using errcode = 'P0001'; end if;
  if v_o.rolled_back_at is not null then raise exception 'already_rolled_back' using errcode = 'P0001'; end if;

  for v_card in select * from jsonb_array_elements(v_o.cards) loop
    if not exists (
      select 1 from public.player_ownership
      where tournament_id = v_o.tournament_id and player_id = v_card->>'playerId' and team_id = v_o.team_id
    ) then
      raise exception 'cards_moved' using errcode = 'P0001';
    end if;
  end loop;

  select * into v_team from public.teams where tournament_id = v_o.tournament_id and id = v_o.team_id for update;
  v_before := coalesce(v_team.budget, 0);
  v_after := v_before + v_o.price;

  delete from public.player_ownership
  where tournament_id = v_o.tournament_id and team_id = v_o.team_id
    and player_id in (select c->>'playerId' from jsonb_array_elements(v_o.cards) c);

  update public.teams set budget = v_after, updated_at = now()
  where tournament_id = v_o.tournament_id and id = v_o.team_id;

  update public.transfers
  set raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('rolledBackAt', floor(extract(epoch from v_now) * 1000)::bigint)
  where tournament_id = v_o.tournament_id and raw_data->>'openingId' = v_o.id;

  insert into public.financial_transactions(
    id, tournament_id, team_id, transaction_type, amount, balance_before, balance_after,
    label, reference_id, operation_id, created_at, raw_data
  ) values (
    'pack_rollback_' || v_o.id, v_o.tournament_id, v_o.team_id, 'pack_rollback', v_o.price, v_before, v_after,
    'Estorno de pacote', v_o.id, gen_random_uuid(), v_now,
    jsonb_build_object('openingId', v_o.id, 'actorProfileId', p_actor_profile_id)
  );

  update public.pack_openings set rolled_back_at = v_now where id = v_o.id;

  return jsonb_build_object('ok', true, 'openingId', v_o.id, 'refunded', v_o.price, 'balanceAfter', v_after);
end;
$$;

create or replace function public.rollback_pack_opening(
  p_opening_id text,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.pack_openings%rowtype;
  v_team public.teams%rowtype;
  v_actor public.profiles%rowtype;
  v_card jsonb;
  v_before numeric;
  v_after numeric;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('manchado:tournament-delta:v7'));

  select * into v_actor from public.profiles where id = p_actor_profile_id;
  if not found or not (v_actor.role = 'admin' or lower(trim(coalesce(v_actor.name, ''))) = 'admin') then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select * into v_o from public.pack_openings where id = p_opening_id for update;
  if not found then raise exception 'opening_not_found' using errcode = 'P0001'; end if;
  if v_o.rolled_back_at is not null then raise exception 'already_rolled_back' using errcode = 'P0001'; end if;

  for v_card in select e.value from jsonb_array_elements(v_o.cards) e where coalesce((e.value->>'chosen')::boolean, true) loop
    if not exists (
      select 1 from public.player_ownership
      where tournament_id = v_o.tournament_id and player_id = v_card->>'playerId' and team_id = v_o.team_id
    ) then
      raise exception 'cards_moved' using errcode = 'P0001';
    end if;
  end loop;

  select * into v_team from public.teams where tournament_id = v_o.tournament_id and id = v_o.team_id for update;
  v_before := coalesce(v_team.budget, 0);
  v_after := v_before + v_o.price;

  delete from public.player_ownership
  where tournament_id = v_o.tournament_id and team_id = v_o.team_id
    and player_id in (select c->>'playerId' from jsonb_array_elements(v_o.cards) c where coalesce((c->>'chosen')::boolean, true));

  update public.teams set budget = v_after, updated_at = now()
  where tournament_id = v_o.tournament_id and id = v_o.team_id;

  update public.transfers
  set raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('rolledBackAt', floor(extract(epoch from v_now) * 1000)::bigint)
  where tournament_id = v_o.tournament_id and raw_data->>'openingId' = v_o.id;

  insert into public.financial_transactions(
    id, tournament_id, team_id, transaction_type, amount, balance_before, balance_after,
    label, reference_id, operation_id, created_at, raw_data
  ) values (
    'pack_rollback_' || v_o.id, v_o.tournament_id, v_o.team_id, 'pack_rollback', v_o.price, v_before, v_after,
    'Estorno de pacote', v_o.id, gen_random_uuid(), v_now,
    jsonb_build_object('openingId', v_o.id, 'actorProfileId', p_actor_profile_id)
  );

  update public.pack_openings set rolled_back_at = v_now where id = v_o.id;

  return jsonb_build_object('ok', true, 'openingId', v_o.id, 'refunded', v_o.price, 'balanceAfter', v_after);
end;
$$;


revoke all on function public.open_pack(text, text, text, text, text, integer) from public;
grant execute on function public.open_pack(text, text, text, text, text, integer) to anon, authenticated;
revoke all on function public.rollback_pack_opening(text, text) from public;
grant execute on function public.rollback_pack_opening(text, text) to anon, authenticated;

commit;
