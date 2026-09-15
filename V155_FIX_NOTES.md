# TaskBoard V155 — título expansível no dashboard da atividade

## Ajuste
- O título do dashboard da atividade fica limitado a no máximo **3 linhas** por padrão.
- Quando o texto realmente ultrapassa esse limite, aparece o controle **Expandir título**.
- Ao expandir, o título completo é exibido e o controle muda para **Recolher título**.
- O componente recalcula automaticamente o overflow ao redimensionar a janela.
- O header mantém o padding e a correção estrutural da V154.

## Arquivos alterados
- `components/project-detail/activity-info-dialog.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V155_FIX_NOTES.md`
