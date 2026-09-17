# TaskBoard V197 — visualizador de vídeo isolado e zoom unificado

## Corrigido
- O visualizador expandido de vídeo agora ocupa a tela inteira e fica em uma camada dedicada acima de toda a aplicação.
- Gestos de pinça/arraste ficam restritos ao vídeo expandido e não atingem cards, timeline ou botões atrás do modal.
- No mobile, após aplicar zoom, é possível mover o vídeo com um dedo; a pinça continua ampliando/reduzindo e movimentando o ponto focal.
- O fullscreen nativo do elemento `<video>` foi removido nos previews que já possuem botão **Expandir** e também dentro do visualizador. Assim existe um único caminho: **Expandir** abre a experiência de tela cheia com zoom, evitando dois modos diferentes de expansão.
- Desktop mantém roda do mouse para zoom e Shift + arraste para mover quando ampliado.
- O botão **Expandir vídeo** dos previews foi movido para o canto superior esquerdo, evitando sobreposição com ações de copiar/excluir que ficam no canto superior direito.

## Estrutura
- Sem migration.
- Sem alteração de banco, storage ou formato dos anexos.
- Controles normais de reprodução continuam nativos (play/pause, volume e seek).
- Versão embutida atualizada para V197.
