# TaskBoard V218 — Web Share Target sem perda silenciosa de anexos

## Causa raiz encontrada na V217
A V217 ainda mantinha duas dependências frágeis no recebimento externo:

1. O Service Worker consumia `POST /share-target` antes do servidor e fazia o binário depender do Cache Storage do navegador.
2. Quando o Service Worker caía no backend, o backend só persistia o arquivo se o POST externo carregasse uma sessão Supabase válida. Um lançamento do PWA pelo Android pode chegar sem essa sessão SSR disponível naquele primeiro request; nesse caso o arquivo era lido do multipart, mas não era preservado e a tela podia abrir sem anexos.

## Arquitetura V218
- O Service Worker **não intercepta mais** `/share-target` nem `/share-target-v218`.
- O multipart original chega intacto ao Route Handler do Next.js.
- O manifest aponta para a action versionada `/share-target-v218`, mas `/share-target` continua compatível com instalações antigas.
- O receptor não depende de cookie, login, JWT ou policy de `storage.objects` para preservar o conteúdo recebido.
- Cada compartilhamento recebe um token aleatório de 256 bits, válido por 24 horas.
- A persistência é redundante:
  - disco temporário do servidor (no Windows usa `%LOCALAPPDATA%/TaskBoard/share-inbox-v218`, com fallback para a pasta temporária do sistema);
  - Supabase Storage privado via `SUPABASE_SERVICE_ROLE_KEY`, quando configurado.
- A navegação para `/compartilhar` só acontece depois de pelo menos uma camada confirmar a gravação completa.
- O manifest do lote é gravado por último, funcionando como commit transacional.
- `/api/share-inbox` recupera o lote pelo token de alta entropia sem depender da sessão do POST original.
- A tela faz retentativas curtas para leituras 404 transitórias e nunca transforma um lote confirmado com anexos em “0 arquivos”.
- Se os binários realmente não puderem ser preservados, a UI mostra erro explícito e bloqueia o fluxo vazio.
- O novo Service Worker é registrado com `?v=218` para forçar atualização da instalação existente.
- `manifest.webmanifest`, Service Worker e receptor usam headers anti-cache apropriados.
- O manifest aceita `*/*` além dos MIME/extensões já suportados para cobrir provedores Android que publicam tipos genéricos.

## Compatibilidade
- Instalações com manifest antigo em `/share-target` continuam funcionando porque a rota antiga também usa o receptor V218.
- Instalações atualizadas passam a usar `/share-target-v218`, evitando colisão com lógica antiga registrada no aparelho.

## Validação executada
- Sintaxe/transpilação dos arquivos TS/TSX alterados: OK.
- Sintaxe do Service Worker: OK.
- Teste transacional com dois arquivos em campos multipart distintos (`files` e `attachment`): OK.
- Nome, MIME, tamanho e conteúdo binário foram preservados na gravação e leitura.
- Exclusão do recibo temporário após uso: OK.

## Arquivos principais alterados
- `app/manifest.ts`
- `app/share-target/route.ts`
- `app/share-target-v218/route.ts` (novo)
- `app/api/share-inbox/route.ts`
- `app/compartilhar/page.tsx`
- `lib/server-share-inbox.ts` (novo)
- `lib/server-share-target-handler.ts` (novo)
- `lib/taskboard-share-cache.ts`
- `lib/supabase/proxy.ts`
- `public/devboard-sw.js`
- `next.config.mjs`
- `lib/app-version.ts`
- componentes que registram o Service Worker (URL versionada `?v=218`)
