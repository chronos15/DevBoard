# TaskBoard V162 — Administrativo e responsividade dos relatórios

## Alterações

### Nome visual do módulo
- O módulo `/relatorios` passa a aparecer visualmente como **Administrativo**.
- Rotas, chave interna `reports`, permissões e estrutura de dados permanecem inalteradas.
- Sidebar, título da página, permissões, presença e ajuda foram alinhados ao novo nome visual.

### Filtros no mobile
- O modal **Filtros do relatório** agora possui layout de três linhas: header, conteúdo rolável e footer.
- O corpo usa scroll vertical interno com `minmax(0,1fr)`, evitando que os filtros ultrapassem a viewport.
- Header e footer permanecem acessíveis enquanto somente o conteúdo central rola.
- Padding mobile foi reduzido sem alterar o layout desktop.

### Gantt diário de execução
- O Gantt agora força largura de conteúdo própria e scroll horizontal local em telas pequenas.
- A coluna de escopo foi reduzida para `w-64` no mobile e volta a `w-80` a partir de `sm`.
- Adicionada orientação visual no mobile para deslizar horizontalmente.
- O scroll vertical do Gantt permanece limitado à própria seção.

## Sem alterações estruturais
- Nenhuma migration nova.
- Nenhuma rota alterada.
- Nenhum nome interno de permissão ou chave de banco foi renomeado.
