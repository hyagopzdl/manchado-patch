# Manchado Patch — estrutura refatorada

A aplicação continua buildless e pode ser servida por qualquer servidor HTTP estático.

## Execução local

```bash
python3 -m http.server 8000
```

Acesse `http://localhost:8000`. Não abra o HTML diretamente via `file://`, pois o navegador bloqueia o carregamento de `players.json`.

## Organização

- `index.html`: dependências e ordem de inicialização.
- `css/`: tokens, base, layout, componentes, funcionalidades e responsividade.
- `js/app.js`: ponto único de inicialização do React.
- `js/state.js`: persistência e defaults globais de estado.
- `js/firebase.js`: inicialização, leitura, escrita e migração do Firebase.
- `js/utils.js`: utilitários puros.
- `js/components/`: componentes visuais compartilhados.
- `js/features/`: regras puras por domínio.
