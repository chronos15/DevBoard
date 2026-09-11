# TaskBoard V97 — Correção do visualizador de imagens

## Correção

- Corrigido o visualizador de imagens que ficava estreito em telas desktop/tablet, mesmo com espaço disponível.
- A causa era a regra responsiva padrão do `DialogContent` (`sm:max-w-sm`), que voltava a limitar a largura do modal a partir do breakpoint `sm`.
- O `ImageViewerDialog` agora sobrescreve explicitamente essa regra com `sm:max-w-none`, mantendo a largura definida pelo próprio visualizador (`min(96vw, 1500px)`).
- A correção é local ao visualizador de imagens; os demais diálogos/modais do TaskBoard continuam com o comportamento original.

## Resultado esperado

- Mobile: visualizador praticamente em tela cheia, respeitando margem de segurança.
- Desktop/tablet: visualizador amplo e centralizado, usando até 96% da viewport e no máximo 1500 px.
- Cabeçalho deixa de quebrar em múltiplas linhas por falta de largura.
- Barra de zoom/rotação/download permanece alinhada à direita em telas maiores.
- Zoom, arraste, roda do mouse, duplo clique e pinça continuam funcionando sem alteração.

## Banco de dados

- Nenhuma nova migration nesta versão.
