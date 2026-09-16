# TaskBoard V170 — Referências de O.S. e Build / Server nas subatividades

## Ajustes

- Ao criar uma nova subatividade, se a atividade ainda estiver sem número de O.S. e/ou Build / Server, o formulário exibe um alerta opcional para preencher essas referências.
- O preenchimento é totalmente opcional: a subatividade continua podendo ser criada com os campos vazios.
- Quando informado, o dado é salvo na própria atividade usando a RPC existente `set_activity_context`, preservando os demais campos de contexto da atividade.
- O fluxo foi aplicado tanto na criação de subatividade pela tela de projetos quanto no Acompanhamento.
- Os cards das subatividades no Acompanhamento agora mostram, quando disponíveis:
  - `OS <número>`;
  - `Build/Server <valor>`.
- A área principal do Acompanhamento também exibe essas referências abaixo do título da subatividade selecionada.
- O rótulo visual de `Build` da atividade foi ajustado para `Build / Server`, sem alterar o nome da coluna no banco nem a estrutura existente.
- Foi adicionado um método central `updateActivityContext` no store para atualizar somente o contexto necessário, mantendo os demais dados já cadastrados.

## Arquivos alterados

- `components/project-detail/add-subactivity-dialog.tsx`
- `components/project-detail/follow-up-structure-dialogs.tsx`
- `components/project-detail/project-follow-up.tsx`
- `components/project-detail/activity-item.tsx`
- `components/project-detail/activity-info-dialog.tsx`
- `lib/store.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V170_FIX_NOTES.md`

## Banco

Nenhuma migration nova. A versão reaproveita os campos `activities.linked_os` e `activities.build` e a RPC `set_activity_context` já existentes.
