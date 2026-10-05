# Modo Cartas (pacotes) — especificação

Status: fase 1 (simulador) e fase 2 (backend) prontas. O app ainda não usa nada disso: nenhuma linha de `js/` ou `css/` foi alterada.

## Princípio de segurança
- Torneio ganha o campo `mode`: `"market"` (padrão, também para torneios sem o campo) ou `"packs"`.
- Todo código novo fica atrás de `mode === "packs"`. Torneios existentes não mudam de comportamento.
- Backend 100% aditivo: tabelas e funções novas, nenhuma coluna existente alterada.
- O sorteio roda numa RPC `security definer` (nunca no navegador), com lock por torneio.

## Decisões fechadas
| Tema | Decisão |
|---|---|
| Fonte dos jogadores | `players.json` (base) + overrides globais. Respeita `marketSettings.playerOverridesEnabled` do torneio. |
| Pool | Só jogadores sem posse naquele torneio. Sem repetição dentro do pacote. Jogador vendido volta ao pool. |
| Raridade | Só por overall. Pesos **por overall** (65–97), configuráveis no painel admin. Overall sem jogador livre é removido e os pesos renormalizados. |
| Preço | Fixo por pacote, configurável. |
| Desbloqueio | Pacotes liberados por marcos configuráveis (ver abaixo). |
| Moeda | Orçamento do time (economia existente). Dinheiro inicial: configuração que já existe no painel. |
| Venda ao mercado | Mantida. Depreciação configurável (`packSellDepreciationPct`). |
| Elenco | Mínimo 23 e máximo 30, configuráveis. |
| Mercado de jogadores | Some no modo cartas. A tela vira "Banco de jogadores" (consulta: stats, override, dono). |
| Trocas entre usuários | No modo cartas só por jogadores (sem dinheiro), N por M. **Fase posterior ao MVP.** |

## Marcos de desbloqueio
Cada pacote tem `unlock`: `null` (liberado desde o início) ou `{ packId, count }`.
Exemplo: Prata libera quando o total de pacotes Bronze abertos no torneio, somando todos os participantes, chegar a 200.
O estado é calculado a partir do log de aberturas (sem campo "desbloqueado" que possa dessincronizar).

## Regras de elenco
- O jogador **já começa com 23 jogadores** (elenco inicial balanceado, fluxo que já existe). O modo cartas só remove o mercado.
- Máximo (padrão 30, `packSettings.rosterMax`): abrir pacote é bloqueado se `elenco + cartas > máximo`. É preciso vender para abrir mais.
- Mínimo (padrão 23, `rosterSettings.minPlayers`): mantém a regra atual da venda (não vende se `elenco <= mínimo`).
- Consequência: o elenco oscila entre 23 e 30, e o dinheiro vem de vender o excedente.
- Regras atuais da venda que continuam valendo: depreciação do elenco inicial (50%), mínimo de jogadores base, trava de troca. A depreciação das cartas vindas de pacote passa a ser configurável (`sellDepreciationPct`) quando a venda for adaptada na fase 3.

## Config no torneio (`packSettings`)
```json
{
  "packs": [
    { "id": "bronze", "label": "Bronze", "price": 40, "cards": 3,
      "weights": { "65": 1, "72": 30, "97": 0 },
      "unlock": null }
  ],
  "sellDepreciationPct": 25,
  "rosterMin": 23,
  "rosterMax": 30,
  "eliteThreshold": 90
}
```

## Backend (pronto, testado em Postgres 16 com o schema real)
Arquivos em `supabase/`:
- `PACKS-V1.sql`: tabelas `player_catalog`, `player_catalog_meta`, `pack_openings` e as RPCs `open_pack` e `rollback_pack_opening`. Aditivo e idempotente. Não altera nenhuma tabela ou função existente.
- `PLAYER-CATALOG-SEED.sql`: carga do catálogo, **gerada** por `node tools/generate-catalog-sql.js`. Regenerar e reaplicar sempre que o `players.json` mudar.

**Como aplicar (ordem):** 1) `PACKS-V1.sql`  2) `PLAYER-CATALOG-SEED.sql`. Ambos no SQL Editor do Supabase. Como nada existente é alterado, os campeonatos atuais não são afetados.

**Decisões do `open_pack`:**
- Config e modo vêm do torneio no servidor (`raw_data->packSettings` e `raw_data->>'mode'`), nunca do cliente.
- Toma o mesmo advisory lock do `apply_tournament_delta`, então nenhuma escrita do app concorre com o sorteio.
- Autorização segue o padrão do `pay_player_release_clause`: o `profile_id` do time precisa ser o perfil informado.
- Pool = catálogo menos jogadores com posse (`team_id` não nulo), com overall/valor efetivos (override aplicado se o torneio o permite).
- Overall sem jogador livre é removido e os pesos renormalizados. Pool vazio aborta tudo (nada é cobrado).
- Marco de desbloqueio: conta aberturas não revertidas de `unlock.packId`, somando todos os times.
- Grava: posse (`acquisition_source = 'pack'`), `transfers` (`pack_pull`, preço 0), `financial_transactions` (`pack_purchase`) e o log em `pack_openings` (cartas, pesos e pool no momento).
- `rollback_pack_opening`: só admin; recusa se alguma carta já mudou de dono (`cards_moved`).

**Testes:** `tools/packs-db-test/run.sh` cria um Postgres temporário, aplica schema real (reconstruído do relatório), `PACKS-V1.sql` e o seed, e roda 40+ verificações: validações, atomicidade, overrides, rollback e distribuição. Foi validado também com dois clientes disputando o único jogador 97 (um leva, o outro não paga nada).

**Para a fase 3 (UI):** os tipos `pack_pull`, `pack_purchase` e `pack_rollback` são novos e a tela de transferências/extrato precisa saber exibi-los. Após chamar a RPC, o cliente deve recarregar o estado (como já faz com `refreshNormalizedStateAfterRpc`) e fazer o broadcast.

## Fases
1. Simulador de calibração — feito.
2. Backend aditivo (`PACKS-V1.sql`) — feito.
3. Seletor de modo na criação do torneio + gating da UI (mercado vira banco de consulta).
4. MVP: loja de pacotes, revelação simples, venda de volta, painel admin de configuração (preço, cartas, pesos por overall, marcos, elenco).
5. Trocas por jogadores (N por M).
6. UX de tensão (animação, som, aviso ao vivo).
7. Ajuste com dados reais.
