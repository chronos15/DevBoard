# V117 — Preview textual inline no estilo Discord

## Ajustes

- Arquivos textuais deixam de abrir preview em modal em:
  - Acompanhamento de subatividade;
  - Análise AQS;
  - Solicitações;
  - Chat e chat de reunião.
- `txt`, `sql`, scripts, logs, JSON, XML, CSV, Markdown e demais formatos reconhecidos como texto passam a renderizar o conteúdo diretamente na mensagem.
- O card inline possui:
  - conteúdo monoespaçado;
  - altura limitada para não alongar mensagens grandes;
  - expandir/recolher;
  - copiar conteúdo;
  - abrir em nova aba quando houver URL;
  - baixar arquivo;
  - nome e tamanho no rodapé.
- Arquivos salvos apenas em `text_content` aparecem imediatamente e também podem ser baixados.
- Arquivos textuais armazenados no Supabase Storage carregam o conteúdo inline por URL assinada.
- Em caso de falha no preview, o card deixa de ficar preso em `Carregando preview...` e apresenta fallback com ações disponíveis.
- Imagens e vídeos preservam o comportamento atual.
- PDFs, áudio e formatos sem preview textual continuam usando o fluxo existente de visualização/abertura e download.

## Banco de dados

- Nenhuma migration nova.
