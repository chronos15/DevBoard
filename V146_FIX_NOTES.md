# TaskBoard V146 — reunião: sinalização previsível e retorno ao trickle ICE estável

## Diagnóstico confirmado

Os testes em produção mostraram duas informações importantes:

1. a Edge Function `webrtc-ice-servers` está retornando a lista oficial do Cloudflare TURN e o navegador consegue gerar candidato `relay`; portanto o TURN está operacional;
2. o console do supabase-js 2.112 mostra `Realtime send() is automatically falling back to REST API`, indicando que `channel.send()` estava sendo chamado em janelas em que o WebSocket não estava realmente disponível/inscrito.

O vídeo de diagnóstico também mostrou chamadas de `meeting_webrtc_signal_pull` sem sinais disponíveis enquanto o cliente continuava tentando sinalizar, o que reforçou que a camada de transporte estava complexa e sujeita a corrida.

## Correção aplicada

### 1. Broadcast HTTP explícito

Todos os Broadcasts da reunião passam a usar `RealtimeChannel.httpSend()` explicitamente.

Isso elimina o fallback implícito de `channel.send()` e torna o comportamento independente do estado instantâneo do socket do remetente. O receptor continua inscrito no canal WebSocket e recebe o Broadcast normalmente.

A implementação também trata corretamente o retorno de `httpSend()` do `@supabase/supabase-js` 2.112.x (`{ success: true }`), em vez de compará-lo com a string `"ok"` usada por `channel.send()`.

### 2. Sinalização WebRTC com dois caminhos independentes

Para `offer`, `answer`, candidatos ICE e `restart-request`:

- caminho imediato: Broadcast por `httpSend()`;
- caminho confiável: `meeting_webrtc_signal_send` da migration 090;
- recuperação: `meeting_webrtc_signal_pull` busca sinais que não chegaram pelo Broadcast;
- `signalKey` deduplica a mesma mensagem recebida pelos dois caminhos.

### 3. Retorno ao handshake simples da V110

Foram retiradas as estratégias adicionadas nas versões posteriores que aumentavam o número de estados da negociação:

- removido handshake `ready`;
- removida espera por `iceGatheringState === complete`;
- removido SDP completo obrigatório antes do envio;
- removida promoção dinâmica para `iceTransportPolicy: relay`;
- removido fallback TURN em duas fases;
- removidos retries de offer baseados apenas em ICE `checking`.

O fluxo volta a ser:

`createOffer -> setLocalDescription -> offer -> createAnswer -> setLocalDescription -> answer`, com trickle ICE em paralelo.

### 4. Lista completa do Cloudflare desde o início

O `RTCPeerConnection` recebe toda a lista válida retornada pelo Cloudflare desde a criação:

- STUN 3478/UDP;
- TURN 3478/UDP;
- TURN 3478/TCP;
- TURN 80/TCP;
- TURNS 5349/TCP;
- TURNS 443/TCP.

A Edge Function continua removendo apenas porta 53, como recomendado para browser.

### 5. Pedido de offer pelo answerer

Se um participante já enxerga a presença remota, é o answerer do par e ainda não recebeu `remoteDescription`, ele envia uma única `restart-request`. O offerer responde usando o mesmo fluxo da V110. Isso cobre o caso em que o primeiro offer saiu durante a entrada/reconexão do outro cliente.

## Edge Function / secrets

A Edge Function fornecida pelo usuário está correta para o serviço TURN do Cloudflare e não foi alterada nesta versão.

Os valores exibidos pelo painel do Supabase na coluna SHA256 são apenas **digests dos secrets armazenados**, não os valores reais de `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` ou `CLOUDFLARE_TURN_TTL`.

As credenciais `username`/`credential` retornadas por `generate-ice-servers` mudarem entre requisições é esperado: são credenciais TURN temporárias.

## Banco

Não existe migration nova na V146.

A migration `090_taskboard_reliable_meeting_signaling.sql` deve permanecer aplicada.

## Gravação

A regra permanece owner-only:

- somente `meetings.created_by` grava;
- participantes não assumem a gravação;
- somente o owner publica o arquivo final.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `lib/webrtc/ice-servers.ts`
- `lib/app-version.ts`
- `next.config.mjs`
- `WEBRTC_VALIDACAO.md`
- `V146_FIX_NOTES.md`

## Teste após deploy

Encerre as reuniões antigas e crie uma sala nova. Com dois usuários, procure a sequência:

- `TaskBoard: enviando offer WebRTC`;
- `TaskBoard: offer WebRTC recebida`;
- `TaskBoard: answer WebRTC recebida`;
- `TaskBoard: candidato TURN relay disponível` quando relay for necessário;
- `connectionState: connected` / mídia remota visível.

O warning de fallback automático do `Realtime send()` não deve mais ser originado pela reunião.
