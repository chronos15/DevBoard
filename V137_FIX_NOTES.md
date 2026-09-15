# TaskBoard V137 — Timeline ancorada e mídia estável

## Corrigido

- Ao abrir uma subatividade com imagens/vídeos, a mídia não exibe mais o pequeno player preto antes dos metadados.
- Imagens e vídeos usam estado de carregamento neutro e só aparecem quando as dimensões/metadados estão prontos.
- Enquanto o usuário estiver no fim da conversa, alterações de altura causadas por mídia, typing indicator ou novas mensagens mantêm a timeline ancorada no final.
- Ao subir manualmente no histórico, o TaskBoard não força mais o scroll de volta para baixo.
- Quando chegam novas mensagens enquanto o usuário está lendo mensagens anteriores, aparece um botão flutuante de seta para descer até a última mensagem.
- O botão desaparece automaticamente quando o usuário volta ao final.
- Regra aplicada em Acompanhamento, Análise AQS, Solicitações, Chat e Chat de reunião.
- Chat e Chat de reunião também ressincronizam o fim da timeline quando imagens/vídeos terminam de carregar, desde que o usuário permaneça ancorado.

## Banco de dados

Nenhuma migration nova.
