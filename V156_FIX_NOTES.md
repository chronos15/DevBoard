# TaskBoard V156 — detector correto do título expansível

## Correção

O título do dashboard da atividade já estava limitado visualmente a 3 linhas, porém o botão **Expandir título** podia não aparecer.

A causa era a medição através de `scrollHeight/clientHeight` no próprio elemento com `line-clamp-3`. Em alguns navegadores o clamp mascara a altura real do conteúdo e a comparação retorna falso mesmo com texto oculto.

Na V156:

- o título permanece com no máximo 3 linhas por padrão;
- a altura natural é medida através de um elemento espelho invisível, sem clamp;
- o espelho usa a mesma largura, fonte, peso, espaçamento e line-height do título real;
- `Expandir título` aparece sempre que a altura natural ultrapassar 3 linhas;
- ao expandir, todo o texto é mostrado;
- o botão muda para `Recolher título`;
- o cálculo é repetido ao redimensionar o modal/tela e depois do carregamento das fontes web.

## Arquivos alterados

- `components/project-detail/activity-info-dialog.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V156_FIX_NOTES.md`
