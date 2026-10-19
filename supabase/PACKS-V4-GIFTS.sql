-- PACKS-V4-GIFTS: pacotes de presente dados pelo admin (requer PACKS-V1, V2-PICK e V3-PICK-TWO-STEP).
--
--   * cria a tabela pack_gifts (cada linha = 1 pacote de presente para 1 time; leitura pública, escrita só pelas RPCs);
--   * grant_pack_gift / revoke_pack_gift: somente admin;
--   * open_pack ganha p_gift_id: com ele o pacote custa 0 e ignora o marco de desbloqueio; o presente é marcado como usado;
--   * rollback_pack_opening passa a devolver o presente (se a abertura veio de um) em vez de reembolsar 0.
-- Idempotente.

begin;

create table if not exists public.pack_gifts (
  id text primary key,
  tournament_id text not null references public.tournaments(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  pack_id text not null,
  created_by_profile_id text,
  created_at timestamptz not null default now(),
  used_opening_id text,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists pack_gifts_team_idx on public.pack_gifts(tournament_id, team_id);
alter table public.pack_gifts enable row level security;
drop policy if exists pack_gifts_read on public.pack_gifts;
create policy pack_gifts_read on public.pack_gifts for select to anon, authenticated using (true);

create or replace function public._assert_admin(p_actor text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor;
  if not found or not (v_actor.role = 'admin' or lower(trim(coalesce(v_actor.name, ''))) = 'admin') then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.grant_pack_gift(
  p_tournament_id text,
  p_team_ids text[],
  p_pack_id text,
  p_quantity integer default 1,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.tournaments%rowtype;
  v_team text;
  v_i integer;
  v_n integer := 0;
begin
  perform public._assert_admin(p_actor_profile_id);
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament_not_found' using errcode = 'P0001'; end if;
  if coalesce(v_t.status, '') = 'finished' then raise exception 'tournament_finished' using errcode = 'P0001'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_t.raw_data->'packSettings'->'packs', '[]'::jsonb)) e where e->>'id' = p_pack_id) then
    raise exception 'pack_not_found' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then raise exception 'invalid_quantity' using errcode = 'P0001'; end if;
  if p_team_ids is null or array_length(p_team_ids, 1) is null then raise exception 'team_not_found' using errcode = 'P0001'; end if;

  foreach v_team in array p_team_ids loop
    if not exists (select 1 from public.teams where tournament_id = p_tournament_id and id = v_team) then
      raise exception 'team_not_found' using errcode = 'P0001';
    end if;
    for v_i in 1..p_quantity loop
      insert into public.pack_gifts(id, tournament_id, team_id, pack_id, created_by_profile_id)
      values ('gift_' || substr(md5(p_tournament_id || v_team || clock_timestamp()::text || random()::text || v_i::text), 1, 20), p_tournament_id, v_team, p_pack_id, p_actor_profile_id);
      v_n := v_n + 1;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'granted', v_n);
end;
$$;

