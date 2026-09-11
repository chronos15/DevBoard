# TaskBoard V98 — Contexto operacional na abertura da atividade

## Nova atividade

A janela **Nova atividade** do Acompanhamento/Modo Resumido agora possui os dados operacionais solicitados, mantendo os campos já existentes de Tipo e Responsável:

- **Build** — texto livre, inicialmente preenchido com o build atual do projeto quando existir.
- **O.S. vinculada** — texto livre para informar a ordem de serviço relacionada.
- **Prioridade** — Baixa, Média ou Alta.
- **Módulo relacionado** — opções vindas exclusivamente de `projects.modules` do projeto atual.
- **Assunto** — opções vindas exclusivamente de `projects.subjects` do projeto atual.
- **Departamento responsável** — opções vindas exclusivamente de `projects.responsible_departments` do projeto atual.

Quando o projeto não possui opções cadastradas em uma dessas listas, o respectivo seletor fica desabilitado e informa que não há itens configurados.

## Informações da atividade

O painel somente leitura **Informações da atividade** ganhou o bloco **Dados da abertura**, exibindo os dados salvos na criação da atividade. Isso preserva o contexto da abertura mesmo que posteriormente o cadastro de módulos, assuntos ou departamentos do projeto seja alterado.

## Banco de dados

Execute a migration:

`supabase/migrations/080_taskboard_activity_opening_context.sql`

Ela adiciona às atividades:

- `build`
- `linked_os`
- `priority`
- `related_module`
- `subject`
- `responsible_department`

A migration também cria a RPC `set_activity_context`, mantendo a RPC legada `add_activity` intacta para não quebrar integrações e fluxos existentes.

A RPC valida que módulo, assunto e departamento pertencem ao **Contexto do sistema** do projeto correspondente.
