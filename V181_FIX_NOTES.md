# TaskBoard V181 — Visibilidade de projetos e atividades sem responsável

## Objetivo

Corrigir a regressão introduzida quando atividades sem responsável passaram a abrir o projeto para qualquer desenvolvedor.

A regra agora é:

- **Admin** continua vendo tudo.
- **Desenvolvedor** só recebe projetos com algum vínculo real com ele:
  - está em `project_members`;
  - está atribuído a alguma atividade do projeto;
  - é responsável/participante de alguma subatividade do projeto.
- Menções individuais continuam funcionando normalmente, pois o fluxo atual adiciona o usuário ao contexto do projeto/subatividade.
- Uma **atividade sem responsável** continua visível para DEV, mas somente quando esse DEV **já está integrado ao projeto**.
- A atividade sem responsável não cria mais, sozinha, acesso ao projeto.
- `restrict_activities` e `restrict_subactivities` continuam sendo respeitados.
- Nenhuma tabela, enum ou policy foi removida/recriada. A correção reutiliza os mesmos helpers de RLS e os mesmos vínculos já existentes.

## Banco

Nova migration:

`supabase/migrations/094_taskboard_project_scoped_unassigned_activities.sql`

Ela substitui somente a implementação dos helpers:

- `taskboard_can_view_project`
- `taskboard_can_view_activity`
- `taskboard_can_view_subactivity`

As policies já existentes continuam apontando para esses helpers.

## Frontend

`lib/follow-up-access.ts` deixou de usar o bypass `developer => return projects`.

No Acompanhamento/Modo Resumido, um DEV só mantém na árvore projetos em que possui vínculo. Depois desse gate, a árvore retornada pela RLS é preservada, permitindo que atividades sem responsável sejam mostradas normalmente para quem já faz parte do projeto.

A descrição de **Somente atividades integradas** em Configurações também foi atualizada para refletir a regra correta.

## Exemplo

Projeto A:

- Mauricio é membro/responsável em algum ponto do projeto;
- João não possui vínculo;
- existe uma atividade nova sem responsável.

Resultado:

- Mauricio: vê o Projeto A e a atividade sem responsável;
- João: não recebe o Projeto A por causa dessa atividade;
- Admin: continua vendo tudo.