create or replace function public.revoke_pack_gift(p_gift_id text, p_actor_profile_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_g public.pack_gifts%rowtype;
begin
  perform public._assert_admin(p_actor_profile_id);
  select * into v_g from public.pack_gifts where id = p_gift_id for update;
  if not found then raise exception 'gift_not_found' using errcode = 'P0001'; end if;
  if v_g.used_opening_id is not null then raise exception 'gift_already_used' using errcode = 'P0001'; end if;
  update public.pack_gifts set revoked_at = coalesce(revoked_at, now()) where id = p_gift_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- A versão antiga (6 parâmetros) sai para não haver ambiguidade na chamada.
drop function if exists public.open_pack(text, text, text, text, text, integer);

create or replace function public.open_pack(
  p_tournament_id text,
  p_pack_id text,
  p_team_id text,
  p_actor_profile_id text default null,
  p_catalog_checksum text default null,
  p_pick_index integer default null,
  p_gift_id text default null
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
  v_gift public.pack_gifts%rowtype;
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
  if v_price <= 0 and p_gift_id is null then raise exception 'invalid_price' using errcode = 'P0001'; end if;
  if v_cards < 1 or v_cards > 10 then raise exception 'invalid_card_count' using errcode = 'P0001'; end if;

  -- Interação do pacote: 'all' (todas as cartas ficam com o time) ou 'pick' (o usuário escolhe 1
  -- das N cartas, às cegas, pela posição; só a escolhida entra no elenco e as outras voltam ao pool).
  v_interaction := case when v_pack->>'interaction' = 'pick' then 'pick' else 'all' end;
  if v_interaction = 'pick' then
    -- Sem p_pick_index: abertura em duas etapas (cobra e sorteia agora; a escolha vem depois em pick_pack_card).
    -- Com p_pick_index: escolha imediata (compatível com a versão anterior do app).
    if p_pick_index is not null and (p_pick_index < 0 or p_pick_index >= v_cards) then raise exception 'pick_required' using errcode = 'P0001'; end if;
    v_keep := 1;
  else
    v_keep := v_cards;
  end if;

  v_weights := coalesce(v_pack->'weights', '{}'::jsonb);
  if jsonb_typeof(v_weights) <> 'object' or v_weights = '{}'::jsonb then raise exception 'invalid_weights' using errcode = 'P0001'; end if;

  -- Marco de desbloqueio: X aberturas (não revertidas) de outro pacote, somando todos os times.
  -- Só vale se packSettings.unlocksEnabled = true (por padrão desligado durante os testes).
  v_unlock := v_pack->'unlock';
  if p_gift_id is null and coalesce((v_settings->>'unlocksEnabled')::boolean, false) and v_unlock is not null and jsonb_typeof(v_unlock) = 'object' then
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

  -- Presente do admin: o pacote sai de graça (preço 0) e ignora os marcos de desbloqueio. Cada presente vale uma abertura.
  if p_gift_id is not null then
    select * into v_gift from public.pack_gifts where id = p_gift_id for update;
    if not found then raise exception 'gift_not_found' using errcode = 'P0001'; end if;
    if v_gift.tournament_id <> p_tournament_id or v_gift.team_id <> p_team_id or v_gift.pack_id <> p_pack_id then
      raise exception 'gift_mismatch' using errcode = 'P0001';
    end if;
    if v_gift.revoked_at is not null or v_gift.used_opening_id is not null then raise exception 'gift_unavailable' using errcode = 'P0001'; end if;
    v_price := 0;
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

  -- Cartas de pacotes "escolher 1" ainda sem escolha ficam reservadas: ninguém mais pode sorteá-las até a escolha.
  select coalesce(array_agg(distinct c->>'playerId'), '{}'::text[]) into v_drawn
  from public.pack_openings po, jsonb_array_elements(po.cards) c
  where po.tournament_id = p_tournament_id and po.rolled_back_at is null
    and not exists (select 1 from jsonb_array_elements(po.cards) x where coalesce((x->>'chosen')::boolean, true));

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
      'chosen', (v_interaction = 'all' or (p_pick_index is not null and v_i - 1 = p_pick_index))
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
    case when p_gift_id is null then 'Pacote ' else 'Pacote de presente ' end || coalesce(nullif(v_pack->>'label', ''), p_pack_id), v_opening_id, gen_random_uuid(), v_now,
    jsonb_build_object('packId', p_pack_id, 'openingId', v_opening_id, 'giftId', p_gift_id)
  );

  insert into public.pack_openings(id, tournament_id, team_id, profile_id, pack_id, price, cards, weights, pool_by_overall, created_at)
  values (v_opening_id, p_tournament_id, p_team_id, p_actor_profile_id, p_pack_id, v_price, v_result, v_weights, v_pool_snapshot, v_now);

  if p_gift_id is not null then
    update public.pack_gifts set used_opening_id = v_opening_id, used_at = v_now where id = p_gift_id;
  end if;

  return jsonb_build_object(
    'gift', p_gift_id is not null,
    'ok', true, 'openingId', v_opening_id, 'packId', p_pack_id, 'catalogId', v_catalog_id, 'price', v_price,
    'balanceBefore', v_before, 'balanceAfter', v_after, 'cards', v_result,
    'interaction', v_interaction, 'chosenIndex', case when v_interaction = 'pick' then p_pick_index else null end,
    'pending', (v_interaction = 'pick' and p_pick_index is null)
  );
end;
$$;


-- Estorno: se a abertura veio de um presente, o presente volta a ficar disponível (o preço era 0).
create or replace function public._restore_gift_on_rollback()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.rolled_back_at is not null and old.rolled_back_at is null then
    update public.pack_gifts set used_opening_id = null, used_at = null where used_opening_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists pack_openings_restore_gift on public.pack_openings;
create trigger pack_openings_restore_gift after update of rolled_back_at on public.pack_openings
for each row execute function public._restore_gift_on_rollback();

revoke all on function public.open_pack(text, text, text, text, text, integer, text) from public;
grant execute on function public.open_pack(text, text, text, text, text, integer, text) to anon, authenticated;
revoke all on function public.grant_pack_gift(text, text[], text, integer, text) from public;
grant execute on function public.grant_pack_gift(text, text[], text, integer, text) to anon, authenticated;
revoke all on function public.revoke_pack_gift(text, text) from public;
grant execute on function public.revoke_pack_gift(text, text) to anon, authenticated;
revoke all on function public._assert_admin(text) from public, anon, authenticated;

commit;
