# TaskBoard V139 — versão e build no sidebar

Base: V138.

## Rodapé do sidebar

- Exibe a versão atual e o identificador da build logo abaixo de **Sair**.
- O texto é propositalmente discreto, em fonte monoespaçada pequena e baixa opacidade, para não competir com a navegação nem aumentar visualmente o rodapé.
- Quando o sidebar está recolhido no desktop, a linha de versão fica oculta para preservar a largura compacta.
- O texto completo também fica disponível no `title`/acessibilidade.

## Identificação da versão/build

- A versão padrão desta entrega é `V139`.
- É possível sobrescrever a versão em CI/CD com `TASKBOARD_VERSION`.
- A build usa, nesta ordem: `TASKBOARD_BUILD`, SHA do commit do Vercel/GitHub/CI ou um timestamp curto para builds locais.
- `lib/app-version.ts` centraliza o consumo dessas informações no frontend.

## Arquivos alterados

- `components/sidebar.tsx`
- `next.config.mjs`
- `lib/app-version.ts` (novo)
- `V139_FIX_NOTES.md` (novo)
