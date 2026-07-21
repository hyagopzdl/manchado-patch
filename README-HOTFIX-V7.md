# Hotfix v7 — recompensas idempotentes e restauração de saldo

## Causa
A hidratação do Supabase não devolvia `economySettlement`. Assim, toda atualização da página fazia o frontend considerar partidas antigas como pendentes e aplicar novamente o ajuste retroativo.

## Correção
- remove a migração retroativa automática do frontend;
- hidrata partidas jogadas como liquidadas;
- reconstrói `economyRewards` a partir do histórico financeiro existente;
- inclui SQL opcional e direcionado para restaurar saldos e as 274 transações financeiras do campeonato ativo usando o backup Firebase de 21/07/2026.

## Aplicação
1. Publique os arquivos do projeto.
2. Execute `supabase/RESTORE-BALANCES-FROM-FIREBASE-BACKUP.sql` uma única vez.
3. Confirme que o resultado final mostra 274 transações restauradas.
