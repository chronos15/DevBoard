# TaskBoard V150 — Atividades responsivas e menu compacto

## Ajustes realizados

### Tela de projetos / atividades
- Reestruturado o cabeçalho de **Atividades** para telas menores.
- Botão **Adicionar atividade** e alternância **Lista / Kanban / Acompanhamento** agora quebram melhor e aceitam overflow horizontal sem cortar conteúdo.
- Chips de filtro e selects foram reorganizados para melhor adaptação em resoluções intermediárias.

### Card de atividade
- Removidos os 4 ícones fixos na lateral direita.
- Adicionado um único botão **...** com menu popup simples contendo:
  - Informações
  - Anotações
  - Arquivos
  - Copiar link
  - Excluir atividade (quando permitido)
- Card ganhou mais espaço útil para o conteúdo principal.
- Título da atividade agora pode quebrar linha, evitando truncamento agressivo.
- Adicionada uma linha de contexto/descrição visível com dados como:
  - módulo
  - assunto
  - departamento
  - O.S.
  - build
  - ou fallback para título da OS / tópico de origem
- Barra de progresso e tempo ficaram integrados ao corpo do card, melhorando legibilidade e responsividade.

## Arquivos alterados
- `components/project-detail/project-detail.tsx`
- `components/project-detail/activity-item.tsx`
