# V120 — Proporção correta dos cards do dashboard

## Ajuste
- Corrigida a linha principal do dashboard em telas grandes.
- `Status das tarefas` continua levemente menor no desktop, mas agora sua largura menor pertence à própria coluna da grade.
- O espaço liberado é redistribuído entre `Horas registradas` e `Equipe`, eliminando a área vazia da V119.
- Proporção desktop: `1.04fr / 1.04fr / 0.92fr`.
- Em tablet/mobile os cards continuam ocupando 100% da largura disponível.
- A segunda linha do dashboard permanece com três colunas iguais no desktop.

## Arquivos alterados
- `app/page.tsx`
- `V120_FIX_NOTES.md`

## Banco
- Nenhuma migration nova.
