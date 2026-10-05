# Modo Cartas (pacotes) — especificação

Status: fases 1 (simulador), 2 (backend) e 3 (modo no app) prontas. Falta a loja de pacotes (fase 4): ainda não há tela para abrir pacotes nem painel admin de configuração.

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
- `catalog-seeds/<id>.sql`: carga de cada catálogo, **gerada** por `node tools/generate-catalog-sql.js`.

**Como aplicar (ordem):** 1) `PACKS-V1.sql`  2) `catalog-seeds/default.sql`.  3) `PACKS-SMOKE-TEST.sql` (opcional, recomendado): roda no banco real sem deixar rastro e termina com uma mensagem de erro proposital `SMOKE_OK ...` (ou `SMOKE_FAIL ...`); o erro é o que garante o rollback. Ambos no SQL Editor do Supabase. Como nada existente é alterado, os campeonatos atuais não são afetados.

**Várias bases (catálogos):**
- Cada base é um **catálogo com id**. O `players.json` atual é o catálogo `default`; os campeonatos existentes não têm `catalogId` e continuam nele.
- Um torneio escolhe o catálogo em `catalogId` (ausente = `default`). O `open_pack` sorteia só desse catálogo, e a guarda de versão compara com o checksum daquele catálogo.
- Os catálogos são adicionados **só pelo git**: o arquivo JSON da base + uma linha em `catalogs.json` (usado depois pelo seletor do app na criação do campeonato) + o seed gerado.
- **Overrides valem só para o catálogo `default`** (são globais por `player_id`, e bases diferentes podem reaproveitar ids). Para outros catálogos o servidor os ignora; o app deve fazer o mesmo (fase 3). Escopar overrides e revisões por catálogo fica para depois.
- Ids repetidos entre catálogos não conflitam: a posse é por torneio e cada torneio usa um único catálogo.

**Adicionando uma base nova:**
1. Colocar o JSON na raiz (ex.: `players-2026.json`) e registrar em `catalogs.json`.
2. `node tools/generate-catalog-sql.js edicao-2026 players-2026.json` — valida e gera `supabase/catalog-seeds/edicao-2026.sql`.
3. Aplicar o seed no Supabase. Só toca nas linhas daquele catálogo.

**Quando um JSON existente mudar:**
1. `node tools/generate-catalog-sql.js [catalogId] [arquivo]` (sem argumentos = `default` a partir de `players.json`). Valida o JSON (id duplicado, sem nome, overall fora de 1–99 viram erro; valor ausente vira aviso).
2. Aplicar o seed gerado. É upsert por `(catalog_id, player_id)`: atualiza, insere novos e remove do catálogo quem saiu do arquivo.
3. Publicar o JSON atualizado no app.
Se 2 e 3 ficarem fora de sincronia, o `open_pack` recusa com `catalog_outdated` (o cliente envia o sha256 do JSON que exibe). Qualquer edição no arquivo, até de formatação, muda o checksum e exige regerar o seed.
**Cuidados:** manter os ids estáveis dentro de um mesmo catálogo; jogador removido que já tem dono continua no elenco (só sai do pool); evitar mudar a base no meio de um campeonato de cartas, pois altera as probabilidades.

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

## Fase 3 — o que o app faz hoje (modo `packs`)
- **Criação (Campeonato → Começar do zero):** escolha do modelo (Mercado de jogadores / Cartas) e, quando `catalogs.json` tem mais de uma base, escolha da base. No modo cartas o elenco inicial balanceado é obrigatório (23 por time). "Continuar temporada" herda modo, base e `packSettings` da temporada anterior.
- **Campos gravados no torneio** (somente quando não são o padrão): `mode: "packs"`, `catalogId`, `packSettings` (valores iniciais de `js/features/packs.js`, placeholders vindos do simulador). Um campeonato de mercado comum é gravado exatamente como antes.
- **Base por campeonato:** o app carrega o catálogo do campeonato selecionado (`catalogs.json` → arquivo). Overrides só valem na base `default`.
- **Mercado desligado no modo cartas:** o título vira "Banco de jogadores" (navegação: "Jogadores"), sem botões de compra/oferta, detalhe do jogador sem proposta, sem "Fazer oferta" em elencos alheios, multa rescisória desativada, `kt` (compra/oferta) bloqueado. "Negociações" vira "Histórico".
- **Venda ao mercado** continua: cartas vindas de pacote usam `packSettings.sellDepreciationPct` (padrão 25%); elenco inicial continua com a regra antiga.
- **Histórico:** `pack_pull` aparece nas transferências e na atividade. O botão de reverter fica desabilitado para esses itens (o estorno de pacote usa `rollback_pack_opening`, a ligar na fase 4).
- Versões de cache de `index.html` atualizadas (`20261005-packs-v1`) e `packs.js` adicionado.

**Testes da fase 3** (feitos num navegador headless com Supabase simulado, sem tocar no banco real): campeonato de mercado idêntico ao anterior (título, 23 botões de compra, detalhe com proposta); campeonato de cartas sem botões de compra; venda de carta de pacote a 25% (129 → 97M); criação de campeonato de cartas com base alternativa gerando 23 jogadores por time com ids da base escolhida; criação de campeonato de mercado sem nenhum campo novo; base alternativa carregada ao selecionar o campeonato.

## Pendências conhecidas (fase 4)
- Tela de abertura de pacotes (usar `open_pack`, enviando o checksum da base: `PacksFeature.loadCatalog(id).checksum`), com revelação.
- Painel admin: preço, cartas, pesos por overall, marcos de desbloqueio, depreciação, loja aberta/fechada e estorno de abertura.
- Pacotes novos ainda não aparecem em extrato com ícone próprio (usam o rótulo "Pacote ...").
- Validar `packSettings` do torneio contra o servidor ao salvar (o servidor já valida ao abrir).

## Fases
1. Simulador de calibração — feito.
2. Backend aditivo (`PACKS-V1.sql`) — feito.
3. Seletor de modo na criação do torneio + gating da UI (mercado vira banco de consulta) — feito (ver abaixo).
4. MVP: loja de pacotes, revelação simples, venda de volta, painel admin de configuração (preço, cartas, pesos por overall, marcos, elenco).
5. Trocas por jogadores (N por M).
6. UX de tensão (animação, som, aviso ao vivo).
7. Ajuste com dados reais.
