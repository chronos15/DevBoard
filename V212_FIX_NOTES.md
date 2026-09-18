# TaskBoard V212

## Acompanhamento — reunião em andamento na subatividade

- O Acompanhamento agora identifica a reunião ativa vinculada exatamente à subatividade selecionada pelos UUIDs gravados nos logs de reunião.
- Enquanto a reunião estiver aberta, aparece um card discreto **Reunião em andamento** logo abaixo do cabeçalho da subatividade.
- Clicar no card abre/restaura a reunião.
- Se o usuário ainda estiver com convite pendente, o clique aceita o convite e abre a sala.
- Para o **criador/owner** da reunião, o card mostra o botão **Fin. Reunião**.
- O card não aparece dentro do próprio Mural embutido da reunião para evitar conteúdo duplicado/recursivo.

## Finalização — vídeo e chat obrigatórios antes de encerrar

- Reuniões vinculadas a atividade/subatividade/solicitação/AQS agora permanecem abertas enquanto o owner finaliza os artefatos.
- O fluxo de **Finalizar reunião** passou a ser:
  1. parar/finalizar a gravação;
  2. preparar e enviar todos os trechos de vídeo;
  3. gerar o PDF com o chat completo da reunião;
  4. enviar e registrar o PDF no tópico de origem;
  5. somente então encerrar a sala para todos.
- Se gravação ou PDF falhar, a reunião **não é encerrada** e o owner pode tentar novamente.
- O backend também valida essa regra: em reuniões contextuais, `end_meeting` rejeita o encerramento enquanto gravação e chat não estiverem publicados.
- Reuniões comuns iniciadas diretamente pelo Chat preservam o comportamento anterior.

## Chat da reunião em PDF

- O histórico é filtrado do horário de início da reunião até o momento da finalização, sem misturar conversas de reuniões anteriores do mesmo grupo persistente.
- O PDF inclui autor, data/hora, texto, mensagens editadas, referências de resposta e nomes dos arquivos/áudios enviados.
- O arquivo é anexado no mesmo contexto da reunião:
  - subatividade/atividade: anexos do projeto;
  - solicitação: anexos da solicitação.
- O caminho do arquivo é determinístico por reunião para evitar duplicações em uma nova tentativa.

## Banco

- Nova migration: `097_taskboard_meeting_transcript_and_owner_finish.sql`.
- Nova tabela interna `meeting_transcripts` para registrar de forma idempotente a publicação do PDF.
- Novas RPCs `meeting_transcript_status` e `publish_meeting_transcript`.

## Proteção contra encerramento acidental

- Para reunião contextual ainda sem os artefatos publicados, `leave_meeting` não remove o owner da sala por `pagehide`/fechamento transitório da página.
- O job `close_abandoned_meetings` também preserva o owner e não encerra automaticamente essa reunião enquanto vídeo + PDF do chat estiverem pendentes.
- Participantes comuns continuam podendo sair normalmente.
