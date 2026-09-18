# TaskBoard V225

## Reunião — Mural protegido

- O Mural da reunião agora possui um Error Boundary local.
- Se o `ProjectFollowUp` completo falhar durante a montagem/atualização dentro da chamada, o erro não sobe mais para o error boundary global do Next.js.
- A reunião permanece aberta e o sistema apresenta automaticamente o `MeetingWallSurface` seguro com contexto, anexos e timeline.
- Ao fechar e abrir o Mural novamente, o boundary é remontado e o modo completo pode ser tentado de novo sem recarregar toda a aplicação.

## Reunião — PDF do chat somente quando há conteúdo

- O encerramento não gera mais PDF quando não há informação real no chat da reunião.
- Considera conteúdo real: texto não vazio, áudio ou anexo/mídia.
- Reuniões sem conteúdo encerram normalmente e a gravação continua independente do PDF.
- O PDF continua sendo gerado normalmente quando houver mensagens ou arquivos.
