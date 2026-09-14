# TaskBoard V128 — Barra do preview mobile sem overflow

## Correção

- Corrigida a barra de controles do visualizador de imagens em telas estreitas (Android/iOS).
- No mobile os controles agora usam uma grade horizontal com colunas de largura igual (`auto-cols-fr`).
- Todos os botões usam `min-width: 0` e ocupam somente a sua fração disponível, impedindo que o último ícone (download) extrapole/corte na lateral direita.
- Os separadores verticais ficam ocultos no mobile para liberar espaço e permanecem visíveis no desktop.
- O indicador de zoom também pode encolher sem forçar a largura da barra.
- O comportamento de desktop e os gestos de zoom/pinça/arraste da V127 foram preservados.

## Banco de dados

Nenhuma migration nova.
