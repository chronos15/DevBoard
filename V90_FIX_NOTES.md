# TaskBoard V90 — correção do menu compacto da subatividade

## Correção

- Corrigido o erro de página ao clicar no botão `...` do cabeçalho da subatividade/Acompanhamento.
- O menu da V89 usava o `DropdownMenu`/submenu do Base UI dentro do cabeçalho complexo do Acompanhamento e podia derrubar a árvore React ao abrir.
- O menu foi refeito com o popup/portal nativo já utilizado pelo TaskBoard, sem dependência do submenu do Base UI.
- Mantidas as mesmas ações e permissões da V89.
- As telas internas de **Mensagens fixadas** e **Alterar situação** agora navegam dentro do mesmo popup compacto, sem submenu aninhado.
- Fechamento seguro por clique fora, `Esc`, resize e scroll.

## Banco

- Nenhuma migration nova.
