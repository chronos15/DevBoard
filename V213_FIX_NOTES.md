# TaskBoard V213

## Reunião — correção definitiva do vídeo remoto após toggle local

- Mantido o comportamento atual dos botões de microfone/câmera: eles continuam alterando somente `track.enabled` + estado/presença; não reenumeram dispositivos.
- Não há restart de ICE, renegociação, recriação de `RTCPeerConnection`, `replaceTrack` ou reconstrução das tracks remotas.
- O problema estava concentrado no renderer/gate visual do `<video>` remoto em alguns Chrome/driver/GPU: áudio e WebRTC permaneciam ativos, mas o elemento podia parar de avançar ou os callbacks de frame não voltavam após um toggle local.
- `requestVideoFrameCallback` agora possui fallback contínuo por `readyState/videoWidth/videoHeight`, evitando o avatar permanecer ocultando um vídeo que já voltou a renderizar.
- O `play()` remoto agora atualiza explicitamente o estado de reprodução quando a Promise resolve, sem depender exclusivamente do evento `onPlaying`.
- Adicionado watchdog por participante para detectar vídeo remoto que parou de avançar enquanto a câmera remota continua ativa.
- Se o renderer travar, o TaskBoard recupera apenas o elemento `<video>`: desanexa e reanexa o MESMO `MediaStream` e reaplica `play()`.
- A recuperação é limitada/throttled e não toca na conexão WebRTC nem no áudio.
- O estado `track.muted` deixou de ser usado como bloqueio definitivo de visualização, pois pode ficar defasado temporariamente em alguns navegadores. Presence + existência da track viva + frame real do `<video>` passam a determinar a exibição.

## Versão

- Versão embutida atualizada para V213.
- Sem migration nova.
