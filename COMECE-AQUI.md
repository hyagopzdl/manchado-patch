# Comece aqui — instalação limpa

Este ZIP é a base completa do projeto. Não misture com patches anteriores.

## Ordem correta

1. Criar um projeto Supabase novo e saudável.
2. Executar os SQLs, nesta ordem:
   - `supabase/schema.sql`
   - `supabase/indexes.sql`
   - `supabase/functions.sql`
   - `supabase/rls.sql`
   - `supabase/direct-runtime.sql`
   - `supabase/avatar-storage.sql`
3. Colocar o backup Firebase na raiz como `firebase-backup.json`.
4. Configurar no Replit os Secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (use a Secret key `sb_secret_...`; nunca publique esta chave)
5. Executar:

```bash
npm run check
npm run migrate:dry
npm run migrate
npm run avatars:dry
npm run avatars
npm run validate
```

6. Em `js/config.js`, informar:
   - URL do projeto
   - Publishable key (`sb_publishable_...`)
7. Publicar o conteúdo completo no GitHub Pages.
8. Abrir uma única aba e testar.

## Não executar

Não execute arquivos antigos de runtime compatibility, timeout, snapshot ou `sync_events`.
Ignore trechos antigos de outros READMEs que falem em:

- `runtime_documents`
- `get_runtime_documents`
- `commit_runtime_documents`
- `commit_legacy_snapshot`
- Realtime em `sync_events`

O runtime atual usa `apply_direct_patch`.

## Correcao v3 - erro 42702 offer_id ambiguous

Se o projeto ja foi criado com a versao anterior e o app retorna `column reference "offer_id" is ambiguous`, execute no SQL Editor apenas:

`supabase/HOTFIX-AMBIGUOUS-OFFER-ID.sql`

Depois recarregue o app. Nao e necessario refazer a importacao.
