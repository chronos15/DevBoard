# TaskBoard V131 — Compartilhamento PWA simplificado

## Objetivo

Redesenhar a tela `/compartilhar` usada pelo Web Share Target do PWA para reduzir a quantidade de passos no Android/iOS e aproximar o fluxo da experiência do WhatsApp.

## Alterações

- O fluxo antigo baseado em guias + selects encadeados (Projeto → Atividade → Subatividade) foi substituído por uma lista única de destinos.
- Campo de busca fixo no topo para localizar rapidamente projeto, atividade, subatividade/acompanhamento, solicitação ou análise AQS.
- Destinos exibidos como linhas grandes e touch-friendly com ícone/avatar, título, contexto e tipo.
- Seção **Frequentes** baseada no histórico local de compartilhamentos do próprio dispositivo/usuário.
- Seção **Recentes** priorizando destinos com atividade mais recente.
- Filtros rápidos: Todos, Acompanhamentos, Solicitações, AQS, Atividades e Projetos.
- O conteúdo recebido fica em um bloco compacto e recolhível, deixando a escolha do destino como foco principal da tela.
- Rodapé fixo mostra o destino escolhido e um botão único **Enviar**.
- O histórico de destinos frequentes usa `localStorage`; nenhuma tabela/RPC nova é necessária.
- As regras existentes de permissão continuam sendo aplicadas antes de montar a lista de destinos.
- O envio continua utilizando exatamente as mesmas funções de anexos já existentes para projetos, atividades, subatividades, solicitações e AQS.

## Banco de dados

Nenhuma migration nova.
