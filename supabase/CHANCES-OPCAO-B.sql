-- Preenche as chances (em %) dos pacotes com a "opção B" da planilha.
-- É o mesmo efeito de digitar os valores no Configurar do Mercado: substitui só os pesos de cada pacote
-- (preço, cartas, marcos e demais configurações ficam como estão).
--
-- COMO USAR
--   1) Descubra o id do campeonato de cartas:
--        select id, name from public.tournaments where raw_data->>'mode' = 'packs' order by created_at desc;
--   2) Troque COLE_O_ID_AQUI abaixo pelo id e rode o arquivo inteiro no SQL Editor.
--   3) Recarregue o app (Mercado → Configurar mostra os valores).
--
-- ATENÇÃO À ORDEM DAS COLUNAS: na planilha a ordem é bronze, prata, ouro, diamante, platina, mas a 4ª coluna
-- tem as chances mais baixas e a 5ª as mais altas (sobe de bronze até a última). Como no app platina é o 4º pacote
-- (370M) e diamante o 5º (580M), mapeei: 4ª coluna -> platina, 5ª coluna -> diamante.
-- Se na verdade vale o rótulo da planilha, troque 'platina' por 'diamante' (e vice-versa) nas duas linhas indicadas.
-- Overalls sem valor ficam sem chance (os pesos antigos de 65-74 são removidos).

do $$
declare
  v_tid text := 'COLE_O_ID_AQUI';
  v_packs jsonb;
  v_new jsonb;
  v_rows integer;
begin
  select raw_data->'packSettings'->'packs' into v_packs from public.tournaments where id = v_tid;
  if v_packs is null then raise exception 'Campeonato % não encontrado ou sem packSettings. Confira o id.', v_tid; end if;

  select jsonb_agg(
           case when w.id is not null then p || jsonb_build_object('weights', w.weights) else p end
           order by x.o)
    into v_new
  from jsonb_array_elements(v_packs) with ordinality as x(p, o)
  left join (values
      ('bronze', '{"75": 5, "76": 7.5, "77": 15, "78": 20, "79": 20, "80": 15, "81": 7.5, "82": 5, "83": 2.5, "84": 1, "85": 0.7, "86": 0.4, "87": 0.2, "88": 0.1, "89": 0.05, "90": 0.025, "91": 0.01, "92": 0.0075, "93": 0.005, "94": 0.0025}'::jsonb),
      ('prata', '{"75": 1, "76": 3, "77": 6, "78": 10, "79": 15, "80": 10, "81": 20, "82": 15, "83": 10, "84": 5, "85": 2.5, "86": 1, "87": 0.7, "88": 0.4, "89": 0.2, "90": 0.1, "91": 0.05, "92": 0.025, "93": 0.01, "94": 0.0075, "95": 0.005, "96": 0.0025}'::jsonb),
      ('ouro', '{"75": 0.25, "76": 0.5, "77": 0.75, "78": 1, "79": 2, "80": 4, "81": 8, "82": 15, "83": 20, "84": 18, "85": 14, "86": 7, "87": 5, "88": 2.5, "89": 1, "90": 0.5, "91": 0.25, "92": 0.09, "93": 0.06, "94": 0.04, "95": 0.03, "96": 0.02, "97": 0.01}'::jsonb),
      ('platina', '{"75": 0.1, "76": 0.2, "77": 0.5, "78": 0.7, "79": 1, "80": 2, "81": 4, "82": 7.5, "83": 12.5, "84": 20, "85": 12.5, "86": 12.5, "87": 9, "88": 5, "89": 4, "90": 3, "91": 2.5, "92": 1, "93": 0.75, "94": 0.5, "95": 0.25, "96": 0.25, "97": 0.25}'::jsonb),
      ('diamante', '{"77": 0.1, "78": 0.2, "79": 0.5, "80": 0.7, "81": 1, "82": 2.5, "83": 4, "84": 7, "85": 10, "86": 15, "87": 20, "88": 15, "89": 7, "90": 5, "91": 4, "92": 3, "93": 2, "94": 1, "95": 1, "96": 0.5, "97": 0.5}'::jsonb)
  ) as w(id, weights) on w.id = x.p->>'id';

  update public.tournaments
     set raw_data = jsonb_set(
           jsonb_set(raw_data, '{packSettings,packs}', v_new),
           '{packSettings,updatedAt}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint))
   where id = v_tid;
  get diagnostics v_rows = row_count;
  raise notice 'Chances atualizadas em % campeonato(s).', v_rows;
end $$;

-- Conferência: cada pacote deve somar 100.
select p->>'id' as pacote, round((select sum(value::numeric) from jsonb_each_text(p->'weights')), 4) as soma_pct
from public.tournaments t, jsonb_array_elements(t.raw_data->'packSettings'->'packs') p
where t.id = 'COLE_O_ID_AQUI';
