# TaskBoard V224 — Compartilhamento Android nativo

## Diagnóstico fechado

Nos testes reais da V223, mesmo após desinstalar/reinstalar o PWA e carregar o manifesto/SW novos,
o Chrome/WebAPK enviou para `/share-target` somente 75 bytes: o boundary de fechamento de um
`multipart/form-data`, sem qualquer entrada (`entries: []`).

O endpoint web foi validado separadamente com `curl` direto no Next e através do Apache, ambos
retornando `serverFiles=1`. Portanto não há arquivo disponível no lado web para recuperar.

## Solução V224

Foi adicionado `android-share-bridge/`, um receptor Android nativo sem launcher que registra:

- `android.intent.action.SEND`
- `android.intent.action.SEND_MULTIPLE`
- MIME `*/*`

O bridge recebe as URIs diretamente do Android, cria um multipart convencional com campo `files`,
envia para `/share-target` e abre o `Location` retornado pelo TaskBoard.

O `share_target` foi removido do manifesto web para que instalações futuras do PWA não registrem
o receptor WebAPK defeituoso. O PWA continua funcionando normalmente para todas as demais funções.
