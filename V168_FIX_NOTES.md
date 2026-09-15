# TaskBoard V168 — ações responsivas da atividade e estimativa HH:mm

## Projetos > Atividades

- Em dispositivos grandes (`2xl`), **Nova subatividade** e **Acompanhamento** ficam na própria faixa de metadados da atividade, aproveitando o espaço horizontal disponível.
- Em telas menores/intermediárias, as duas ações continuam na faixa superior antes da lista de subatividades, como na V167.
- Não há duplicação visual: apenas uma posição é exibida por breakpoint.

## Estimativa das subatividades

- A estimativa deixou de ser digitada/exibida como número decimal nas telas principais da subatividade.
- Criação de subatividade em Projetos/Lista agora usa `HH:mm`.
- Criação de subatividade pelo Acompanhamento também usa `HH:mm`.
- Edição administrativa da subatividade usa `HH:mm`.
- A linha da subatividade mostra a estimativa em `HH:mm`.
- Timer focado e detalhes da Análise AQS também exibem estimativa em `HH:mm`.
- Internamente o banco/Store continuam usando horas decimais para preservar compatibilidade. A conversão acontece somente na entrada/saída visual.
- Validação exige minutos entre `00` e `59` antes de salvar.

Exemplos:
- `01:00` = 1 hora
- `01:30` = 1,5 hora
- `04:15` = 4,25 horas

## Banco

- Nenhuma migration nova.
- Nenhuma alteração de schema.
