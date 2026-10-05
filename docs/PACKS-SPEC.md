# Modo Cartas (pacotes) — especificação

Status: planejamento. Nenhuma parte está ligada ao app ainda. Só `tools/pack-simulator.html` existe.

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

## Regras de elenco (interpretação a confirmar)
- Máximo: abrir pacote é bloqueado se `elenco + cartas > máximo`. É preciso vender para abrir.
- Mínimo: mantém a regra atual da venda (não vende se `elenco <= mínimo`).
- Consequência: o jogador oscila entre 23 e 30, e o dinheiro vem de vender o excedente.

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

## Backend (supabase/PACKS-V1.sql — depende de INSPECT-SCHEMA.sql)
- `player_catalog` (id, nome, posição, overall, valor): carga gerada a partir de `players.json`, com guarda de versão (hash).
- `pack_openings`: log de cada abertura (torneio, time, pacote, preço, cartas, pesos usados, pool, data).
- RPC `open_pack`: valida modo, perfil, desbloqueio, saldo e elenco; sorteia sem reposição; debita; cria posse com `acquisition_source = 'pack'`; grava transferência `pack_pull` e lançamento `pack_purchase`.
- RPC admin de rollback de abertura (mesmo padrão do rollback de compra existente).

## Fases
1. Simulador de calibração — feito.
2. Backend aditivo (`PACKS-V1.sql`).
3. Seletor de modo na criação do torneio + gating da UI (mercado vira banco de consulta).
4. MVP: loja de pacotes, revelação simples, venda de volta, painel admin de configuração (preço, cartas, pesos por overall, marcos, elenco).
5. Trocas por jogadores (N por M).
6. UX de tensão (animação, som, aviso ao vivo).
7. Ajuste com dados reais.
