begin;

create or replace function public.apply_guarded_direct_patch(
  p_documents jsonb,
  p_delete_keys text[],
  p_intent jsonb default '{}'::jsonb,
  p_actor_profile_id text default null,
  p_event_type text default 'state_change'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_tournament_id text;
  v_doc jsonb;
  v_context jsonb;
  v_missing text[];
  v_allowed text[];
  v_invalid text[];
begin
  if p_documents is null then
    p_documents := '{}'::jsonb;
  end if;
  if p_delete_keys is null then
    p_delete_keys := array[]::text[];
  end if;
  if p_intent is null then
    p_intent := '{}'::jsonb;
  end if;

  -- Serialize writes for the same application. This closes the gap between the
  -- client's fresh read/merge and the destructive legacy RPC.
  perform pg_advisory_xact_lock(hashtext('manchado:guarded-direct-patch'));

  for v_entry in
    select key, value
    from jsonb_each(p_documents)
    where key like 'tournament:%'
  loop
    v_tournament_id := substring(v_entry.key from length('tournament:') + 1);
    v_doc := coalesce(v_entry.value, '{}'::jsonb);
    v_context := coalesce(v_doc->'context', '{}'::jsonb);

    -- Every existing row omitted from a full tournament document must be
    -- explicitly declared as an intended deletion. Missing data can never be
    -- interpreted as permission to wipe a normalized table.

    select coalesce(array_agg(x.id order by x.id), array[]::text[])
      into v_missing
    from (
      select t.id::text
      from public.teams t
      where t.tournament_id = v_tournament_id
      except
      select item->>'id'
      from jsonb_array_elements(coalesce(v_context->'teams', '[]'::jsonb)) item
    ) x;
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','teams']), '[]'::jsonb));
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_invalid
    from unnest(v_missing) x
    where not (x = any(v_allowed));
    if cardinality(v_invalid) > 0 then
      raise exception 'Guarded patch blocked: teams omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
    end if;

    select coalesce(array_agg(x.id order by x.id), array[]::text[])
      into v_missing
    from (
      select m.id::text
      from public.matches m
      where m.tournament_id = v_tournament_id
      except
      select item->>'id'
      from jsonb_array_elements(coalesce(v_context->'matches', v_doc->'matches', '[]'::jsonb)) item
    ) x;
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','matches']), '[]'::jsonb));
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_invalid
    from unnest(v_missing) x
    where not (x = any(v_allowed));
    if cardinality(v_invalid) > 0 then
      raise exception 'Guarded patch blocked: matches omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
    end if;

    select coalesce(array_agg(x.id order by x.id), array[]::text[])
      into v_missing
    from (
      select po.player_id::text as id
      from public.player_ownership po
      where po.tournament_id = v_tournament_id
      except
      select key
      from jsonb_each(coalesce(v_context->'ownership', '{}'::jsonb))
    ) x;
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','ownership']), '[]'::jsonb));
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_invalid
    from unnest(v_missing) x
    where not (x = any(v_allowed));
    if cardinality(v_invalid) > 0 then
      raise exception 'Guarded patch blocked: ownership omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
    end if;

    select coalesce(array_agg(x.id order by x.id), array[]::text[])
      into v_missing
    from (
      select ps.player_id::text as id
      from public.player_stats ps
      where ps.tournament_id = v_tournament_id
      except
      select key
      from jsonb_each(coalesce(v_context->'playerStats', '{}'::jsonb))
    ) x;
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','playerStats']), '[]'::jsonb));
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_invalid
    from unnest(v_missing) x
    where not (x = any(v_allowed));
    if cardinality(v_invalid) > 0 then
      raise exception 'Guarded patch blocked: player_stats omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
    end if;

    select coalesce(array_agg(x.id order by x.id), array[]::text[])
      into v_missing
    from (
      select o.id::text
      from public.trade_offers o
      where o.tournament_id = v_tournament_id
      except
      select key
      from jsonb_each(coalesce(v_context->'tradeOffers', '{}'::jsonb))
    ) x;
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','tradeOffers']), '[]'::jsonb));
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_invalid
    from unnest(v_missing) x
    where not (x = any(v_allowed));
    if cardinality(v_invalid) > 0 then
      raise exception 'Guarded patch blocked: trade_offers omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
    end if;

    select coalesce(array_agg(x.id order by x.id), array[]::text[])
      into v_missing
    from (
      select tr.id::text
      from public.transfers tr
      where tr.tournament_id = v_tournament_id
      except
      select item->>'id'
      from jsonb_array_elements(coalesce(v_context->'transfers', '[]'::jsonb)) item
    ) x;
    select coalesce(array_agg(value order by value), array[]::text[])
      into v_allowed
    from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','transfers']), '[]'::jsonb));
    select coalesce(array_agg(x order by x), array[]::text[])
      into v_invalid
    from unnest(v_missing) x
    where not (x = any(v_allowed));
    if cardinality(v_invalid) > 0 then
      raise exception 'Guarded patch blocked: transfers omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
    end if;

    -- Financial transactions are lazy-loaded. Validate them only when the
    -- collection is explicitly present in the document.
    if v_context ? 'financialTransactions' then
      select coalesce(array_agg(x.id order by x.id), array[]::text[])
        into v_missing
      from (
        select ft.id::text
        from public.financial_transactions ft
        where ft.tournament_id = v_tournament_id
        except
        select item->>'id'
        from jsonb_array_elements(coalesce(v_context->'financialTransactions', '[]'::jsonb)) item
      ) x;
      select coalesce(array_agg(value order by value), array[]::text[])
        into v_allowed
      from jsonb_array_elements_text(coalesce(p_intent#>(array['tournaments',v_tournament_id,'delete','financialTransactions']), '[]'::jsonb));
      select coalesce(array_agg(x order by x), array[]::text[])
        into v_invalid
      from unnest(v_missing) x
      where not (x = any(v_allowed));
      if cardinality(v_invalid) > 0 then
        raise exception 'Guarded patch blocked: financial transactions omitted without explicit delete intent for tournament %: %', v_tournament_id, array_to_string(v_invalid, ', ');
      end if;
    end if;
  end loop;

  perform public.apply_direct_patch(
    p_documents,
    p_delete_keys,
    p_actor_profile_id,
    p_event_type
  );
end;
$$;

revoke all on function public.apply_guarded_direct_patch(jsonb,text[],jsonb,text,text) from public;
grant execute on function public.apply_guarded_direct_patch(jsonb,text[],jsonb,text,text) to anon, authenticated;

-- The destructive RPC remains unavailable to browser roles. Only the guarded
-- SECURITY DEFINER wrapper may invoke it.
revoke all on function public.apply_direct_patch(jsonb,text[],text,text) from public, anon, authenticated;

commit;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('apply_direct_patch','apply_guarded_direct_patch')
order by p.proname;
