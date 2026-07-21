# Migração Firebase → Supabase

Use `COMECE-AQUI.md` como fonte principal e siga a ordem descrita nele.

## Chaves

- Frontend/GitHub Pages: Project URL + Publishable key (`sb_publishable_...`).
- Scripts locais/Replit: Project URL + Secret key (`sb_secret_...`) no secret chamado `SUPABASE_SERVICE_ROLE_KEY`.
- Nunca publique a Secret key.

## Comandos

```bash
npm run check
npm run migrate:dry
npm run migrate
npm run avatars:dry
npm run avatars
npm run validate
```

O importador não persiste avatares base64 nem cópias integrais em `raw_data`. Os avatares são enviados separadamente ao Storage.
