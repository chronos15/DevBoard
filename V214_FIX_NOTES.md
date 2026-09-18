# TaskBoard V214

## Reunião — encerramento imediato com artefatos em segundo plano

- Ao clicar em **Finalizar reunião**, o owner não fica mais preso aguardando compressão/upload.
- A rotina de gravação é parada imediatamente para preservar o último trecho e o processamento passa para uma Promise de background que continua viva mesmo após `CallRoom` ser desmontado.
- O backend encerra a reunião em uma RPC curta: todos os participantes passam para `left`, `ended_at` é definido e a UI retorna imediatamente para a tela anterior.
- Um Broadcast `meeting-ended` acelera o fechamento visual nos demais clientes; `ended_at` continua sendo a fonte de verdade.
- Depois que a sala fecha, em segundo plano o TaskBoard:
  1. prepara/comprime os trechos de vídeo;
  2. envia a gravação;
  3. publica a gravação no tópico de origem;
  4. gera o PDF completo do chat usando o horário real do clique em Finalizar;
  5. envia/publica o PDF no mesmo contexto;
  6. atualiza os dados do Acompanhamento.
- A nova RPC `meeting_artifact_context` permite consultar somente o contexto necessário para os artefatos mesmo após a reunião já ter `ended_at`, sem reabrir/reativar a sala.
- `end_meeting` não exige mais que vídeo/PDF já estejam publicados; para reunião contextual continua sendo exclusivo do criador da reunião.
- O fluxo de `leave_meeting`/limpeza automática continua protegido para não confundir abandono acidental com a ação explícita de **Finalizar reunião**.

## WebRTC

- Nenhuma alteração em ICE, SDP, `RTCPeerConnection`, sender/receiver ou renegociação.
- Câmera e microfone são desligados assim que o encerramento da sala é confirmado; o upload trabalha apenas com os segmentos já persistidos pelo gravador.

## Banco

- Nova migration: `098_taskboard_background_meeting_finalize.sql`.

## Versão

- Versão embutida atualizada para V214.
