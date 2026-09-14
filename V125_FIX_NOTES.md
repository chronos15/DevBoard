# TaskBoard V125 — isolamento total do preview de imagens

## Correção

O visualizador de imagens agora funciona como uma camada modal realmente exclusiva no mobile e desktop.

- Eventos `pointer`, `touch`, `wheel`, `click`, `double click`, `context menu` e teclado do preview não propagam para mensagens/cards que estão atrás do Portal do React.
- Enquanto o preview está aberto, `touch-action` e `overscroll` do `body` ficam bloqueados e são restaurados ao fechar.
- O viewer expõe `data-taskboard-image-viewer-open` no `body` para que gestos de fundo possam ser recusados explicitamente.
- O swipe para responder do Acompanhamento ignora qualquer gesto enquanto o visualizador está aberto.
- O gesto de segurar mensagem para responder no Chat também é ignorado enquanto o visualizador está aberto.
- O editor de imagens recebeu o mesmo isolamento de eventos para não vazar gestos para a conversa/timeline de trás.
- O bloqueio vale para touch/pen e mantém zoom, pinça, arraste, botões e edição funcionando normalmente dentro do preview.

## Motivo

Por ser renderizado através de Portal, eventos do React ainda podiam subir pela árvore lógica até a mensagem que originou o preview. Em telas touch isso acionava ações como "Responder" e podia focar o composer/abrir o teclado durante o arraste da imagem.

## Banco de dados

Nenhuma migration nova.
