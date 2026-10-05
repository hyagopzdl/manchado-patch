-- TESTE DE FUMAÇA do modo cartas, para rodar no banco REAL depois de aplicar
-- PACKS-V1.sql e catalog-seeds/default.sql.
--
-- Não deixa rastro: tudo roda dentro de um bloco que termina de propósito com um erro,
-- o que desfaz (rollback) tudo o que o teste criou. O RESULTADO APARECE COMO MENSAGEM DE ERRO:
--   "SMOKE_OK ..."   = tudo certo
--   "SMOKE_FAIL ..." = algo falhou (copie a mensagem completa)
-- Requisitos: ao menos um perfil existente na tabela profiles.

do $$
declare
  v_profile text;
  v_admin text;
  v_tid text := 'zz_smoke_' || substr(md5(random()::text), 1, 8);
  v_res jsonb;
  v_rb jsonb;
  v_checksum text;
  v_report text := '';
  v_n integer;
  v_budget numeric;
begin
  select id into v_profile from public.profiles order by id limit 1;
  if v_profile is null then raise exception 'SMOKE_FAIL sem nenhum perfil em profiles'; end if;
  select id into v_admin from public.profiles where role = 'admin' or lower(trim(coalesce(name,''))) = 'admin' limit 1;
  select source_checksum into v_checksum from public.player_catalog_meta where catalog_id = 'default';
  if v_checksum is null then raise exception 'SMOKE_FAIL catalogo default nao carregado (rode catalog-seeds/default.sql)'; end if;

  insert into public.tournaments(id, name, status, market_settings, raw_data) values (
    v_tid, 'SMOKE TEST', 'ongoing', '{}'::jsonb,
    jsonb_build_object('mode', 'packs', 'packSettings', jsonb_build_object(
      'rosterMax', 30,
      'packs', jsonb_build_array(jsonb_build_object(
        'id', 'smoke', 'label', 'Smoke', 'price', 1, 'cards', 3,
        'weights', '{"75":1,"78":1,"80":1}'::jsonb))))
  );
  insert into public.teams(id, tournament_id, profile_id, name, budget) values (v_tid || '_t', v_tid, v_profile, 'Smoke FC', 10);

  -- 1) abertura com checksum correto
  v_res := public.open_pack(v_tid, 'smoke', v_tid || '_t', v_profile, v_checksum);
  if jsonb_array_length(v_res->'cards') <> 3 then raise exception 'SMOKE_FAIL esperava 3 cartas, veio %', v_res; end if;
  v_report := v_report || 'abertura ok; ';

  -- 2) efeitos gravados
  select budget into v_budget from public.teams where id = v_tid || '_t';
  if v_budget <> 9 then raise exception 'SMOKE_FAIL saldo esperado 9, veio %', v_budget; end if;
  select count(*) into v_n from public.player_ownership where tournament_id = v_tid and acquisition_source = 'pack';
  if v_n <> 3 then raise exception 'SMOKE_FAIL posse esperada 3, veio %', v_n; end if;
  select count(*) into v_n from public.transfers where tournament_id = v_tid and transfer_type = 'pack_pull';
  if v_n <> 3 then raise exception 'SMOKE_FAIL transfers esperados 3, veio %', v_n; end if;
  select count(*) into v_n from public.financial_transactions where tournament_id = v_tid and transaction_type = 'pack_purchase';
  if v_n <> 1 then raise exception 'SMOKE_FAIL lancamento financeiro esperado 1, veio %', v_n; end if;
  select count(*) into v_n from public.pack_openings where tournament_id = v_tid;
  if v_n <> 1 then raise exception 'SMOKE_FAIL log esperado 1, veio %', v_n; end if;
  v_report := v_report || 'efeitos ok; ';

  -- 3) guarda de versao
  begin
    perform public.open_pack(v_tid, 'smoke', v_tid || '_t', v_profile, 'checksum-errado');
    raise exception 'SMOKE_FAIL guarda de versao nao bloqueou';
  exception when others then
    if sqlerrm <> 'catalog_outdated' then raise exception 'SMOKE_FAIL guarda de versao: %', sqlerrm; end if;
  end;
  v_report := v_report || 'guarda de versao ok; ';

  -- 4) perfil errado / sem perfil
  begin
    perform public.open_pack(v_tid, 'smoke', v_tid || '_t', null, v_checksum);
    raise exception 'SMOKE_FAIL aceitou perfil nulo';
  exception when others then
    if sqlerrm <> 'not_team_owner' then raise exception 'SMOKE_FAIL perfil nulo: %', sqlerrm; end if;
  end;
  v_report := v_report || 'autorizacao ok; ';

  -- 5) rollback (se houver admin)
  if v_admin is not null then
    v_rb := public.rollback_pack_opening(v_res->>'openingId', v_admin);
    select budget into v_budget from public.teams where id = v_tid || '_t';
    if v_budget <> 10 then raise exception 'SMOKE_FAIL rollback nao devolveu o saldo (%)', v_budget; end if;
    v_report := v_report || 'rollback ok; ';
  else
    v_report := v_report || 'rollback PULADO (sem perfil admin); ';
  end if;

  -- Erro proposital: desfaz tudo que o teste criou.
  raise exception 'SMOKE_OK % (nada foi gravado: esta mensagem e o rollback proposital)', v_report;
end $$;
