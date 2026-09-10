# TaskBoard V83 — Ações compactas de atividade no mobile

## Objetivo
Reduzir o espaço horizontal ocupado pelos cards de atividade em **Projetos > Atividades > Lista** no modo completo quando usado em celular, sem alterar a estrutura de dados, permissões ou comportamento do desktop.

## Alterações
- No mobile (`< 640px`), as ações laterais da atividade foram substituídas por um único botão **`...`**.
- O botão abre um menu compacto e ancorado na própria tela com:
  - Informações da atividade;
  - Anexos (com contador quando houver arquivos);
  - Copiar link;
  - Excluir atividade, somente quando a regra existente permitir.
- Informações, anexos, link e exclusão continuam usando exatamente as mesmas funções/regras já existentes.
- No desktop, os botões laterais continuam iguais à V82.
- No mobile, título e metadados foram reorganizados em duas linhas para priorizar o nome da atividade:
  - primeira linha: número + título;
  - segunda linha: tipo, OS quando existir, responsável, progresso e horas.
- `ActivityInfoDialog` e `AttachmentDialog` passaram a aceitar abertura controlada apenas para permitir que o menu mobile os acione sem duplicar regras de negócio.

## Banco de dados
Nenhuma migration nova. Alteração exclusivamente de UI/frontend.
