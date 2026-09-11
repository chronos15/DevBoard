# TaskBoard V99 — Edição de mensagens, imagens proporcionais e scroll do Acompanhamento

## Edição de mensagens

Agora é possível editar o texto de mensagens enviadas pelo próprio usuário em:

- Acompanhamento da subatividade;
- Solicitações;
- Análise AQS;
- Chat e chat da reunião.

A ação **Editar mensagem** aparece somente para o autor da mensagem. A edição é feita no próprio local da mensagem, com **Enter para salvar**, **Shift+Enter para quebrar linha** e **Esc para cancelar**. Após uma alteração, a mensagem recebe a indicação **(editada)**.

A restrição não depende apenas da interface: a migration V99 valida novamente a autoria no banco. Nem mesmo um Administrador pode usar as novas RPCs para alterar a mensagem de outro usuário.

Mensagens automáticas de comando do chat permanecem imutáveis. Áudios e anexos também não são modificados pela edição de texto.

## Imagens com proporção natural

As imagens publicadas em Acompanhamento, Solicitações, Análise AQS e Chat deixaram de usar um retângulo fixo.

- imagem pequena permanece visualmente pequena;
- imagem maior cresce respeitando sua proporção original;
- largura e altura possuem limite máximo para não dominar a conversa;
- o clique continua abrindo o visualizador interno com zoom/pan/pinça.

O Chat mantém o limite compacto que já possuía; Acompanhamento, Solicitações e Análise AQS usam um limite maior adequado ao painel central.

## Scroll do Acompanhamento

O bloqueio temporário usado para manter a abertura da subatividade na última mensagem agora é cancelado assim que o usuário demonstra intenção de navegar pelo histórico (mouse, toque ou ponteiro).

Com isso, URLs assinadas, previews e imagens que terminarem de carregar depois não empurram novamente a conversa para o final. É possível começar a rolar para cima imediatamente, sem esperar todos os anexos terminarem de carregar.

## Banco de dados

Execute depois da migration 080:

`supabase/migrations/081_taskboard_message_editing.sql`

A migration adiciona `edited_at` em:

- `subactivity_comments`;
- `service_request_messages`;
- `chat_messages`.

Também cria as RPCs:

- `edit_subactivity_comment`;
- `edit_service_request_message`;
- `edit_chat_message`.

Todas exigem sessão autenticada e conferem a autoria da mensagem no backend antes do `UPDATE`.
