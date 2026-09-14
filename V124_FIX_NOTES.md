# TaskBoard V124 — Editor de imagens no visualizador

## Objetivo
Adicionar ao visualizador de imagens uma edição rápida para o fluxo de evidências, sem alterar a imagem original.

## Alterações
- Novo botão **Editar** na barra do visualizador de imagens.
- Novo editor responsivo baseado em Canvas, sem dependência externa:
  - recorte livre com movimentação e 8 alças de redimensionamento;
  - grade de terços durante o recorte;
  - desenho livre com cores e espessuras;
  - desfazer/refazer;
  - rotação para esquerda/direita;
  - suporte a mouse, caneta e touch;
  - saída em PNG preservando a imagem original.
- Após concluir a edição, o visualizador passa a mostrar a versão editada e libera:
  - **Enviar** para reenviar no contexto atual quando disponível;
  - **Compartilhar** para abrir o seletor interno do TaskBoard e escolher outro projeto/atividade/subatividade/solicitação/AQS;
  - **Baixar** a imagem editada.
- Reenvio direto habilitado em:
  - Acompanhamento de subatividade;
  - Solicitações;
  - Análise AQS;
  - Chat;
  - Chat de reunião.
- O compartilhamento para outro destino reutiliza o cache do fluxo `/compartilhar`, compatível com o compartilhamento PWA já existente.
- Ao fechar o visualizador, a edição temporária é descartada; o arquivo original nunca é sobrescrito.

## Banco de dados
Nenhuma migration nova.

## Validação
- 195 arquivos TypeScript/TSX analisados pelo parser TypeScript.
- 0 erros sintáticos.
