# TaskBoard V160 — KPIs iniciais compactos no mobile

## Ajuste
- Na tela inicial, os cards **Projetos ativos**, **Horas registradas**, **Em andamento** e **Taxa de conclusão** passam a usar **2 colunas por linha no mobile**.
- Gap reduzido e consistente entre os cards no mobile.
- Altura, padding, ícones e tipografia foram compactados somente em telas pequenas.
- A informação secundária lateral (`seu escopo`, `suas horas`, etc.) é ocultada no mobile para evitar esmagar o conteúdo.
- Em `sm`/tablet e desktop o espaçamento original é preservado; em `xl` continua com os 4 cards na mesma linha.

## Arquivos alterados
- `components/dashboard/kpi-cards.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
