-- V5 hotfix: stops presence writes from being required by the generic RPC
-- and rewrites favorite synchronization with unambiguous loop variables.

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
  v_key text;
  v_document jsonb;
  v_id text;
  v_item jsonb;
  v_tournament_id text;
  v_tournament_preferences jsonb;
  v_profile_id text;
  v_profile_preferences jsonb;
  v_player_id text;
  v_favorite_value jsonb;
begin
  set constraints all deferred;

  foreach v_key in array coalesce(p_delete_keys,'{}') loop
    if v_key like 'profile:%' then
      delete from public.profiles p where p.id=substr(v_key,9);
    elsif v_key like 'tournament:%' then
      delete from public.tournaments t where t.id=substr(v_key,12);
    elsif v_key like 'review:%' then
      delete from public.player_reviews r where r.id=substr(v_key,8);
    end if;
  end loop;

  for v_key,v_document in
    select e.key,e.value from jsonb_each(coalesce(p_documents,'{}'::jsonb)) as e
  loop
    if v_key like 'profile:%' then
      perform public.sync_profile_document(substr(v_key,9),v_document);

    elsif v_key like 'tournament:%' then
      perform public.sync_tournament_document(substr(v_key,12),v_document);

    elsif v_key like 'review:%' then
      perform public.sync_review_document(substr(v_key,8),v_document);

    elsif v_key='meta' then
      update public.app_meta set
        current_tournament_id=nullif(v_document->>'currentTournamentId',''),
        identity_schema_version=coalesce((v_document->>'identitySchemaVersion')::integer,0),
        identity_migrated_at=public.direct_ms(v_document->'identityMigratedAt'),
        season_counter=coalesce((v_document->>'seasonCounter')::integer,0),
        updated_at=now()
      where app_meta.id=true;

    elsif v_key='adminSecurity' then
      update public.admin_security set
        password_hash=v_document->>'passwordHash',
        updated_at=now(),
        updated_by_profile_id=p_actor_profile_id
      where admin_security.id=true;

    elsif v_key='ownership' then
      delete from public.global_player_ownership;
      for v_id,v_item in
        select e.key,e.value from jsonb_each(coalesce(v_document,'{}'::jsonb)) as e
      loop
        insert into public.global_player_ownership(player_id,team_id,for_sale,raw_data)
        values(v_id,nullif(v_item->>'teamId',''),coalesce((v_item->>'forSale')::boolean,false),'{}'::jsonb);
      end loop;

    elsif v_key='presence' then
      -- Presence is intentionally ignored by the generic patch RPC in V5.
      -- The frontend keeps this state locally to avoid recursive writes.
      null;

    elsif v_key='playerCatalogOverrides' then
      delete from public.player_catalog_overrides;
      for v_id,v_item in
        select e.key,e.value from jsonb_each(coalesce(v_document,'{}'::jsonb)) as e
      loop
        insert into public.player_catalog_overrides(player_id,overall,market_value,updated_by_profile_id,updated_at,raw_data)
        values(
          v_id,
          nullif(v_item->>'overall','')::integer,
          nullif(coalesce(v_item->>'value',v_item->>'marketValue'),'')::numeric,
          nullif(v_item->>'updatedByProfileId',''),
          coalesce(public.direct_ms(v_item->'updatedAt'),now()),
          '{}'::jsonb
        );
      end loop;

    elsif v_key='profileChampionshipPreferences' then
      delete from public.profile_favorites;

      for v_tournament_id,v_tournament_preferences in
        select e.key,e.value from jsonb_each(coalesce(v_document,'{}'::jsonb)) as e
      loop
        for v_profile_id,v_profile_preferences in
          select e.key,e.value from jsonb_each(coalesce(v_tournament_preferences,'{}'::jsonb)) as e
        loop
          for v_player_id,v_favorite_value in
            select e.key,e.value
            from jsonb_each(coalesce(v_profile_preferences->'favorites','{}'::jsonb)) as e
          loop
            if v_favorite_value = 'true'::jsonb then
              insert into public.profile_favorites(tournament_id,profile_id,player_id)
              values(v_tournament_id,v_profile_id,v_player_id)
              on conflict do nothing;
            end if;
          end loop;
        end loop;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'eventType',p_event_type);
end;
$$;

grant execute on function public.apply_direct_patch(jsonb,text[],text,text) to anon, authenticated;
