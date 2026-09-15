# TaskBoard V164 — Acompanhamento por status

## Ajustes

- Reforçadas as cores dos status na lista de subatividades do Acompanhamento, tanto no modo completo quanto no resumido.
- Cada status agora possui uma cor visual própria:
  - Backlog: cinza
  - Aguardando: âmbar
  - Em execução: azul
  - Pausada: laranja
  - Aguardando AQS: violeta
  - Concluída: verde
  - Cancelada: vermelho/rosa
- Indicadores de status ficaram um pouco maiores e com maior contraste.
- O status exibido no cabeçalho da subatividade e nos menus de mudança de status usa a mesma identidade visual.
- Subatividades no navegador do Acompanhamento agora são ordenadas por status, nesta sequência:
  1. Backlog
  2. Aguardando
  3. Em execução
  4. Pausada
  5. Aguardando AQS
  6. Concluída
  7. Cancelada
- Dentro do mesmo status, a ordem original das subatividades é preservada.

## Estrutura

- Nenhuma migration nova.
- Nenhuma alteração de valores internos dos status.
- Nenhuma alteração na regra de permissões ou fluxo do acompanhamento.
