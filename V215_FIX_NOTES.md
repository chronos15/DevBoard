# TaskBoard V215 — PWA Share Target atrás do proxy físico

## Correção

O fluxo de compartilhamento do PWA não usa mais `request.url` como origem do redirect do `/share-target`.

Em produção o Next.js roda internamente em `localhost/127.0.0.1` atrás do Apache. Em alguns compartilhamentos do Android, especialmente no fallback de arquivos, `request.url` podia refletir esse endereço interno e gerar um `303` para `http://localhost:3000/compartilhar` no aparelho.

Agora o servidor resolve a origem pública nesta ordem:

1. `NEXT_PUBLIC_APP_URL` (fonte principal);
2. `X-Forwarded-Host` + `X-Forwarded-Proto`;
3. header `Origin`;
4. `Host` + protocolo da requisição;
5. `request.url` somente como último fallback.

Com a configuração atual `NEXT_PUBLIC_APP_URL=https://taskboard.softworksistema.com.br`, o redirect do Share Target passa a apontar para a URL pública correta mesmo que o Next esteja atendendo internamente em `localhost:3000`.

## Proteção adicional no Service Worker

O Service Worker também valida a URL retornada pelo fallback do servidor. Se um proxy retornar acidentalmente uma origem diferente para `/compartilhar`, o SW mantém `pathname`, query string (`serverShare`, `serverFiles`, etc.) e navega usando `self.location.origin`, impedindo que `localhost` escape para o PWA.

## Escopo

- nenhum ajuste no recebimento/seleção múltipla de anexos;
- nenhuma mudança no Supabase Storage;
- nenhuma migration;
- nenhum ajuste necessário no `.env` informado pelo cliente;
- versão atualizada para V215.
