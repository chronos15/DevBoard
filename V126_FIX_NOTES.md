# TaskBoard V126 — Preview mobile, editor e navegação Voltar

Base: V125.

## Ajustes

- Barra de controles do preview de imagem no mobile agora ocupa toda a largura útil do cabeçalho.
- Controles touch ficaram mais altos e com alvo de toque maior em Android/iOS.
- O espaço reservado para o botão fechar agora afeta somente o título no mobile, não a barra inteira.
- Rodapé do editor de imagem corrigido para não cortar `Cancelar` / `Concluir edição` em telas estreitas.
- Rodapé respeita `safe-area-inset-bottom` de iPhone/Android e usa duas colunas no mobile.
- Botão/gesto Voltar do Android e Voltar do navegador agora percorrem as camadas corretamente:
  1. Editor/recorte -> Preview;
  2. Preview -> tópico/tela de origem.
- Fechar pelo X/Cancelar usa a mesma pilha de navegação, evitando voltar para uma página anterior indevidamente.
- Reuniões não são minimizadas quando o `popstate` pertence ao preview/editor de imagem.

## Banco de dados

Nenhuma migration nova.
