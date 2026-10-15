# Trocas entre participantes

- **O que é:** proposta de troca de 1 a N jogadores de cada lado (limite configurável pelo admin, padrão 3), com **troco em dinheiro entre os dois times** (soma zero) e uma **taxa do banco** (padrão 5% do maior lado, metade para cada time) que funciona como ralo de dinheiro. O banco nunca paga troco.
- **Troco sugerido:** diferença de valor entre o que cada lado recebe; ambos os lados podem editar (o botão "Equilibrar" volta ao sugerido). Quem recebe a proposta pode aceitar, recusar ou contra-propor (abre a mesa já preenchida; a original vira "contra-proposta").
- **Validade:** 48 h (configurável). A expiração é calculada na leitura; nenhuma tarefa em segundo plano.
- **Regras validadas na proposta e de novo no aceite (estado do servidor):** mercado aberto, trocas ativas, mínimo de jogos de mercado, trava de jogos por jogador (inclui contrato protegido por multa), mínimo/máximo de elenco dos dois times, mínimo do elenco-base, saldo (troco + taxa) e regra de equilíbrio de overall entre os times.
- **Dados:** `context.tradeProposals` (mapa id → proposta) dentro do torneio; configurações em `tradeSettings` (`enabled`, `maxPlayersPerSide`, `feePct`, `expiryHours`). Nenhum SQL novo. Ao aceitar: 1 transferência `user_transfer` por jogador (com `tradeId`), lançamentos `trade_cash` e `trade_fee`, ofertas/propostas abertas dos mesmos jogadores ficam `invalid`.
- **Estorno (admin, no histórico):** desfaz a troca inteira (jogadores, troco e taxa). Falha se algum jogador já saiu do time que o recebeu.
- **Código:** `js/features/trade.js` (regras puras, testadas por `tools/trade.test.js`), `js/features/trade-ui.js` (mesa de troca, seletor, central de propostas, regras do admin).
