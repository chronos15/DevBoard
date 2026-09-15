# TaskBoard V141 — regressão controlada das reuniões para a base estável V110

## Motivo

As reuniões funcionavam corretamente até a V110. A V111 alterou a estratégia de recuperação de vídeo/WebRTC para tentar corrigir cards pretos/congelados, mas essa recuperação passou a interferir em conexões ainda válidas. As tentativas posteriores de estabilização mantinham parte dessa arquitetura e, por isso, o problema podia continuar aparecendo.

A V141 não adiciona outro watchdog. Ela faz uma **regressão controlada somente do núcleo de mídia/sinalização da reunião para o comportamento da V110**, preservando o restante do projeto atual.

## O que voltou ao comportamento da V110

- removido o sinal `media-resync-request`;
- removido o watchdog visual que chamava recuperação quando `requestVideoFrameCallback` deixava de avançar;
- removido `replaceTrack(null) -> track`, que destacava temporariamente a fonte do sender;
- removida a recriação automática do `RTCPeerConnection` por ausência isolada de bytes/frames de vídeo;
- restaurado o health-check simples de RTP da V110: áudio + vídeo combinados, intervalo de 5 s e ICE restart somente após quatro verificações sem progresso (~20 s);
- o receiver de compartilhamento nativo Android volta a reutilizar o peer existente e só o fecha em `failed`/`closed`;
- o sender nativo Android volta a recriar peer automaticamente apenas em `FAILED`, como na V110; `DISCONNECTED` transitório não destrói a conexão.

## O que foi preservado da V111

A regra solicitada de gravação permanece **owner-only**:

- somente `meetings.created_by` cria o `BrowserMeetingRecorder`;
- participantes não fazem takeover da gravação;
- somente o owner publica a gravação final;
- sinais de estado de gravação de outro usuário são ignorados;
- a migration `087_taskboard_hours_report_and_meeting_reliability.sql` continua protegendo a regra também no banco.

A correção da apuração de horas da migration 087 também permanece intacta.

## O que NÃO foi revertido

Não houve rollback geral do TaskBoard. Todas as funcionalidades e correções das versões posteriores permanecem no projeto, incluindo UI, acompanhamento, solicitações, permissões, notificações, PWA/share target, sidebar de versão/build e demais módulos. Apenas os trechos de recuperação WebRTC introduzidos na V111/V140 foram retirados do núcleo da reunião.

## Migration

Não há migration nova na V141.

Se a migration 087 já foi executada, mantenha-a aplicada.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `android-client/app/src/main/java/br/com/softwork/devboard/webrtc/NativeScreenShareManager.kt`
- `lib/app-version.ts`
- `next.config.mjs`
- `WEBRTC_VALIDACAO.md`
- `V141_FIX_NOTES.md`

## Teste de aceite recomendado

1. Owner inicia reunião a partir de uma subatividade.
2. Entrar com pelo menos dois usuários/dispositivos diferentes.
3. Validar áudio e vídeo nos dois sentidos por pelo menos 5 minutos, sem alternar câmera.
4. Ligar/desligar câmera 10 vezes em participantes diferentes.
5. Minimizar e restaurar o PWA.
6. Se aplicável, testar compartilhamento nativo Android.
7. Encerrar a reunião e confirmar que **somente o owner** gerou/publicou a gravação.
8. Repetir uma chamada em redes diferentes para validar TURN quando P2P direto não for possível.
