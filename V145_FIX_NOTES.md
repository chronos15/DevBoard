# TaskBoard V145 — handshake WebRTC com ICE embutido no SDP

## Diagnóstico confirmado

Na V144 o navegador já conseguia obter candidato TURN `relay` via UDP, então a credencial Cloudflare e a alocação TURN estavam funcionando. Mesmo assim os peers permaneciam em `Conectando mídia`.

O ponto frágil restante era o handshake principal: offer/answer eram enviados imediatamente após `setLocalDescription`, antes do fim do ICE gathering. A partir daí a conexão dependia dos eventos de trickle ICE (`ice` separados) chegarem e serem aplicados corretamente no outro dispositivo.

## Correção

- offer e answer agora aguardam o ICE gathering (até 7 s) antes de serem enviados;
- o SDP principal passa a carregar os candidatos já embutidos, inclusive TURN relay quando disponível;
- os eventos de trickle ICE continuam apenas como redundância para candidatos tardios;
- `ready` nunca reenvia uma offer parcial enquanto o gathering ainda está em andamento;
- o console registra quantos candidatos totais e relay existem no SDP enviado/recebido;
- se a primeira tentativa continuar sem formar um candidate pair, o fallback muda para `iceTransportPolicy: relay` e executa um ICE restart controlado com a lista TURN completa;
- não há recriação agressiva de PeerConnection nem watchdog de vídeo;
- gravação permanece exclusivamente pelo owner.

## Logs úteis

Uma negociação saudável deve mostrar algo semelhante a:

- `TaskBoard: offer WebRTC pronta` com `candidates > 0`;
- `TaskBoard: offer WebRTC recebida` com candidatos equivalentes;
- `TaskBoard: answer WebRTC pronta`;
- `TaskBoard: answer WebRTC recebida`;
- depois o peer deve chegar a `connected`.

Se houver TURN disponível, `relayCandidates` deve ser maior que zero em pelo menos uma das tentativas/fallback.

## Migration

Nenhuma migration nova. A migration 090 continua válida.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V145_FIX_NOTES.md`
