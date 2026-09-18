# TaskBoard V219 — Web Share Target fora do Next.js Proxy

## Causa raiz identificada

O `proxy.ts` global também interceptava `/share-target` e `/share-target-v218`. No Next.js 16, toda requisição que passa por Proxy tem o body clonado/bufferizado antes do Route Handler. O limite padrão desse buffer é 10 MB e corpos multipart podem chegar parciais ao destino quando excedem o limite. Isso explica o padrão observado: texto chega normalmente, enquanto imagens, vídeos e anexos falham no `request.formData()` ou chegam sem parte binária.

## Correção V219

- `/share-target`, `/share-target-v218` e `/share-target-v219` foram removidos do matcher do `proxy.ts`.
- O POST multipart do Android vai direto ao Route Handler Node.js, sem autenticação, clone ou buffer do Proxy.
- O receptor lê os bytes brutos do POST e usa parser multipart próprio; não depende de `request.formData()` para anexos externos.
- Quando `Content-Length` está presente, o receptor compara o tamanho declarado com os bytes efetivamente recebidos e identifica truncamento antes de tentar persistir o arquivo.
- O manifest agora aponta para `/share-target-v219`.
- Rotas antigas continuam compatíveis e usam o mesmo handler.
- `experimental.proxyClientMaxBodySize` foi configurado em 64 MB como proteção para outros uploads que ainda passam pelo Proxy; o Share Target não depende desse limite.
- O receptor V219 grava diagnóstico em caso de erro (`motivo`, `content-type`, `content-length`) e a tela exibe a etapa real que falhou em vez de apenas “Conteúdo não recebido”.
- Service Worker atualizado para V219 e continua sem interceptar os POSTs do Share Target.
- Versão embutida do sistema atualizada para V219.

## Arquivos alterados

- `proxy.ts`
- `next.config.mjs`
- `app/manifest.ts`
- `app/share-target-v219/route.ts` (novo)
- `app/compartilhar/page.tsx`
- `lib/server-share-target-handler.ts`
- `lib/server-share-multipart.ts` (novo)
- `lib/server-share-inbox.ts`
- `lib/supabase/proxy.ts`
- `lib/app-version.ts`
- `public/devboard-sw.js`
