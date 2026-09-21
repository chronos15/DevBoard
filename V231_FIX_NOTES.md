# TaskBoard V231 — Card de aprovação recolhível por gesto

## Acompanhamento da subatividade

- O card flutuante **“Aguardando sua aprovação”** continua aparecendo normalmente ao abrir uma subatividade pendente da aprovação do usuário atual.
- No mobile, o card pode ser recolhido temporariamente com swipe para **esquerda**, **direita** ou **cima**.
- O gesto ignora os botões de aprovar/reprovar para não interferir nas ações existentes.
- O card volta automaticamente quando o usuário volta a movimentar o mural por toque/scroll (ou roda do mouse no desktop).
- Há uma pequena janela de proteção após o swipe para impedir que o mesmo gesto que recolheu o card o faça reaparecer imediatamente.
- Se houver uma reunião ativa sobreposta, ela ocupa o topo normalmente enquanto o card de aprovação estiver recolhido, sem deixar espaço vazio.
- Ao trocar de subatividade, mudar o status ou mudar o aprovador, o estado temporário de recolhimento é zerado e o card volta ao comportamento padrão.

## Estrutura

- Nenhuma migration.
- Nenhuma mudança em aprovação, Realtime, WebRTC, logs ou permissões.
- Versão embutida, fallback e Service Worker atualizados para **V231**.
