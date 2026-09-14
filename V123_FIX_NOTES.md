# V123 — Gestos touch do visualizador de imagens

## Ajustes

- Corrigido o visualizador de imagens compartilhado por Acompanhamento, Solicitações, Análise AQS e Chat/Reuniões em Android/iOS.
- Pinça agora mantém o ponto entre os dedos ancorado durante o zoom, evitando saltos da imagem.
- Arraste usa referências estáveis durante o gesto para não pular quando um dos dedos da pinça é solto.
- Pan ganhou limites baseados no tamanho real renderizado da imagem/viewport, impedindo que a imagem desapareça para fora da tela.
- Bloqueado o gesto nativo de zoom/scroll do Safari/PWA apenas dentro do viewer para não competir com a pinça do TaskBoard.
- Adicionado double-tap touch confiável para alternar entre 100% e 200%.
- Alterações de orientação/tamanho da viewport reaplicam os limites do pan.
- Desktop mantém mouse wheel, drag, double click, rotação, reset e download.

## Banco

- Nenhuma migration nova.
