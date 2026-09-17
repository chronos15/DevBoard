# TaskBoard V195 — Zoom em vídeos expandidos

## Objetivo
Adicionar zoom em vídeos quando abertos/visualizados em tamanho expandido, preservando os controles nativos de reprodução e o funcionamento atual do TaskBoard.

## Alterações
- Novo visualizador compartilhado `VideoViewerDialog` / `ZoomableVideoStage`.
- Mobile/touch:
  - pinça com dois dedos para ampliar/reduzir;
  - o ponto entre os dedos é mantido como foco do zoom;
  - os controles nativos do vídeo continuam disponíveis com toque normal.
- Desktop:
  - roda do mouse amplia/reduz em torno da posição do cursor;
  - botões `-`, percentual, `+` e redefinir;
  - `Shift + arrastar` move o vídeo quando estiver ampliado, sem capturar cliques normais de play/volume/seek.
- Zoom limitado entre 100% e 400% para evitar estados difíceis de recuperar.
- Botão discreto de expandir adicionado aos vídeos do Acompanhamento e Chat/Reunião.
- Visualizadores já expandidos de anexos (AQS/Solicitações/arquivos) passam a usar o mesmo zoom.
- Preview de vídeo antes do envio também usa o mesmo componente.
- Botão Voltar do Android/navegador fecha o visualizador de vídeo antes de sair da tela.
- Mantidos `controls`, `playsInline`, seek, volume, play/pause e fullscreen nativos do vídeo.

## Banco / migrations
Nenhuma migration nova.

## Versão física
Fallback embutido atualizado para `V195` em `next.config.mjs` e `lib/app-version.ts`.
