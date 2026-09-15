# TaskBoard V138 — Notificação contextual e Web Share Target resiliente

Base: V137.

## Notificações da subatividade

- O TaskBoard agora publica um contexto leve da subatividade que está realmente aberta e visível.
- Quando uma nova mensagem, anexo, menção ou atualização chega para exatamente essa subatividade, a notificação do navegador/PWA não é exibida, porque o usuário já está acompanhando a conversa.
- A regra funciona tanto no Acompanhamento/Modo Resumido quanto na visualização de projeto/atividade/subatividade, pois ambos utilizam o mesmo `ProjectFollowUp`.
- O contexto é sincronizado entre abas/PWAs por `localStorage`, com heartbeat curto e expiração automática, evitando que uma aba antiga em background silencie notificações indevidamente.
- A leitura da conversa deixou de depender de `document.hasFocus()`, que não é confiável em alguns PWAs Android. A página visível com a subatividade selecionada é suficiente.
- Não houve alteração de schema, RPC, trigger ou formato da tabela `notifications`.

## Compartilhamento PWA com “0 anexos”

- Mantido o fluxo atual por Cache Storage quando o Service Worker recebe o arquivo normalmente.
- O Service Worker agora preserva uma cópia intacta do POST do Web Share Target antes de executar `formData()`.
- Se o Android/Chrome anunciar uma parte binária mas entregar `File` vazio ao Service Worker, ou se o compartilhamento aparentar ser somente arquivo sem texto/link, o POST original é encaminhado ao receptor `/share-target` do servidor.
- O receptor já existente usa o inbox privado `taskboard-share-inbox`, permitindo que o parser do servidor recupere o binário em aparelhos onde o parser do Service Worker falha.
- Em erro de rede, o comportamento local anterior continua disponível; nenhum fluxo funcional existente foi removido.

## Banco de dados

Nenhuma migration nova. A migration `089_taskboard_share_inbox_fallback.sql` continua sendo necessária para o fallback persistente do compartilhamento.

## Arquivos alterados

- `components/notifications/browser-notifications.tsx`
- `components/project-detail/project-follow-up.tsx`
- `lib/active-follow-up-context.ts`
- `public/devboard-sw.js`
- `V138_FIX_NOTES.md`
