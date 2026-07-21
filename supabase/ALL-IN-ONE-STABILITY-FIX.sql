begin;

alter table public.tournaments
  add column if not exists roster_settings jsonb;

create or replace function public.set_team_budget(
  p_tournament_id text,
  p_team_id text,
  p_amount numeric,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric := greatest(0, coalesce(p_amount, 0));
  v_tx_id text := gen_random_uuid()::text;
  v_created_at timestamptz := now();
begin
  select budget into v_before
  from public.teams
  where id = p_team_id and tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  if coalesce(v_before, 0) = v_after then
    return jsonb_build_object('amount', v_after, 'changed', false);
  end if;

  update public.teams
  set budget = v_after, updated_at = v_created_at
  where id = p_team_id and tournament_id = p_tournament_id;

  insert into public.financial_transactions(
    id, tournament_id, team_id, transaction_type, amount,
    balance_before, balance_after, label, reference_id, created_at
  ) values (
    v_tx_id, p_tournament_id, p_team_id, 'admin_adjustment', v_after - coalesce(v_before, 0),
    coalesce(v_before, 0), v_after, 'Ajuste manual do administrador',
    case when p_actor_profile_id is null then null else 'admin:' || p_actor_profile_id end,
    v_created_at
  );

  return jsonb_build_object(
    'amount', v_after,
    'changed', true,
    'transaction', jsonb_build_object(
      'id', v_tx_id,
      'teamId', p_team_id,
      'type', 'admin_adjustment',
      'amount', v_after - coalesce(v_before, 0),
      'balanceBefore', coalesce(v_before, 0),
      'balanceAfter', v_after,
      'label', 'Ajuste manual do administrador',
      'referenceId', case when p_actor_profile_id is null then null else 'admin:' || p_actor_profile_id end,
      'createdAt', extract(epoch from v_created_at) * 1000
    )
  );
end;
$$;

create or replace function public.update_tournament_admin_settings(
  p_tournament_id text,
  p_patch jsonb,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tournaments%rowtype;
begin
  update public.tournaments
  set
    economy_settings = case when p_patch ? 'economySettings' then p_patch->'economySettings' else economy_settings end,
    final_prize_settings = case when p_patch ? 'finalPrizeSettings' then p_patch->'finalPrizeSettings' else final_prize_settings end,
    market_balance_settings = case when p_patch ? 'marketBalanceSettings' then p_patch->'marketBalanceSettings' else market_balance_settings end,
    market_settings = case when p_patch ? 'marketSettings' then p_patch->'marketSettings' else market_settings end,
    roster_settings = case when p_patch ? 'rosterSettings' then p_patch->'rosterSettings' else roster_settings end,
    updated_at = now()
  where id = p_tournament_id
  returning * into v_row;

  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'economySettings', v_row.economy_settings,
    'finalPrizeSettings', v_row.final_prize_settings,
    'marketBalanceSettings', v_row.market_balance_settings,
    'marketSettings', v_row.market_settings,
    'rosterSettings', v_row.roster_settings
  );
end;
$$;

grant execute on function public.set_team_budget(text,text,numeric,text) to anon, authenticated;
grant execute on function public.update_tournament_admin_settings(text,jsonb,text) to anon, authenticated;

commit;
