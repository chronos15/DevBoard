# TaskBoard V85 — Drag & Drop de anexos

## Implementado

- Acompanhamento / modo resumido:
  - Ao arrastar arquivos sobre a tela com uma subatividade selecionada, exibe overlay em tela inteira no estilo Discord.
  - O destino é identificado no overlay (`Enviar para #...`).
  - Ao soltar, os arquivos entram no preview já existente do composer e só são enviados quando o usuário confirmar o envio.
  - Mantidas as regras atuais de limite e processamento de vídeo.
  - O modo observador continua sem permissão para anexar.

- Solicitações:
  - Overlay de drag & drop em tela inteira.
  - Arquivos soltos entram no preview do composer da solicitação.
  - Mantido limite atual de 200 MB por arquivo.
  - O arquivo não é enviado automaticamente: permanece no preview até o envio da mensagem.

- Análise AQS:
  - Overlay de drag & drop em tela inteira para a análise selecionada.
  - Ao soltar, abre automaticamente o modal de Evidências já com o lote carregado no preview.
  - O usuário pode revisar, cancelar ou confirmar antes do upload.

- Projetos > Atividades > Subatividades (Lista e Kanban):
  - Ao arrastar um arquivo sobre uma subatividade editável, o TaskBoard identifica aquela subatividade como destino.
  - Exibe overlay em tela inteira e, ao soltar, abre o modal de Arquivos com o preview pronto.
  - O drag de arquivos não interfere no drag interno do Kanban para mudança de status.
  - Não altera permissões: somente quem já pode gerenciar a subatividade recebe esse drop target.

## Componente compartilhado

Foi adicionado `components/attachments/file-drop-overlay.tsx`, responsável por:

- detectar apenas arraste de arquivos do sistema operacional;
- não conflitar com o drag & drop interno do Kanban;
- mostrar overlay em portal acima de toda a interface;
- trabalhar com destinos globais ou escopados a uma subatividade;
- evitar múltiplos destinos concorrentes durante o mesmo gesto de arraste.

## Banco de dados

Nenhuma migration nova é necessária. A V85 utiliza os mesmos buckets, RPCs, limites e regras de anexos já existentes.
