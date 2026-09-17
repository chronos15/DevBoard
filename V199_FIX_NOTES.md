# TaskBoard V199 — correção estrutural do vídeo expandido

## Problema
Na V197/V198 o vídeo expandido podia ficar preso no lado esquerdo e cortado porque o viewer ainda era montado sobre o componente genérico de `Dialog`, que possui posicionamento, largura máxima, transformação e animações próprias. Mesmo sobrescrevendo parte dessas regras, havia conflito de layout em alguns tamanhos de tela/navegadores.

## Correção
- O vídeo expandido não usa mais o `DialogContent` genérico.
- O viewer agora é renderizado diretamente em `document.body` por Portal, em uma superfície `fixed inset-0` exclusiva.
- A camada ocupa exatamente `100dvw x 100dvh`, sem `translate`, `max-width` ou posicionamento herdado de modal.
- Vídeo fica centralizado no viewport com `object-contain`, sem ser empurrado para esquerda.
- Z-index dedicado e extremamente alto para permanecer acima de menus, previews, ações e painéis.
- Scroll/overscroll do `html` e `body` é bloqueado enquanto o viewer está aberto.
- Eventos de pointer/touch/wheel ficam contidos no viewer e não atingem elementos por trás.
- Pinch e pan mobile continuam funcionando; desktop mantém roda do mouse e Shift + arrastar.
- `Esc`, botão fechar e Voltar do navegador/Android fecham o viewer antes de navegar.
- O fullscreen nativo continua removido: Expandir é o único modo de tela cheia e já possui zoom.

## Estrutura
- Sem migration.
- Sem alteração em Storage, mensagens ou formato de anexos.
- Versão embutida atualizada para V199.
