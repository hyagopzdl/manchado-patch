# Hotfix V6

Este pacote corrige apenas dois pontos:

1. partidas passam a expor `homeId` e `awayId`, preservando também `homeTeamId` e `awayTeamId`;
2. favoritos usam a RPC isolada `set_profile_favorite`, que altera somente uma linha de `profile_favorites`.

O frontend deixa de incluir `profileChampionshipPreferences` no patch genérico. Assim, uma alteração de favorito não pode apagar e recriar a tabela inteira.

## Aplicação

1. Execute `supabase/HOTFIX-SAFE-FAVORITES-AND-MATCH-HYDRATION.sql` no SQL Editor.
2. Substitua `js/supabase.js` no repositório.
3. Publique e teste em uma janela anônima.
