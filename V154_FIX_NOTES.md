# TaskBoard V154 — Header do dashboard da atividade

## Correção
- O header do modal de detalhes da atividade não é mais encolhido pelo layout flex quando o título ocupa várias linhas.
- Removido o recorte interno (`overflow-hidden`) do header.
- Header passa a usar `shrink-0`, preservando toda a altura necessária para o título.
- Título usa quebra agressiva segura (`overflow-wrap:anywhere`) para textos muito longos.
- Aumentado o padding superior, inferior e lateral do cabeçalho.
- Ajustado espaçamento entre projeto/cliente, título, contexto e badges.
- Zerado o `gap` herdado do DialogContent para impedir espaço/layout inesperado entre header e conteúdo.
- Corpo do dashboard continua com scroll independente, começando somente após a altura real do header.

Não há migration nova.
