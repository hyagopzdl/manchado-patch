# Runtime direto no Supabase

Esta versão remove do runtime:

- `runtime_documents`
- `get_runtime_documents`
- `commit_runtime_documents`
- `sync_events`
- reload global por Realtime
- retries automáticos
- leitura de `raw_data`

O app continua com a interface atual, mas o adaptador grava diretamente nas tabelas normalizadas através da RPC `apply_direct_patch`.

## Aplicação

1. Não abra o GitHub Pages durante a instalação.
2. Crie um projeto Supabase Free novo, caso o projeto atual continue sem responder a `select 1`.
3. Execute, nesta ordem:
   - `supabase/schema.sql`
   - `supabase/indexes.sql`
   - `supabase/functions.sql`
   - `supabase/rls.sql`
   - `supabase/direct-runtime.sql`
4. Importe o backup com o migrador em lotes.
5. Execute a validação.
6. Atualize `js/config.js` com a URL e a anon key do projeto saudável.
7. Publique os arquivos deste pacote no GitHub Pages.

## Validação no navegador

Na primeira abertura deve existir uma única linha semelhante a:

```text
[Supabase] carga normalizada: 900ms, 21 consultas, 0 snapshots, 0 retries
```

Não devem existir chamadas para:

- `/rest/v1/runtime_documents`
- `/rest/v1/sync_events`
- `get_runtime_documents`
- `commit_runtime_documents`

As gravações aparecem como uma chamada RPC para `apply_direct_patch`.
