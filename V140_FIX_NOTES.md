# TaskBoard V140 — estabilidade de reuniões / WebRTC

## Diagnóstico

A recuperação adicionada na V111 estava agressiva demais e podia causar exatamente o sintoma que deveria resolver. Em vídeo sem avanço ela destacava a track com `replaceTrack(null)`, reiniciava ICE e, após novas verificações, podia fechar/recriar o `RTCPeerConnection`. Em Chrome/PWA isso pode deixar o decoder aguardando keyframe, produzir card preto e iniciar ciclos de negociação.

Também existia um segundo caso: depois de `setLocalDescription(offer)`, se o Broadcast/answer se perdesse, o peer podia permanecer em `have-local-offer` sem uma nova tentativa válida.

## Correções

- removido `replaceTrack(null) -> track` da recuperação de mídia;
- `replaceTrack()` só ocorre quando a track efetivamente mudou;
- tracks locais encerradas deixam de ser reutilizadas e são removidas do `MediaStream`;
- se câmera/microfone encerrarem inesperadamente com a reunião ativa, a fonte é readquirida sem recriar o peer;
- se o dispositivo selecionado (USB/Bluetooth/câmera) desaparecer, há fallback para o dispositivo padrão;
- vídeo congelado não reinicia ICE automaticamente;
- ICE restart somente para perda real/persistente de transporte;
- health-check usa frames + bytes de vídeo;
- health-check/watchdog ignoram throttling de background do PWA;
- recuperação escalonada: rebind seguro -> renegociação SDP -> ICE restart somente se necessário;
- removida a destruição/recriação do peer baseada apenas em vídeo sem bytes;
- limpeza de tracks remotas obsoletas por tipo;
- sinais atrasados não são aplicados em peer já substituído;
- offer sem resposta ganha timeout de 10 s, rollback e nova negociação;
- falha de Broadcast após `setLocalDescription()` também faz rollback para não prender o peer;
- `DISCONNECTED` transitório passa a ter 8 s de tolerância antes de recuperação;
- compartilhamento nativo Android deixa de recriar peer após somente 1,8/2,2 s de `DISCONNECTED`.

## Gravação owner-only

A regra da V111 foi mantida e reforçada no cliente:

- somente `meeting.createdBy` cria o `BrowserMeetingRecorder`;
- somente o owner atualiza as fontes do recorder;
- somente o owner processa pedido de stop/publicação;
- recorder residual em participante é interrompido sem publicação;
- a migration 087 continua sendo a proteção de banco para owner-only.

## Banco de dados

Nenhuma migration nova.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `android-client/app/src/main/java/br/com/softwork/devboard/webrtc/NativeScreenShareManager.kt`
- `lib/app-version.ts`
- `next.config.mjs`
- `WEBRTC_VALIDACAO.md`
- `V140_FIX_NOTES.md`
