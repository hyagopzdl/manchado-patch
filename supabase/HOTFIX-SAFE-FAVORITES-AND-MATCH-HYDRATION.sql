begin;

-- Favorite writes are isolated to one row. This function never touches
-- tournaments, matches, teams, profiles, or any other favorite.
create or replace function public.set_profile_favorite(
  p_tournament_id text,
  p_profile_id text,
  p_player_id text,
  p_favorite boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tournament_id is null or btrim(p_tournament_id) = '' then
    raise exception 'tournament id is required';
  end if;
  if p_profile_id is null or btrim(p_profile_id) = '' then
    raise exception 'profile id is required';
  end if;
  if p_player_id is null or btrim(p_player_id) = '' then
    raise exception 'player id is required';
  end if;

  if coalesce(p_favorite, false) then
    insert into public.profile_favorites(tournament_id, profile_id, player_id)
    values (p_tournament_id, p_profile_id, p_player_id)
    on conflict (tournament_id, profile_id, player_id) do nothing;
  else
    delete from public.profile_favorites f
    where f.tournament_id = p_tournament_id
      and f.profile_id = p_profile_id
      and f.player_id = p_player_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'tournamentId', p_tournament_id,
    'profileId', p_profile_id,
    'playerId', p_player_id,
    'favorite', coalesce(p_favorite, false)
  );
end;
$$;

grant execute on function public.set_profile_favorite(text,text,text,boolean) to anon, authenticated;

commit;
