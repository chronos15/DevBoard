# TaskBoard V79 — Checklist, dashboard da atividade e sidebar do Modo Resumido

## Alterações

### 1. Logs de checklist abrem o checklist
- Registros com tipo `checklist-*` no histórico do Acompanhamento agora abrem diretamente o modal **Anotações e checklist** da subatividade atual.
- Logs comuns continuam abrindo o detalhamento de log normalmente.
- Reações e resposta aos registros continuam disponíveis.

### 2. Dashboard da atividade no Modo Completo
- Na tela **Acompanhamento** do Modo Completo, o nome da atividade no cabeçalho recebeu o botão de informações (`i`).
- O botão reutiliza o mesmo `ActivityInfoDialog` existente no Modo Resumido.
- Nenhuma estrutura de atividade/subatividade foi alterada.

### 3. Scroll do dashboard da atividade no mobile
- O `ActivityInfoDialog` agora usa layout flexível e altura baseada em `100dvh` no mobile.
- O conteúdo interno ganhou área de rolagem vertical própria, `overscroll-contain`, `touch-pan-y` e suporte ao momentum scroll do iOS.
- O cabeçalho permanece visível enquanto o conteúdo do dashboard rola.

### 4. Sidebar do Modo Resumido
- O bloco superior da barra lateral passou a ser uma única área rolável: botão expandir/recolher + projetos + Canais + Solicitações + Análise AQS + Mensagens.
- Foram removidos o limite de altura e o scroll isolado que existiam apenas na lista de projetos.
- A partir de **Notificações** permanece fixo na parte inferior: Notificações, Subatividades recentes, Tema, Configurações e Sair.

## Banco de dados
Esta versão não exige migration. São apenas ajustes de interface/navegação no frontend.
