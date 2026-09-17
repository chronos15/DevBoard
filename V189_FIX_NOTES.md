# TaskBoard V189 — Formatação de texto estilo Discord

## Formatações adicionadas

O componente central `RichMessageText` agora interpreta formatação leve em mensagens sem alterar o texto salvo no banco.

- `# Título` → Cabeçalho 1
- `## Título` → Cabeçalho 2
- `### Título` → Cabeçalho 3
- `**texto**` → negrito
- `*texto*` → itálico
- `||texto||` → spoiler oculto até clicar/tocar
- `- item` → marcador/lista com ponto
- blocos entre três crases (``` ... ```) → bloco de código no estilo Discord, preservando quebras e espaços

Links e menções continuam funcionando dentro de negrito, itálico, cabeçalhos, listas e spoilers revelados. Blocos de código não interpretam menções, links ou outras marcações, preservando o conteúdo literal.

## Alcance

Como a alteração foi feita no renderizador compartilhado, o comportamento passa a valer automaticamente onde `RichMessageText` já é usado, incluindo Acompanhamento, Chat, reuniões, Solicitações, Análise AQS, comentários/resumos e anotações que reutilizam o componente.

## Compatibilidade

- Nenhuma migration.
- Nenhuma alteração no formato salvo das mensagens.
- Mensagens antigas continuam sendo exibidas normalmente.
- A versão embutida do pacote foi atualizada para V189.
