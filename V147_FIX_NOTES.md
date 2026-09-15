# TaskBoard V147 — correção do loop offer/answer/ICE restart

## Causa identificada

Os logs da V146 mostraram um ciclo repetitivo:

- `answer WebRTC recebida`;
- imediatamente depois, nova `offer WebRTC` com `iceRestart: true`;
- o peer ainda estava em `have-local-offer`/gathering;
- a conexão nunca tinha tempo para estabilizar e voltava para `failed`.

O problema era interno ao controle de recuperação: um `failed` ocorrido durante a negociação deixava um restart pendente. Quando a answer transformava o `signalingState` em `stable`, o handler de `signalingstatechange` disparava outra offer antes do handshake anterior terminar de estabilizar.

## Alterações

- removido completamente o estado `restartPending`;
- removida a criação automática de uma nova offer no `signalingstatechange`;
- nenhuma offer de ICE restart pode ser criada se `signalingState !== stable`;
- ICE restart exige `localDescription` e `remoteDescription` válidos;
- cooldown de restart aumentado para 10 segundos;
- `failed` aguarda 4,5 segundos antes de tentar recuperação;
- `disconnected` aguarda 8 segundos antes de tentar recuperação;
- se o ICE ainda estiver em `gathering`, a recuperação é adiada em vez de interromper a negociação;
- timers antigos de restart são cancelados antes de aplicar `offer` ou `answer`;
- ao receber `restart-request` enquanto já existe uma offer pendente, o TaskBoard reenvia a mesma offer em vez de criar outra;
- após offer/answer há uma checagem tardia de 6,5 segundos para recuperar somente se o transporte continuar realmente quebrado;
- o health-check de RTP continua podendo forçar um restart quando uma conexão já estabelecida parar por ~20 segundos;
- erros ICE 701 de uma interface/rota específica passam para `console.debug`, pois não invalidam um relay UDP funcional;
- adicionado log `candidato TURN relay remoto recebido` para confirmar que o candidato relay do outro participante realmente chegou.

## TURN / Edge Function

Nenhuma alteração é necessária na Edge Function Cloudflare TURN. A geração de credenciais e a obtenção de candidatos relay já foram confirmadas pelos logs da V146.

## Migration

Não há migration nova na V147. A migration 090 permanece a última necessária.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V147_FIX_NOTES.md`
