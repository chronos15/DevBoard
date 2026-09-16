# TaskBoard V180 — Owner finaliza reunião pelo botão principal

## Ajuste realizado

O botão principal de saída da sala agora diferencia quem realmente iniciou a reunião dos demais participantes.

- Para o **owner/criador da reunião** (`meeting.createdBy`):
  - o botão **Sair** passa a se chamar **Finalizar reunião**;
  - ao clicar, usa o fluxo já existente de encerramento da reunião (`endMeeting` / `finishMeeting`);
  - a reunião é encerrada para **todos os participantes**;
  - a confirmação de encerramento para todos continua sendo exibida;
  - a finalização/gravação continua seguindo a rotina já existente.

- Para **todos os outros participantes**:
  - o botão continua sendo **Sair**;
  - somente o próprio participante sai;
  - a reunião continua normalmente para os demais.

## Compatibilidade

O ajuste foi feito no componente central da sala de reunião (`components/chat/call-room.tsx`), portanto vale para reuniões abertas pelo Acompanhamento, Análise AQS, Solicitações e demais pontos que reutilizam a mesma sala.

Nenhuma migration ou alteração de banco foi necessária.
