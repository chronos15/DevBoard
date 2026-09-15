# TaskBoard V144 — estabilização ICE/TURN e handshake da reunião

## Sintoma confirmado

Os participantes entram normalmente na mesma reunião e o Presence mostra todos conectados, mas os cards remotos ficam em **Conectando mídia**. No console aparecem vários `RTCPeerConnectionIceErrorEvent` contra `turn.cloudflare.com`, principalmente rotas TCP/TLS (`80`, `3478`, `443`, `5349`) em interface IPv6.

A V143 também fazia retry do handshake a cada poucos segundos. Depois que uma `answer` já tinha sido aplicada, o peer podia voltar a criar uma nova oferta enquanto o ICE ainda estava em `checking`. Isso interrompia o tempo necessário para o ICE selecionar um candidate pair e multiplicava as tentativas contra todos os endpoints TURN.

## Correções V144

### 1. SDP não é mais reiniciado enquanto ICE está conectando

- o peer passa a registrar quando `offer/answer` já foi concluído;
- após a `answer`, o TaskBoard deixa o ICE trabalhar sem criar novas ofertas periódicas;
- enquanto a `answer` ainda não chegou, o offerer apenas **reenvia o mesmo SDP**;
- o answerer responde novamente a uma offer duplicada usando a answer já existente, sem reaplicar SDP nem reiniciar ICE;
- uma nova negociação só acontece em `ICE restart` real.

### 2. TURN em modo UDP-first

- a primeira tentativa usa STUN + TURN/UDP;
- endpoints TURN TCP/TLS deixam de competir com o caminho inicial em Chromium;
- se a primeira rota não conectar após alguns segundos, a configuração completa do TURN é promovida automaticamente e é feito um único ICE restart;
- redes corporativas que bloqueiam UDP continuam suportadas pelo fallback TCP/TLS.

### 3. Diagnóstico ICE objetivo e sem spam

- `icecandidateerror` agora registra explicitamente `errorCode`, `errorText`, `url`, `address` e `port`;
- erros repetidos da mesma rota são deduplicados;
- quando um candidate `relay` é realmente obtido, o console registra `TaskBoard: candidato TURN relay disponível`;
- erros 401/438 de autenticação TURN recebem mensagem específica para separar credencial inválida de simples falha de uma rota 701.

### 4. Compartilhamento nativo Android

A ponte Android continua recebendo a lista completa de servidores TURN. O modo UDP-first foi aplicado somente ao `RTCPeerConnection` do navegador, onde os erros TCP/TLS/IPv6 estavam aparecendo.

## Banco / Supabase

Não há migration nova na V144.

A migration `090_taskboard_reliable_meeting_signaling.sql` da V143 pode permanecer aplicada. O fallback persistente continua ativo, mas agora não provoca uma tempestade de renegociação SDP.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `lib/webrtc/ice-servers.ts`
- `lib/app-version.ts`
- `next.config.mjs`
- `WEBRTC_VALIDACAO.md`
- `V144_FIX_NOTES.md`

## Validação recomendada

1. Feche completamente as reuniões abertas antes do deploy.
2. Publique a V144 e abra uma reunião nova.
3. Entre com desktop e mobile.
4. No console, procure uma única linha `TaskBoard: candidato TURN relay disponível` quando relay for necessário.
5. Se aparecer `TaskBoard: erro ICE`, agora copie `errorCode` e `errorText`; erros 701 isolados em uma rota não significam, sozinhos, falha total do TURN.
6. Confirme que o estado sai de `Conectando mídia` sem novas ofertas SDP a cada poucos segundos.
