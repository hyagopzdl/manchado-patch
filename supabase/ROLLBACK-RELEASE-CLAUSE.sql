-- Estorno de multa rescisória (somente admin). Aditivo: só cria uma função nova.
-- Desfaz o que pay_player_release_clause fez, de forma atômica:
--   * devolve o jogador ao time vendedor e reverte os saldos (comprador +multa, vendedor -multa)
--   * lança estornos no extrato e marca os lançamentos originais e a transferência como revertidos
--   * devolve o valor de mercado do jogador ao que era antes (se ninguém o alterou depois)
--   * remove o contrato protegido do comprador, desconta uma multa sofrida do vendedor
--     e devolve a blindagem que a multa consumiu
-- Bloqueia (player_changed) se o jogador já saiu do time comprador.
-- Idempotente: pode ser aplicado mais de uma vez.

begin;

create or replace function public.rollback_release_clause(
  p_transfer_id text,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_tr public.transfers%rowtype;
  v_t public.tournaments%rowtype;
  v_owner public.player_ownership%rowtype;
  v_buyer public.teams%rowtype;
  v_seller public.teams%rowtype;
  v_clause numeric;
  v_buyer_before numeric;
  v_seller_before numeric;
  v_now timestamptz := clock_timestamp();
  v_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_rb_id text;
  v_state jsonb;
  v_contracts jsonb;
  v_suffered jsonb;
  v_shielding jsonb;
  v_shield numeric;
  v_count integer;
  v_new_value numeric;
  v_old_value numeric;
begin
  -- Serializa com apply_tournament_delta e com as outras RPCs de mercado.
  perform pg_advisory_xact_lock(hashtext('manchado:tournament-delta:v7'));

  select * into v_actor from public.profiles where id = p_actor_profile_id;
  if not found or not (v_actor.role = 'admin' or lower(trim(coalesce(v_actor.name, ''))) = 'admin') then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  select * into v_tr from public.transfers where id = p_transfer_id for update;
  if not found or v_tr.transfer_type is distinct from 'release_clause' then
    raise exception 'transfer_not_found' using errcode = 'P0001';
  end if;
  if coalesce(v_tr.raw_data->>'rolledBackAt', '') <> '' then
    raise exception 'already_rolled_back' using errcode = 'P0001';
  end if;

  select * into v_t from public.tournaments where id = v_tr.tournament_id for update;
  if not found then raise exception 'transfer_not_found' using errcode = 'P0001'; end if;

  select * into v_owner from public.player_ownership
  where tournament_id = v_tr.tournament_id and player_id = v_tr.player_id for update;
  if not found or v_owner.team_id is distinct from v_tr.to_team_id then
    raise exception 'player_changed' using errcode = 'P0001';
  end if;

  select * into v_buyer from public.teams where tournament_id = v_tr.tournament_id and id = v_tr.to_team_id for update;
  select * into v_seller from public.teams where tournament_id = v_tr.tournament_id and id = v_tr.from_team_id for update;
  if v_buyer.id is null or v_seller.id is null then raise exception 'team_not_found' using errcode = 'P0001'; end if;

  v_clause := coalesce(v_tr.price, 0);
  v_rb_id := 'release_clause_rb_' || substr(md5(p_transfer_id || ':' || v_now::text), 1, 16);
  v_buyer_before := coalesce(v_buyer.budget, 0);
  v_seller_before := coalesce(v_seller.budget, 0);

  -- Saldos (mesma regra do estorno de compra existente: o admin pode deixar o vendedor negativo).
  update public.teams set budget = v_buyer_before + v_clause, updated_at = now() where tournament_id = v_tr.tournament_id and id = v_buyer.id;
  update public.teams set budget = v_seller_before - v_clause, updated_at = now() where tournament_id = v_tr.tournament_id and id = v_seller.id;

  -- Posse volta ao vendedor.
  update public.player_ownership
  set team_id = v_seller.id, for_sale = false, acquisition_source = 'rollback', acquired_at = v_now,
      raw_data = coalesce(raw_data, '{}'::jsonb) - 'releaseClause' - 'previousTeamId' - 'clausePaid' - 'marketValueBefore' - 'marketValueAfter'
  where tournament_id = v_tr.tournament_id and player_id = v_tr.player_id;

  -- Extrato: marca os lançamentos originais e lança os estornos.
  update public.financial_transactions
  set raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('rolledBackAt', v_now_ms, 'rolledBackByProfileId', p_actor_profile_id, 'rollbackId', v_rb_id)
  where tournament_id = v_tr.tournament_id and reference_id = v_tr.id
    and transaction_type in ('release_clause_purchase', 'release_clause_sale');

  insert into public.financial_transactions(id, tournament_id, team_id, transaction_type, amount, balance_before, balance_after, label, reference_id, operation_id, created_at, raw_data)
  values
    (v_rb_id || '_buyer', v_tr.tournament_id, v_buyer.id, 'release_clause_rollback', v_clause, v_buyer_before, v_buyer_before + v_clause,
     'Estorno da multa rescisória - ' || coalesce(v_tr.player_name, 'Jogador'), v_rb_id, gen_random_uuid(), v_now,
     jsonb_build_object('transferId', v_tr.id, 'actorProfileId', p_actor_profile_id)),
    (v_rb_id || '_seller', v_tr.tournament_id, v_seller.id, 'release_clause_rollback', -v_clause, v_seller_before, v_seller_before - v_clause,
     'Estorno da multa rescisória - ' || coalesce(v_tr.player_name, 'Jogador'), v_rb_id, gen_random_uuid(), v_now,
     jsonb_build_object('transferId', v_tr.id, 'actorProfileId', p_actor_profile_id));

  -- Valor de mercado: só restaura se ninguém alterou depois da multa.
  v_new_value := nullif(v_tr.raw_data->>'newMarketValue', '')::numeric;
  v_old_value := v_tr.market_value;
  if v_new_value is not null and v_old_value is not null then
    update public.player_catalog_overrides
    set market_value = v_old_value, updated_by_profile_id = p_actor_profile_id, updated_at = v_now
    where player_id = v_tr.player_id and market_value = v_new_value;
  end if;

  -- Estado da multa no torneio: contrato, multas sofridas e blindagem.
  v_state := coalesce(v_t.raw_data->'releaseClauseState', '{}'::jsonb);
  v_contracts := coalesce(v_state->'contracts', '{}'::jsonb);
  if coalesce(v_contracts->v_tr.player_id->>'teamId', '') = v_buyer.id
     and coalesce(v_contracts->v_tr.player_id->>'source', '') = 'release_clause' then
    v_contracts := v_contracts - v_tr.player_id;
  end if;
  v_suffered := coalesce(v_state->'sufferedByTeam', '{}'::jsonb);
  v_count := greatest(0, coalesce(nullif(v_suffered->>v_seller.id, '')::integer, 0) - 1);
  v_suffered := jsonb_set(v_suffered, array[v_seller.id], to_jsonb(v_count), true);
  v_shield := coalesce(nullif(v_tr.raw_data->>'shieldingUsed', '')::numeric, 0);
  v_shielding := coalesce(v_state->'shielding', '{}'::jsonb);
  if v_shield > 0 and not (v_shielding ? v_tr.player_id) then
    v_shielding := jsonb_set(v_shielding, array[v_tr.player_id], jsonb_build_object('teamId', v_seller.id, 'amount', v_shield), true);
  end if;
  v_state := jsonb_set(v_state, '{contracts}', v_contracts, true);
  v_state := jsonb_set(v_state, '{sufferedByTeam}', v_suffered, true);
  v_state := jsonb_set(v_state, '{shielding}', v_shielding, true);
  update public.tournaments
  set raw_data = jsonb_set(coalesce(raw_data, '{}'::jsonb), '{releaseClauseState}', v_state, true)
  where id = v_tr.tournament_id;

  -- A transferência fica marcada como revertida (o histórico mostra "revertida").
  update public.transfers
  set raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('rolledBackAt', v_now_ms, 'rolledBackByProfileId', p_actor_profile_id, 'rollbackId', v_rb_id)
  where id = v_tr.id;

  return jsonb_build_object('ok', true, 'transferId', v_tr.id, 'playerId', v_tr.player_id, 'refunded', v_clause,
                            'buyerBudget', v_buyer_before + v_clause, 'sellerBudget', v_seller_before - v_clause);
end;
$$;

revoke all on function public.rollback_release_clause(text, text) from public;
grant execute on function public.rollback_release_clause(text, text) to anon, authenticated;

commit;
