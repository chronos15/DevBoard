# TaskBoard V191 — Ag. Aprovação + código inline + formatação durante a digitação

## Status
- O rótulo visual `Aguard. Aprovação` foi reduzido para **Ag. Aprovação**.
- O valor interno do status continua sendo `waiting`, sem alteração de banco ou fluxo.
- Logs antigos que contenham o texto `Aguard. Aprovação` também são apresentados como `Ag. Aprovação` no Acompanhamento.

## Código inline
Além dos blocos com três crases, agora uma única crase de abertura e fechamento gera código inline:

`\`texto\``

O conteúdo é exibido em fonte monoespaçada, com fundo discreto, sem transformar links ou menções dentro do código.

## Formatação visível no composer
Os principais campos de conversa agora exibem a formatação enquanto o usuário digita, mantendo o conteúdo salvo como texto/Markdown compatível com o formato já existente.

Aplicado em:
- Acompanhamento;
- Chat;
- chat de reunião;
- Análise AQS;
- Solicitações;
- comentários;
- edição inline de mensagens.

São destacados durante a digitação:
- `#`, `##` e `###` para cabeçalhos;
- `**negrito**`;
- `*itálico*`;
- `||spoiler||`;
- `` `código inline` ``;
- blocos com três crases;
- linhas iniciadas por `- `.

A implementação preserva menções, atalhos de teclado, Enter para enviar, Shift+Enter para quebra de linha e posicionamento do cursor.

## Versão
- fallback de versão atualizado para **V191** em `next.config.mjs` e `lib/app-version.ts`.

## Banco
- Nenhuma migration nova.
