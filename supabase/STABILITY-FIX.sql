begin;

create or replace function public.set_team_budget(
  p_tournament_id text,
  p_team_id text,
  p_amount numeric,
  p_transaction_id text,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_delta numeric(14,2);
  v_created_at timestamptz := now();
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'Saldo inválido';
  end if;

  select budget into v_before
  from public.teams
  where id = p_team_id and tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'Time não encontrado no campeonato';
  end if;

  v_after := round(p_amount, 2);
  v_delta := v_after - coalesce(v_before, 0);

  if v_delta = 0 then
    return jsonb_build_object('ok', true, 'changed', false, 'budget', v_after);
  end if;

  update public.teams
  set budget = v_after
  where id = p_team_id and tournament_id = p_tournament_id;

  insert into public.financial_transactions(
    id, tournament_id, team_id, transaction_type, amount,
    balance_before, balance_after, label, reference_id, created_at, raw_data
  ) values (
    p_transaction_id, p_tournament_id, p_team_id, 'admin_adjustment', v_delta,
    v_before, v_after, 'Ajuste manual do administrador', null, v_created_at,
    jsonb_build_object('actorProfileId', p_actor_profile_id)
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'budget', v_after,
    'transaction', jsonb_build_object(
      'id', p_transaction_id,
      'teamId', p_team_id,
      'type', 'admin_adjustment',
      'amount', v_delta,
      'balanceBefore', v_before,
      'balanceAfter', v_after,
      'label', 'Ajuste manual do administrador',
      'referenceId', null,
      'createdAt', extract(epoch from v_created_at) * 1000
    )
  );
end;
$$;

grant execute on function public.set_team_budget(text,text,numeric,text,text) to anon, authenticated;

commit;
