# TaskBoard V91 — mensagem com anexo + horas efetivadas da Equipe

## Mensagem + anexo no Acompanhamento

- Quando o usuário escreve uma mensagem e adiciona um ou mais arquivos no mesmo envio, o TaskBoard passa a exibir tudo como **uma única publicação**, no padrão do Discord.
- O texto aparece primeiro e os anexos/previews ficam logo abaixo, dentro do mesmo bloco visual e com o mesmo autor/horário.
- O agrupamento é persistente: depois de atualizar a página os anexos continuam associados à mensagem correta.
- Mensagens sem anexo e anexos enviados sem texto continuam usando o comportamento anterior.
- Envios otimistas também ficam agrupados durante upload/processamento de vídeo, inclusive com retry em caso de falha.
- Ações de abrir/baixar, copiar link e excluir o anexo continuam disponíveis.

## Equipe · horas efetivadas

- Para **Administradores**, foi adicionado um **icon button** no cabeçalho do quadro `Equipe` para alternar entre:
  - presença/status em tempo real;
  - **horas efetivadas hoje**.
- O quadro de efetivação mostra todos os colaboradores em cards responsivos.
- Cada card possui um gauge circular com o total trabalhado no dia e percentual visual sobre uma referência de **08:00**.
- O cálculo usa `work_sessions`: soma somente o tempo efetivamente registrado em sessões de subatividades no dia atual.
- Sessões ainda abertas são atualizadas em tempo real pelo relógio do frontend, sem aguardar a sessão ser encerrada.
- Se o colaborador estiver executando uma subatividade, o card mostra o item atual e permite abrir diretamente o Acompanhamento.

## Banco

A V91 usa a migration 075, que adiciona `message_group_id` em comentários e anexos e duas RPCs pequenas para associar os registros criados no mesmo envio sem alterar as assinaturas antigas de upload/comentário.
