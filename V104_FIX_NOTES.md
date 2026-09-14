# TaskBoard V104 — links clicáveis em conteúdos e mensagens

## Objetivo
Padronizar URLs inseridas por usuários para que sejam reconhecidas visualmente como links e abertas fora da página atual, sem quebrar menções ou o texto existente.

## Alterações

### Renderizador central de texto
- Novo `components/text/rich-message-text.tsx`.
- Reconhece URLs iniciadas por `http://`, `https://`, `ftp://`, `ftps://` e `www.`.
- Links são exibidos em azul, sublinhados e com destaque no hover.
- `www.` é normalizado para `https://` no clique.
- Links externos usam `target="_blank"` e `rel="noopener noreferrer"`.
- Pontuação comum no fim da frase não passa a fazer parte do endereço.
- Menções de usuário/projeto continuam destacadas; menções de projeto continuam navegáveis no TaskBoard.

### Locais abrangidos
- Acompanhamento de projetos/atividades/subatividades.
- Resumo inline do acompanhamento da subatividade.
- Solicitações: descrição principal e mensagens do histórico.
- Análise AQS.
- Chat.
- Chat da reunião.
- Diálogos de comentários.
- Anotações da atividade.

## Banco de dados
- Nenhuma migration nova.
- Nenhuma alteração de tabela/RLS/RPC.

## Compatibilidade
A mudança é somente de apresentação no frontend. O conteúdo continua sendo salvo como texto puro no banco, evitando alteração de dados existentes e permitindo que mensagens antigas com URLs também passem a aparecer como links automaticamente.
