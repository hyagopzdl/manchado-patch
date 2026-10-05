-- SOMENTE LEITURA. Não altera nada.
-- Rode no SQL Editor do Supabase e cole o resultado (uma única célula JSON) na conversa.
-- Serve para escrever o PACKS-V1.sql com os tipos e regras reais do banco.

select jsonb_pretty(jsonb_build_object(
  'columns', (
    select jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'type', data_type,
      'nullable', is_nullable, 'default', column_default
    ) order by table_name, ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('tournaments','teams','player_ownership','transfers',
                         'financial_transactions','trade_offers','player_catalog_overrides','app_meta')
  ),
  'constraints', (
    select jsonb_agg(jsonb_build_object('table', c.relname, 'name', k.conname, 'def', pg_get_constraintdef(k.oid)))
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    where k.connamespace = 'public'::regnamespace
      and c.relname in ('tournaments','teams','player_ownership','transfers','financial_transactions','trade_offers')
  ),
  'rls', (
    select jsonb_agg(jsonb_build_object('table', relname, 'rls_enabled', relrowsecurity))
    from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
      and relname in ('tournaments','teams','player_ownership','transfers','financial_transactions','trade_offers')
  ),
  'triggers', (
    select jsonb_agg(jsonb_build_object('table', c.relname, 'name', t.tgname, 'def', pg_get_triggerdef(t.oid)))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      and c.relname in ('tournaments','teams','player_ownership','transfers','financial_transactions')
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object('name', proname, 'def', pg_get_functiondef(oid)))
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('pay_player_release_clause','apply_tournament_delta')
  )
)) as schema_report;
