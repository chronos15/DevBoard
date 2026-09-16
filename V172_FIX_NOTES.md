# TaskBoard V172 — Nova subatividade guiada + herança de O.S. e Versão / Build

## UI/UX da nova subatividade

A criação de subatividade foi reorganizada no mesmo padrão guiado da criação de atividade:

- Guia **Identificação**:
  - Descrição
  - Estimativa (HH:mm)
  - Situação
  - Tipo
  - Responsável
- Guia **Extras**:
  - Número da O.S.
  - Versão / Build

O bloco amarelo de alerta foi removido da criação para deixar a tela mais limpa e menos chamativa. Os campos de O.S. e Versão / Build continuam opcionais.

A navegação entre as guias aceita clique e teclado (`←` / `→`), mantendo o padrão já usado em Atividade.

## Pré-preenchimento automático

Ao abrir **Nova subatividade**, O.S. e Versão / Build são preenchidos automaticamente quando houver contexto anterior:

1. O sistema tenta usar os valores da **última subatividade criada** naquela atividade.
2. Para qualquer campo que esteja vazio na última subatividade, usa o valor configurado na **atividade** como fallback.
3. Se não existir valor em nenhum dos dois locais, o campo permanece vazio.

A herança é apenas um valor inicial: o usuário pode alterar ou apagar os campos antes de criar a nova subatividade.

## Terminologia

Os rótulos visuais `Build / Server` foram corrigidos para **Versão / Build** nas telas de atividade relacionadas, sem renomear colunas ou alterar a estrutura do banco.

## Banco de dados

Nenhuma migration nova é necessária nesta versão. A V172 continua usando os campos `subactivities.linked_os` e `subactivities.build` adicionados na migration da V171.

## Arquivos alterados

- `components/project-detail/add-subactivity-dialog.tsx`
- `components/project-detail/follow-up-structure-dialogs.tsx`
- `components/project-detail/activity-info-dialog.tsx`
- `components/project-detail/activity-item.tsx`
- `lib/subactivity-reference-defaults.ts`
- `V172_FIX_NOTES.md`
