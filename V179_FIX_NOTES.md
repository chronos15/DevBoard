# TaskBoard V179 — Aprovação flutuante no Acompanhamento

## O que mudou

O card **Aguardando sua aprovação** deixou de ficar preso logo abaixo do título da subatividade.

Agora ele fica **flutuante e sobreposto no topo da área do Acompanhamento**, permanecendo visível mesmo quando o usuário está no meio ou no fim de um histórico longo.

### Mantido
- mesmo design do card atual;
- botão **X** para devolver a subatividade para **Backlog**;
- botão **✓** para aprovar e concluir;
- mesma regra de permissão: o card só aparece para o usuário indicado como aprovador;
- nenhuma alteração no banco ou no fluxo de notificações.

### UI/UX
- o card usa fundo do tema com transparência e `backdrop-blur` para continuar legível sem parecer uma barra fixa pesada;
- fica centralizado dentro da coluna do Acompanhamento;
- não ocupa espaço permanente no fluxo do histórico, pois é sobreposto;
- acompanha corretamente larguras menores e maiores da coluna central.
