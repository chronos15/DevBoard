# TaskBoard V134 — Compartilhamento múltiplo, filtro por responsável e recepção PWA resiliente

Base: V133.

## Compartilhamento para um ou mais destinos
- A tela `/compartilhar` agora aceita múltiplos destinos simultaneamente.
- Tocar em um destino marca; tocar novamente desmarca.
- O rodapé mostra o destino quando há apenas um ou a quantidade de destinos quando há vários.
- O conteúdo é preparado uma única vez e enviado sequencialmente, reduzindo pico de memória/rede no mobile.
- Em falha parcial, os destinos concluídos não são repetidos: ficam selecionados somente os que precisam de nova tentativa.
- Frequentes continuam sendo atualizados para todos os destinos enviados com sucesso.

## Busca `#responsável`
- Quando a pesquisa começa com `#`, o modo de busca muda para responsáveis de subatividade.
- Exemplos: `#mau`, `#joao`, `#mau #joao`.
- Vários `#nomes` funcionam como alternativas: aparecem subatividades cujo responsável corresponde a qualquer um dos termos.
- A busca usa exclusivamente `subactivity.assigneeId`; menções/participantes não contam como responsável.
- A pesquisa ignora acentos e também permite combinar texto comum depois dos `#nomes`.

## Nomenclatura
- Na tela de compartilhamento, o rótulo visual `Acompanhamento` foi alterado para `Subatividade`.
- O tipo interno continua `subactivity`; nenhuma rota, permissão ou persistência foi renomeada.

## Agrupamento por projeto
- Adicionado botão `Por projeto` em Todos os destinos.
- O modo atual em lista continua disponível e é o padrão, preservando o comportamento existente.
- Quando ativado, Projeto / Atividade / Subatividade / AQS e Solicitações vinculadas são agrupados visualmente pelo projeto.
- Solicitações sem projeto ficam em grupo próprio.

## Correção de compartilhamentos com “0 itens”
Foram tratados três cenários que podiam perder o binário recebido:

1. O Service Worker passa a ser registrado globalmente no AppShell, mesmo quando notificações web não estão disponíveis/ativadas.
2. O share target do Service Worker coleta qualquer entrada binária do `FormData`, não apenas o campo literal `files`.
3. Foi criado um inbox privado de fallback no Supabase. Caso o POST de compartilhamento chegue ao servidor antes do Service Worker controlar a instalação, o arquivo é preservado temporariamente no bucket `taskboard-share-inbox` e recuperado em `/compartilhar`.

O cache local também tenta recuperar entradas `file/N` diretamente quando metadados de uma instalação antiga vierem incompletos.

## Migration obrigatória
Execute após a `088`:

`supabase/migrations/089_taskboard_share_inbox_fallback.sql`

Ela cria apenas o bucket privado temporário `taskboard-share-inbox` e policies para que cada usuário leia/escreva/remova somente arquivos sob o próprio `auth.uid()`.

## Arquivos alterados
- `app/compartilhar/page.tsx`
- `app/share-target/route.ts`
- `components/app-shell.tsx`
- `lib/taskboard-share-cache.ts`
- `public/devboard-sw.js`
- `supabase/migrations/089_taskboard_share_inbox_fallback.sql`
- `V134_FIX_NOTES.md`
