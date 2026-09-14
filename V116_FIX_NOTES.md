# TaskBoard V116 — Equipe por responsável + preview/download de anexos

## Ajustes realizados

### Dashboard > Equipe
- A lista expandida de cada usuário agora considera **somente subatividades em que o usuário é o responsável (`assigneeId`)**.
- Participação no tópico, comentários, anexos, menções e associação indireta à atividade não fazem mais a subatividade aparecer no card daquele usuário.
- A ordenação pelas últimas alterações continua a mesma, porém aplicada apenas às subatividades realmente atribuídas ao usuário.

### Anexos em Acompanhamento, Análise AQS, Solicitações e Chat
- Criado tratamento central de tipos de arquivo para reconhecer extensões textuais mesmo em anexos antigos cujo `kind` tenha sido salvo como `other`.
- Preview textual para `.txt`, `.sql`, `.md`, `.json`, `.xml`, `.csv`, `.log`, YAML, arquivos de configuração e diversos scripts/códigos (`.js`, `.ts`, `.tsx`, `.py`, `.sh`, `.ps1`, `.bat`, `.pas`, `.dart`, `.java`, `.kt`, `.go`, `.rs`, `.c/.cpp`, `.cs`, etc.).
- Arquivos textuais enviados pelo Acompanhamento, que são persistidos em `text_content` sem objeto no Storage, agora podem ser **visualizados e baixados** normalmente.
- PDF, áudio e vídeo possuem preview quando há URL disponível.
- Formatos sem preview nativo continuam preservados e agora exibem ações claras de **Abrir** e/ou **Baixar** quando o arquivo está disponível.
- Solicitações e Análise AQS passam a usar o mesmo comportamento para anexos não-imagem.
- Chat e chat de reunião inferem o tipo também pelo nome/extensão, melhorando compatibilidade com anexos antigos e arquivos colados.

## Arquivos principais
- `components/dashboard/workspace-activity-status.tsx`
- `components/attachments/file-preview-dialog.tsx` (novo)
- `lib/attachment-preview.ts` (novo)
- `components/project-detail/project-follow-up.tsx`
- `components/analysis/analysis-view.tsx`
- `components/requests/request-detail.tsx`
- `components/chat/chat-media-message.tsx`
- `components/chat/chat-attachment-preview-dialog.tsx`
- `components/attachments/attachment-dialog.tsx`
- `lib/supabase/helpers.ts`

## Banco de dados
- Não há migration nova na V116.

## Validação
- Validação sintática executada nos 192 arquivos TypeScript/TSX: sem erros.
