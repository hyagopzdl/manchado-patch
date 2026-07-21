-- Performance Pass v2
-- Execute uma vez no SQL Editor do Supabase.
-- Os indices usam IF NOT EXISTS e podem ser aplicados com seguranca.

create index if not exists financial_transactions_tournament_created_idx
  on public.financial_transactions (tournament_id, created_at desc);

create index if not exists financial_transactions_tournament_team_created_idx
  on public.financial_transactions (tournament_id, team_id, created_at desc);

create index if not exists transfers_tournament_created_idx
  on public.transfers (tournament_id, created_at desc);

create index if not exists trade_offers_tournament_status_updated_idx
  on public.trade_offers (tournament_id, status, updated_at desc);

create index if not exists player_reviews_status_created_idx
  on public.player_reviews (status, created_at desc);

create index if not exists player_review_votes_review_idx
  on public.player_review_votes (review_id);

create index if not exists profile_favorites_lookup_idx
  on public.profile_favorites (tournament_id, profile_id, player_id);

analyze public.financial_transactions;
analyze public.transfers;
analyze public.trade_offers;
analyze public.player_reviews;
analyze public.player_review_votes;
analyze public.profile_favorites;
