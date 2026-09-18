# TaskBoard V220 — hotfix de build V219

## Erro corrigido

A V219 deixou `components/sidebar.tsx` importando `TASKBOARD_VERSION_LABEL`, mas `lib/app-version.ts` exportava apenas `TASKBOARD_VERSION`. O Turbopack detectava corretamente o contrato quebrado e interrompia o build.

## Correções

- Restaurados `TASKBOARD_VERSION`, `TASKBOARD_BUILD_DATE`, `TASKBOARD_BUILD` e `TASKBOARD_VERSION_LABEL` em `lib/app-version.ts`.
- Versão embutida atualizada para **V220**.
- Mantido o formato do rodapé do sidebar: `V220 - dd/MM HH:mm`.
- `cleanupLocalShares()` agora marca o `readdir` dinâmico com `turbopackIgnore`, evitando que o Turbopack rastreie/inclua o projeto inteiro apenas por causa da pasta temporária configurável do inbox de compartilhamento.
- Service Worker e seus pontos de registro avançados para `v=220`, garantindo atualização imediata do PWA após o deploy.
- O receptor Web Share Target V219 permanece inalterado funcionalmente: continua fora do Proxy e processando multipart bruto.

## Banco de dados

Nenhuma migration nova.
