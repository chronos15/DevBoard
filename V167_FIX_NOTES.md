# TaskBoard V167 — ações da atividade no topo

## Ajuste

Na tela **Projetos > Atividades**, ao expandir uma atividade, as ações **Nova subatividade** e **Acompanhamento** foram movidas do final da lista para o topo do conteúdo expandido.

Com isso:
- não é mais necessário rolar todas as subatividades para criar uma nova;
- o acesso ao Acompanhamento fica imediatamente disponível;
- o rodapé antigo foi removido para evitar duplicação;
- permissões e regras existentes foram preservadas.

## Arquivos alterados
- `components/project-detail/activity-item.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V167_FIX_NOTES.md`

Não há migration nova.
