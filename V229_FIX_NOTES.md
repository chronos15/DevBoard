# TaskBoard V229 — Contexto da reunião e exportação PDF da subatividade

## 1. Reunião com Atividade + Subatividade/Tópico

- O cabeçalho do modal da reunião não fica mais limitado ao título da atividade quando existe contexto mais específico.
- Reuniões iniciadas por uma subatividade/AQS passam a exibir **Atividade · Subatividade**.
- Reuniões iniciadas por uma solicitação contextual passam a exibir **Atividade · Solicitação**.
- O título contextual fica limitado visualmente a **2 linhas** para não deformar o modal em desktop, mobile ou PWA.
- O mesmo título contextual é usado no PDF do chat e no nome dos artefatos da reunião quando o contexto já estiver carregado.
- Nenhuma alteração foi feita em ICE, WebRTC, Presence ou no fluxo de finalização em segundo plano.

## 2. Exportar PDF da subatividade

- Adicionada a opção **Exportar PDF** no menu `...` da subatividade, imediatamente após **Anotações**.
- Disponível no Acompanhamento completo e simplificado por compartilhar o mesmo menu da subatividade.
- O PDF é gerado diretamente no navegador e baixado como arquivo `.pdf`, sem depender da caixa de impressão do sistema.
- Formato A4 profissional em preto e branco, contendo:
  - projeto, atividade, número e título da subatividade;
  - status, responsável, horas trabalhadas/estimadas, O.S., versão/build e datas;
  - anotações atuais da subatividade, incluindo estado concluído/pendente;
  - mensagens em ordem cronológica;
  - respostas a mensagens;
  - logs/registros da subatividade;
  - apontamentos de trabalho;
  - anexos e seus metadados;
  - conteúdo de arquivos textuais quando disponível;
  - imagens incorporadas ao próprio PDF.
- Imagens são redimensionadas e convertidas para tons de cinza antes da incorporação, reduzindo o tamanho e mantendo o padrão de impressão.
- Arquivos de imagem/texto no Storage recebem URL assinada somente durante a exportação. Nenhuma permissão ou regra de banco foi alterada.
- Itens ainda pendentes de envio não entram no PDF; somente histórico já persistido é exportado.
- Não é necessária migration de banco para esta versão.

## 3. Versão

- Versão embutida atualizada para **V229**.
- Service Worker e registradores atualizados para `v=229`.
