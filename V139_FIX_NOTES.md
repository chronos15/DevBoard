# TaskBoard V139 — versão e data/hora da build no sidebar

Base: V138.

## Rodapé do sidebar

- Exibe abaixo de **Sair** somente uma linha discreta no formato `V139 - dd/MM HH:mm`.
- Mantém fonte pequena, baixa opacidade e sem criar um bloco visual extra no sidebar.
- Quando o sidebar está recolhido no desktop, a linha fica oculta para preservar o modo compacto.

## Data/hora da build

- A data/hora é calculada uma única vez durante a build/inicialização do Next e injetada no frontend.
- O timezone padrão é `America/Sao_Paulo`, evitando mostrar horário UTC quando a aplicação é compilada no Vercel.
- É possível sobrescrever manualmente com `TASKBOARD_BUILD_DATE` no formato desejado.
- Também é possível alterar o timezone de geração com `TASKBOARD_BUILD_TIMEZONE`.
- A versão continua configurável por `TASKBOARD_VERSION`.

## Arquivos alterados

- `components/sidebar.tsx`
- `next.config.mjs`
- `lib/app-version.ts`
- `V139_FIX_NOTES.md`
