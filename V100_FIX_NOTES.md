# V100 — Nova atividade em guias + criação unificada

## Alterações

- O modal **Nova atividade** foi reorganizado no mesmo padrão visual da tela **Nova solicitação**.
- Agora existem duas guias:
  - **Identificação**: título, tipo, responsável e prioridade.
  - **Extras**: Build, O.S. vinculada, módulo relacionado, assunto e departamento responsável.
- As guias suportam navegação por clique e setas esquerda/direita no teclado.
- O rodapé permanece fixo e orienta o fluxo:
  - Identificação → **Continuar para extras**.
  - Extras → **Voltar** ou **Criar atividade**.
- A guia Extras é opcional; o Build continua iniciando com o Build atual do projeto.
- O mesmo modal continua sendo reutilizado no Acompanhamento/Chat e agora também é usado na tela de detalhes do projeto.
- Na visualização **Lista** do projeto foi removida a criação rápida inline (título/tipo/responsável/botão).
- Em seu lugar existe apenas o botão **Adicionar atividade**, que abre o modal completo.
- No **Kanban**, a criação rápida de atividade também foi removida e substituída pelo mesmo botão/modal. O seletor usado para adicionar subatividades foi preservado.

## Banco de dados

Nenhuma migration nova é necessária para a V100. A persistência dos campos Extras continua usando a estrutura criada na V98.

## Arquivos alterados

- `components/project-detail/follow-up-structure-dialogs.tsx`
- `components/project-detail/project-detail.tsx`
- `V100_FIX_NOTES.md`

## Validação

- Os dois arquivos TSX alterados foram analisados pelo compilador TypeScript sem erros de sintaxe.
- O projeto contém 188 arquivos TypeScript/TSX.
- O build completo não foi executado porque o pacote fornecido não contém `node_modules`.
