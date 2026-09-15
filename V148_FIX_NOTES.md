# TaskBoard V148 — restauração definitiva do transporte WebRTC pré-V111

## Motivo

Depois das tentativas V143–V147, a reunião ainda conseguia trocar `offer/answer`, mas não estabilizava áudio/vídeo. A análise mostrou que o caminho de sinalização continuava diferente da versão que funcionava antes da V111: SDP e candidatos ICE estavam passando por Broadcast HTTP + RPC/polling persistente, criando mais de um transporte, deduplicação e temporização concorrentes.

A V148 faz um hard reset **somente da sinalização/mídia WebRTC principal** para o modelo funcional pré-V111.

## O que mudou

- `offer`, `answer`, `ice` e `restart-request` voltam a trafegar por um único caminho: **Supabase Realtime Broadcast pelo WebSocket já SUBSCRIBED**;
- a reunião não usa `httpSend()` para WebRTC;
- a reunião não grava nem lê `meeting_webrtc_signals` durante a chamada; a migration 090 pode continuar aplicada, mas fica fora do caminho ativo;
- removido polling RPC concorrente de sinalização;
- removida solicitação artificial de nova offer pelo answerer;
- a ordem dos sinais continua serializada por participante;
- ICE candidates voltam a ser aplicados diretamente/na fila até existir `remoteDescription`, como na base V110;
- TURN/STUN da Edge Function continuam usados normalmente pelo `RTCPeerConnection`;
- erro ICE 701 de rota IPv6/TCP é diagnóstico e não derruba a chamada;
- **nenhum ICE restart automático ocorre antes de o peer ter conectado pelo menos uma vez**. Isso impede loops durante o primeiro handshake;
- depois que o peer já conectou, recuperação por ICE restart continua disponível para perda real de rede;
- logs objetivos adicionados para `track remota recebida`, estado ICE e estado do peer.

## Preservado

- gravação automática somente pelo owner/criador da reunião;
- TURN Cloudflare atual;
- compartilhamento de tela e integração Android;
- todas as alterações de UI/UX das versões posteriores;
- migration 087 e demais regras do banco.

## Migration

Não há migration nova.

A migration 090 pode permanecer no banco; a V148 simplesmente não usa seu fallback persistente na reunião.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V148_FIX_NOTES.md`

## Teste de aceite

1. Publicar a V148 e confirmar `V148 - dd/MM HH:mm` no sidebar.
2. Encerrar qualquer reunião antiga e criar uma nova.
3. Entrar com dois dispositivos.
4. Confirmar no console: `offer WebRTC recebida` / `answer WebRTC recebida`.
5. Confirmar chegada de `candidato TURN relay remoto recebido` quando TURN for usado.
6. Confirmar `track remota recebida` para `audio` e `video`.
7. Confirmar `estado do peer: connected`.
8. Validar áudio e vídeo nos dois sentidos.
