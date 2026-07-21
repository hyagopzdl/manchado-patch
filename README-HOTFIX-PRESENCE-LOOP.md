# Hotfix: loop de presence

Corrige o loop em que cada commit emitia novamente `.info/connected`, disparando uma nova gravação em `pes/presence/<profileId>` e repetindo `apply_direct_patch` indefinidamente.

## Arquivo alterado

- `js/supabase.js`

## Aplicação

Substitua o arquivo `js/supabase.js` publicado no GitHub Pages pelo desta versão. Não é necessário executar SQL nem refazer a migração.
