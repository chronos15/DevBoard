# TaskBoard V222 — correção definitiva do receptor PWA por parser nativo

## Evidência encontrada nos logs de produção

O Android estava chegando ao servidor com `Content-Type: multipart/form-data` e um `boundary` válido, porém o parser multipart artesanal da V219 registrava `nenhuma parte form-data foi encontrada`. Isso prova que o problema estava na interpretação do POST, e não simplesmente na abertura da tela.

## Mudanças

- removido o parser multipart artesanal do fluxo principal;
- `/share-target` usa `await request.formData()` nativo do Next.js/Fetch API;
- Service Worker V222 NÃO intercepta mais o POST do Share Target;
- o POST segue intacto `Android -> Apache -> Next Route Handler`;
- arquivos são coletados de qualquer campo binário do FormData;
- arquivo é persistido em disco local do Windows antes do redirect; Supabase continua apenas como redundância;
- redirect 303 só ocorre depois da persistência confirmada;
- removido `*/*` do `share_target.accept`, mantendo MIME wildcards suportados e tipos/extensões explícitos;
- logs V222 registram Content-Type, Content-Length, User-Agent e entradas recebidas quando o FormData vier vazio;
- versão embutida atualizada para V222;
- Service Worker registrado como `devboard-sw.js?v=222`.

## Compatibilidade

As rotas `/share-target-v218`, `/share-target-v219` e `/share-target-v221` continuam chamando o mesmo handler V222, portanto instalações antigas do WebAPK também recebem a correção no servidor.

## Persistência

Na V222 o disco local do Windows Server é síncrono e prioritário. O redirect para `/compartilhar` não espera Supabase. A cópia remota ocorre em segundo plano e só vira fallback síncrono se o disco local falhar.
