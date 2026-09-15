# TaskBoard V151 — Atividades/subatividades responsivas e dashboard refinado

## Projetos > Atividades

- Cabeçalho reorganizado para não depender da largura restante da tela.
- `Adicionar atividade` fica junto ao título e pode quebrar de linha quando necessário.
- `Lista / Kanban / Acompanhamento` agora ocupa uma linha própria, em grade responsiva de 3 colunas, evitando corte lateral mesmo com sidebar e painel direito abertos.
- Filtros continuam responsivos e os chips podem rolar horizontalmente sem ultrapassar o card.

## Card de atividade

- Mantido o único botão `...` para ações secundárias.
- Título passa a usar todo o espaço disponível e quebra linhas naturalmente.
- Linha de contexto visível com módulo, assunto, departamento, O.S. e build quando informados; quando não existem, usa título da solicitação/tópico de origem como fallback.
- Progresso e tempo permanecem integrados ao conteúdo, sem reservar uma coluna inteira de ícones.

## Subatividades

- Removida a barra de vários ícones da linha da subatividade.
- Adicionado botão `...` com popup para:
  - marcar/remover foco (admin);
  - editar subatividade (admin);
  - copiar link;
  - ativar/encerrar brainstorm;
  - comentários;
  - arquivos.
- Comentários e anexos agora podem ser abertos de forma controlada a partir do menu.
- Status, responsável e cronômetro permanecem fora do menu por serem controles operacionais de uso frequente.
- Título da subatividade deixa de truncar em desktop e pode ocupar várias linhas.

## Dashboard da atividade

- Header redesenhado com padding menor e mais equilibrado.
- Título não é truncado e pode quebrar em quantas linhas forem necessárias.
- Projeto e cliente não são cortados.
- Módulo, assunto, departamento, O.S. e build aparecem no header quando disponíveis.
- Tipo, prioridade e quantidade concluída continuam em badges, com wrap responsivo.

## Estrutura

- Nenhuma migration nova.
- Nenhuma alteração nas regras de negócio.
- Correção V149 das reuniões permanece preservada.

## Arquivos alterados

- `components/project-detail/project-detail.tsx`
- `components/project-detail/activity-item.tsx`
- `components/project-detail/activity-info-dialog.tsx`
- `components/comments/comment-dialog.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V151_FIX_NOTES.md`
