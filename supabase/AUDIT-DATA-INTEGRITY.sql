-- Execute apenas para consulta. Este arquivo não altera dados.

-- 1. Transações repetidas para a mesma partida/time/tipo.
select tournament_id, team_id, reference_id, transaction_type, count(*) as occurrences,
       sum(amount) as total_amount, min(created_at) as first_at, max(created_at) as last_at
from public.financial_transactions
where reference_id is not null
  and transaction_type in ('match_reward','match_reward_migration','match_win_reward','match_draw_reward')
group by tournament_id, team_id, reference_id, transaction_type
having count(*) > 1
order by occurrences desc, last_at desc;

-- 2. Saldo atual comparado ao último balance_after registrado.
with latest_tx as (
  select distinct on (tournament_id, team_id)
    tournament_id, team_id, balance_after, created_at
  from public.financial_transactions
  order by tournament_id, team_id, created_at desc
)
select t.tournament_id, t.id as team_id, t.name, t.budget,
       l.balance_after as latest_recorded_balance,
       t.budget - coalesce(l.balance_after, t.budget) as difference,
       l.created_at as latest_transaction_at
from public.teams t
left join latest_tx l on l.tournament_id = t.tournament_id and l.team_id = t.id
where l.balance_after is not null and t.budget <> l.balance_after
order by abs(t.budget - l.balance_after) desc;

-- 3. Partidas jogadas sem qualquer transação de recompensa.
select m.tournament_id, m.id as match_id, m.home_team_id, m.away_team_id, m.played_at
from public.matches m
where m.played = true
  and not exists (
    select 1 from public.financial_transactions f
    where f.tournament_id = m.tournament_id
      and f.reference_id = m.id
      and f.transaction_type in ('match_reward','match_reward_migration','match_win_reward','match_draw_reward')
  )
order by m.played_at desc nulls last;

-- 4. Times sem campeonato válido.
select t.*
from public.teams t
left join public.tournaments c on c.id = t.tournament_id
where c.id is null;

-- 5. Partidas com referência a times inexistentes.
select m.*
from public.matches m
left join public.teams h on h.id = m.home_team_id and h.tournament_id = m.tournament_id
left join public.teams a on a.id = m.away_team_id and a.tournament_id = m.tournament_id
where (m.home_team_id is not null and h.id is null)
   or (m.away_team_id is not null and a.id is null);
