# TaskBoard V227 — Narrador de mensagens

## Objetivo
Adicionar leitura por voz (Text-to-Speech) às mensagens sem alterar o fluxo de leitura/não-lidos, Realtime, banco de dados ou armazenamento.

## Implementado
- Narrador global usando a Web Speech API nativa (`speechSynthesis`), sem dependência externa.
- Voz em português priorizada automaticamente (`pt-BR`, com fallback para outras vozes em português e depois para a voz padrão do dispositivo).
- Velocidades disponíveis: 0,5x, 1,0x, 1,5x e 2,0x.
- Velocidade persistida localmente no navegador para os próximos usos.
- Mensagens longas são divididas em trechos menores para reduzir cortes/interrupções, especialmente no Chrome/Android.
- Limpeza do texto antes da narração: Markdown é simplificado, URLs viram “link”, menções deixam de pronunciar “arroba” e blocos de código são resumidos como “bloco de código”.
- Trocar de mensagem interrompe a narração anterior de forma controlada.
- Clicar novamente na mensagem em reprodução para a leitura.
- Ao alterar a velocidade durante a leitura, o trecho atual é reiniciado na nova velocidade, sem reiniciar toda a mensagem.
- Controlador flutuante compacto enquanto o narrador está ativo, com as quatro velocidades e botão de parar.
- Retomada do sintetizador quando a página volta ao primeiro plano e o navegador deixou a fala pausada.

## Superfícies atendidas
- Acompanhamento completo e resumido.
- Chat direto/grupos.
- Chat das reuniões.
- Análise AQS.
- Solicitações.
- Diálogo de comentários.
- Resumo inline recente de subatividade.

## UI / UX
- Desktop: ícone de alto-falante nas ações de cada mensagem.
- Mobile: a ação de ouvir fica no menu `...` da mensagem; onde não existia menu, foi adicionado um menu compacto apenas para as ações adequadas.
- No mobile, o menu do narrador também permite escolher diretamente 0,5x / 1,0x / 1,5x / 2,0x.
- O uso do narrador não altera scroll, âncora, status de mensagem lida, não-lidos ou Realtime.

## Versão
- Versão embutida atualizada para V227.
- Service Worker e registros do SW atualizados para `v=227`.

## Validação
- Sintaxe TS/TSX validada com o compilador TypeScript em todos os arquivos alterados.
- `next.config.mjs` validado com `node --check`.
- Não foi possível executar `next build` completo porque a instalação das dependências não concluiu dentro do ambiente de validação.
