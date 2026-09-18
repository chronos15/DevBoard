# TaskBoard V216 — Web Share Target preservando o binário

## Problema corrigido

Depois da V215 o PWA passou a abrir corretamente a URL pública, porém alguns aparelhos Android chegavam em `/compartilhar` com **0 itens prontos para enviar**.

O fluxo anterior ainda interceptava o `POST multipart/form-data` do Web Share Target dentro do Service Worker. Em determinadas versões do Chrome/Android, clonar/consumir esse body antes do backend podia fazer o arquivo chegar vazio ou não ser materializado corretamente.

## Novo fluxo

1. O Service Worker **não intercepta mais** o `POST /share-target`.
2. O multipart original enviado pelo Android chega intacto à rota Next.js.
3. A rota salva os arquivos no inbox privado `taskboard-share-inbox` antes do redirect.
4. O redirect continua usando `NEXT_PUBLIC_APP_URL=https://taskboard.softworksistema.com.br` como origem pública.
5. A tela `/compartilhar` recupera os arquivos do inbox privado.

## Manifesto do compartilhamento

A rota agora grava `__taskboard_share_manifest.json` junto com cada compartilhamento temporário. O manifesto contém o nome armazenado, nome original, MIME, tamanho e `lastModified` de cada arquivo.

Isso evita depender do formato de `Storage.list()`. Algumas versões self-hosted do Supabase Storage podem retornar arquivos válidos com `id` nulo; o código antigo filtrava esses registros e acabava mostrando `0 itens` mesmo quando o upload existia.

A leitura agora:

- tenta primeiro o manifesto por caminho conhecido;
- baixa cada arquivo diretamente pelo nome exato;
- faz pequenas tentativas automáticas para absorver atraso de consistência do Storage;
- mantém compatibilidade com shares V134–V215 através de `list()`;
- no fallback legado, **não exige mais `item.id`** para reconhecer um arquivo;
- usa o parâmetro `serverFiles` para detectar compartilhamento parcial e nunca apresentar silenciosamente `0 itens` quando o servidor declarou anexos.

## Banco de dados

Nenhuma migration nova. Continua usando o bucket/policies criados pela migration `089_taskboard_share_inbox_fallback.sql`.

## Arquivos alterados

- `public/devboard-sw.js`
- `app/share-target/route.ts`
- `app/compartilhar/page.tsx`
- `lib/taskboard-share-cache.ts`
- `lib/app-version.ts`
- `next.config.mjs`
- `V216_FIX_NOTES.md`

## Atualização do Service Worker

`/devboard-sw.js` agora recebe `Cache-Control: no-cache, no-store, must-revalidate` e a tela de compartilhamento registra o SW com `updateViaCache: "none"` + `registration.update()`. Isso reduz a chance de um aparelho continuar usando o receptor antigo que ainda interceptava o multipart.
