# Devboard — configuração do Supabase

Esta versão remove os mocks de negócio e usa o Supabase como backend da aplicação.

## O que está no backend

A migration `supabase/migrations/001_devboard_full_backend.sql` provisiona:

- Supabase Auth integrado ao perfil da aplicação;
- 21 tabelas de domínio;
- RLS em todas as tabelas acessadas pelo cliente;
- RPCs transacionais para regras críticas;
- Storage privado para anexos (`cadence-attachments`);
- Storage público somente para avatares (`cadence-avatars`);
- Realtime para sincronização de projetos, horas, notificações, chat e reuniões;
- canais Realtime privados para sinalização WebRTC;
- logs de auditoria com usuário/data/hora;
- notificações persistentes;
- sessões reais de trabalho (`work_sessions`) para histórico de horas.

## 1. Criar/configurar o projeto Supabase

Crie um projeto no Supabase e copie, em **Connect / API Keys**:

- Project URL;
- Publishable key (`sb_publishable_...`).

Nunca coloque `service_role`/secret key no front-end.

## 2. Executar a migration

### Opção A — SQL Editor

1. Abra **SQL Editor** no Supabase.
2. Crie uma nova query.
3. Cole o conteúdo de `supabase/migrations/001_devboard_full_backend.sql`.
4. Execute a query inteira.
5. Depois execute `supabase/migrations/002_devboard_call_invites.sql`.
6. Execute `supabase/migrations/003_devboard_chat_audio.sql`.
7. Execute `supabase/migrations/004_devboard_chat_media_attachments.sql`.
8. Execute `supabase/migrations/005_devboard_roles_aqs_topics.sql`.
9. Execute `supabase/migrations/006_devboard_notify_all_aqs.sql`.
10. Execute `supabase/migrations/007_devboard_new_accounts_member.sql`.
11. Execute `supabase/migrations/008_devboard_deeplinks_chat_mentions.sql`.
12. Execute `supabase/migrations/009_devboard_chat_history_profile_actions.sql`.
13. Execute `supabase/migrations/010_devboard_chat_local_delete.sql`.
14. Execute `supabase/migrations/011_devboard_chat_personal_history_cutoff.sql`.
15. Execute `supabase/migrations/012_devboard_chat_message_replies.sql`.
16. Execute `supabase/migrations/013_devboard_chat_realtime_presence.sql`.
17. Execute `supabase/migrations/014_devboard_profile_avatar_color_remove.sql`.
18. Execute `supabase/migrations/015_devboard_developer_panel.sql`.
19. Execute `supabase/migrations/016_devboard_developer_multiple_ides_projects.sql`.
20. Execute `supabase/migrations/017_devboard_developer_cockpit_automation.sql`.
21. As migrations são incrementais e devem ser aplicadas nessa ordem.

Depois execute `supabase/verify_backend.sql`. Ele interrompe com erro se estruturas essenciais não tiverem sido criadas.

### Opção B — Supabase CLI

Com o projeto vinculado:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

> **Compatibilidade:** os IDs internos dos buckets e algumas policies ainda usam o prefixo `cadence-` porque podem já existir em bancos provisionados anteriormente. Eles não aparecem na identidade visual e foram preservados para evitar quebrar anexos/avatares existentes.

## Identidade Devboard

O projeto usa o ícone oficial em `public/devboard-icon.svg` e versões PNG 32/64/180/192/512. Ele é aplicado como favicon, Apple Touch Icon, manifesto/PWA, notificações do navegador, sidebar e login.

## 3. Configurar variáveis da aplicação

Copie `.env.example` para `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SEU_TOKEN
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

Em produção, `NEXT_PUBLIC_APP_URL` deve ser o domínio HTTPS real.

## 4. Auth / URLs

Em **Authentication > URL Configuration** configure o Site URL e permita, no mínimo:

Desenvolvimento:

```text
http://localhost:3000/auth/callback
```

Produção:

```text
https://SEU-DOMINIO/auth/callback
```

Cadastro por e-mail, confirmação de e-mail, OAuth e recuperação de senha usam o callback SSR/PKCE.

### Google OAuth

Só ative:

```env
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true
```

após configurar o provider Google no Supabase Auth e as URLs OAuth correspondentes. Caso contrário, o botão Google permanece oculto.

## 5. Usuários e permissões

Esta fase do produto usa **um workspace Devboard**.

- todo novo usuário cadastrado entra como `member`;
- os demais entram inicialmente como `member`;
- administradores podem alterar a role da equipe em Configurações;
- roles disponíveis: `admin`, `developer`, `aqs`, `support`, `member`;
- Administradores, Desenvolvedores, AQS e Suporte são definidos posteriormente por um Administrador;
- se o sistema for interno, depois de cadastrar/provisionar a equipe, desabilite cadastro público no Supabase Auth.

## 5.1. Matriz de roles

| Role | Projetos | Execução DEV | Análise AQS | Tópicos | Administração |
|---|---|---|---|---|---|
| **Administrador** | Total | Qualquer atividade/subatividade | Total | Total | Total |
| **Desenvolvedor** | Total | Somente próprias atividades/subatividades | Visualização da fila | Pode analisar/encaminhar | Não altera roles |
| **AQS** | Sem edição estrutural | Não executa tarefas DEV | Avalia apenas fila AQS | Pode analisar/encaminhar | Não |
| **Suporte** | Sem edição estrutural | Não | Não | Abre e acompanha tópicos; vê fila de tópicos | Não |
| **Membro** | Sem edição estrutural | Não | Não | Abre e acompanha os próprios tópicos | Não |

### Fluxo AQS

1. O Desenvolvedor conclui sua implementação e move a subatividade para **Aguardando AQS**.
2. O banco cria uma revisão em `aqs_reviews` e notifica AQS/Administradores.
3. Em **Análise**, AQS/Admin move para **Avaliando**.
4. **Concluída** aprova a revisão e conclui a subatividade original.
5. **Revogada** devolve a subatividade para **Aguardando**, marca `needs_attention`, grava o motivo e notifica o Desenvolvedor responsável.
6. O AQS pode anexar evidências e comentar usando os mesmos componentes de anexos/comentários já usados nas subatividades.

### Fluxo de Tópicos

- Suporte e Membro podem abrir tópicos com número da ordem, descrição e evidências (imagem, vídeo, documento etc.).
- Administrador, Desenvolvedor e AQS podem iniciar análise, revogar ou usar **Enviar Atividade**.
- Ao enviar para desenvolvimento, o usuário escolhe o projeto e opcionalmente um Desenvolvedor. A atividade é criada no projeto com a ordem no título e as notificações são disparadas para administradores, Desenvolvedor associado e solicitante.
- Evidências ficam no bucket privado `devboard-topic-media`, com limite de 50 MB por arquivo.

## 6. Regras garantidas pelo banco

As regras abaixo não dependem apenas da UI:

- um usuário só pode ter **uma subatividade em execução**;
- iniciar uma segunda subatividade do mesmo responsável pausa a anterior;
- sessões de trabalho são abertas/fechadas no PostgreSQL;
- membro comum só altera suas próprias subatividades;
- `Concluída` e `Cancelada` são estados terminais para membro comum;
- administrador pode reabrir um estado terminal;
- atividade só pode ser excluída quando não possui subatividades;
- versionamento com pendências exige confirmação explícita (`allow_pending`);
- anexos não possuem operação de exclusão na API da aplicação: ficam Ativos/Inativos;
- comentários e alterações de anexos entram no log do projeto;
- conversas diretas usam uma chave canônica/única para evitar duplicidade em chamadas concorrentes;
- somente criador do grupo ou administrador gerencia membros do grupo;
- somente criador da reunião ou administrador encerra a reunião para todos.
- convidado de chamada fica em `pending` e **não entra no WebRTC** até clicar em Atender/Entrar;
- ao recusar, o membro passa para `declined`;
- ao sair, o membro passa para `left`;
- quando o último usuário sai, `leave_meeting` encerra a reunião atomicamente no PostgreSQL;
- um heartbeat protege o estado da sala e o reconciliador via Supabase Cron encerra reuniões abandonadas após fechamento abrupto do navegador.

## 7. Anexos / Storage

O bucket `cadence-attachments` é privado e usa URLs assinadas para leitura.

Caminho físico:

```text
<workspace>/<project>/<uploader>/<arquivo>
```

O cliente pode remover fisicamente um upload apenas enquanto a gravação do metadado falhou. Depois que o anexo existe na tabela `attachments`, a policy bloqueia exclusão física pela aplicação.

Arquivos textuais/SQL colados podem ser armazenados como conteúdo textual; arquivos binários são enviados ao Storage.

Limites configurados:

- anexos: 50 MB por arquivo;
- avatar: 5 MB e MIME de imagem.

## 8. Realtime

A migration adiciona as tabelas de uso geral à publication `supabase_realtime` para atualizar a UI entre usuários/dispositivos.

As salas WebRTC usam canal privado:

```text
meeting:<meeting_uuid>
```

A policy de `realtime.messages` só permite Broadcast/Presence para participantes de uma reunião ativa cujo status em `meeting_members` seja `joined`.

O Chat usa um segundo canal privado por workspace para presença de usuários:

```text
devboard-presence:<workspace_uuid>
```

A migration `013_devboard_chat_realtime_presence.sql` autoriza esse canal somente para membros ativos do workspace. O cliente publica apenas o estado efêmero do Supabase Presence (`user_id`, `online_since` e um identificador da conexão), sem gravar heartbeats periódicos no PostgreSQL. Assim, entrada/saída é recebida por WebSocket e o tempo atual online é calculado no cliente.

O Supabase faz a sinalização. A mídia continua WebRTC.

### TURN obrigatório para confiabilidade entre dispositivos/redes

STUN permite descobrir rotas diretas, mas não consegue atravessar todos os NATs/CGNATs/firewalls. O Devboard agora tenta obter credenciais TURN de curta duração pela Edge Function `webrtc-ice-servers`. Se a função não estiver implantada/configurada, a chamada continua com STUN público, porém a própria sala mostra o aviso **Somente STUN**.

A implementação fornecida usa o serviço TURN gerenciado da Cloudflare, sem servidor próprio. O segredo fica somente na Supabase Edge Function; nunca coloque token TURN em `NEXT_PUBLIC_*`.

1. Crie uma TURN key no Cloudflare Realtime TURN.
2. Grave os segredos no Supabase:

```bash
supabase secrets set CLOUDFLARE_TURN_KEY_ID=SEU_KEY_ID
supabase secrets set CLOUDFLARE_TURN_API_TOKEN=SEU_API_TOKEN
supabase secrets set CLOUDFLARE_TURN_TTL=86400
```

3. Faça deploy da função:

```bash
supabase functions deploy webrtc-ice-servers
```

No Windows, você também pode usar o script incluído:

```powershell
.\scripts\deploy_webrtc_turn.ps1 -ProjectRef "SEU_PROJECT_REF" -TurnKeyId "SEU_KEY_ID" -TurnApiToken "SEU_API_TOKEN"
```

4. Abra uma reunião e confira em **Áudio e vídeo > Conectividade WebRTC** se aparece **TURN disponível**. Em uma conexão que precisou de relay, a rota do participante aparece como **TURN relay**.

O cliente também chama `supabase.realtime.setAuth()` antes de entrar no canal privado, mantém candidatos ICE recebidos antes do SDP em fila e executa ICE restart quando a conexão falha/desconecta.

## 9. Notificações de chamadas no navegador

O Devboard registra `public/devboard-sw.js` como Service Worker e usa a Notifications API do navegador.

- quando uma chamada é criada, o Supabase grava uma notificação `meeting-invite`;
- o destinatário recebe o modal interno **Atender / Recusar**;
- se ele concedeu permissão ao Chrome, recebe também a notificação nativa do navegador enquanto o Devboard estiver aberto ou em segundo plano;
- clicar na notificação apenas abre o Devboard; a entrada na sala continua exigindo ação explícita do usuário;
- notificações do navegador exigem HTTPS em produção (localhost funciona em desenvolvimento).

A notificação nativa desta etapa não é Web Push com o navegador totalmente fechado. Para isso, futuramente pode-se adicionar Push API + VAPID/Edge Function sem alterar o fluxo de convite do banco.

## 10. Dependências

A versão está preparada para:

```text
@supabase/ssr ^0.12.4
@supabase/supabase-js ^2.112.3
```

O `pnpm-lock.yaml` antigo foi removido porque não continha as dependências Supabase e faria instalações com `--frozen-lockfile` falharem. Depois de restaurar acesso ao registry, gere um lock novo com seu gerenciador escolhido.

Por exemplo:

```bash
npm install
npm run build
npm run dev
```

ou, se a equipe usa pnpm:

```bash
pnpm install
pnpm build
pnpm dev
```

## 11. Checklist pós-migration

1. Execute `supabase/verify_backend.sql`.
2. Crie um novo usuário e confirme que aparece inicialmente como Membro.
3. Crie um segundo usuário e confirme que aparece como Membro.
4. Em duas sessões/navegadores, atribua um projeto/atividade/subatividade e confirme a notificação em tempo real.
5. Inicie uma subatividade e confira uma linha aberta em `work_sessions`.
6. Pause-a e confira `ended_at` e `duration_seconds` preenchidos.
7. Tente iniciar duas subatividades do mesmo responsável; somente uma deve permanecer `in-progress`.
8. Envie um anexo e confirme que existe em Storage + `attachments`.
9. Marque o anexo como inativo; ele deve permanecer armazenado.
10. Teste comentário e confira o registro em `project_logs`.
11. Abra duas sessões no Chat e valide mensagens em tempo real.
12. Configure/deploy a Edge Function TURN e confirme **TURN disponível** dentro da sala.
13. Crie uma chamada entre dois usuários: o destinatário deve permanecer fora da sala até clicar em **Atender**.
14. Teste desktop em Wi‑Fi ↔ celular em 4G/5G; vídeo e áudio devem atingir `connected`. Se a rede exigir relay, confirme **TURN relay** no diagnóstico.
15. Ligue/desligue a câmera depois da conexão e confirme que o vídeo aparece no outro dispositivo sem nova entrada na sala.
16. Fale dos dois lados; se o Chrome bloquear autoplay no mobile, deve aparecer o botão **Ativar áudio** e o clique deve liberar a reprodução.
17. Desative Wi‑Fi do celular durante a chamada, aguarde a troca para rede móvel e confirme tentativa automática de ICE restart.
18. Recuse uma chamada e confirme `meeting_members.status = 'declined'`.
19. Atenda e depois saia com os dois usuários; confirme que `meetings.ended_at` foi preenchido ao sair o último participante.
20. Conceda permissão de notificação no Chrome e valide a notificação nativa de chamada.
21. Como Admin, atribua as roles Desenvolvedor, AQS, Suporte e Membro em Configurações.
22. Como Desenvolvedor, mova uma subatividade própria para **Aguardando AQS** e confirme a criação em `aqs_reviews`.
23. Como AQS, inicie a análise, anexe uma evidência e conclua; confirme que a subatividade original fica `done`.
24. Repita e revogue a análise; confirme que a subatividade volta para `waiting` com alerta e que o Desenvolvedor recebe notificação.
25. Como Suporte/Membro, abra um Tópico com ordem + evidência e confirme Storage em `devboard-topic-media`.
26. Como AQS/Desenvolvedor/Admin, encaminhe o Tópico com **Enviar Atividade** e confirme criação + notificações.
27. Rode **Database > Security Advisor** e **Performance Advisor** no Dashboard antes de produção.

## 12. Observação sobre build neste pacote

O código foi validado estaticamente no ambiente de geração, mas o registry npm não estava acessível (`EAI_AGAIN registry.npmjs.org`). Por isso não foi possível instalar as novas dependências e executar um `next build` real aqui. O lock antigo foi removido para não mascarar esse problema. Faça `npm install && npm run build` no ambiente com internet antes do deploy.

## Chat · mensagens de áudio

Se o backend Devboard já está provisionado com as migrations anteriores, execute também:

```text
supabase/migrations/003_devboard_chat_audio.sql
```

Essa migration é incremental: mantém as mensagens existentes, adiciona os metadados de áudio em `chat_messages`, cria a RPC `send_chat_audio_message` e o bucket privado `devboard-chat-media`.

O áudio do chat nunca é público. Somente usuários que pertencem à conversa podem gerar URL assinada/leitura pelo Storage.

## Chat · mídias e anexos

Depois da migration de áudio, execute também:

```text
supabase/migrations/004_devboard_chat_media_attachments.sql
```

A migration 004 é incremental e não remove mensagens existentes. Ela amplia `chat_messages` para mensagens de mídia/anexo, mantém o bucket `devboard-chat-media` privado e aumenta o limite desse bucket para 50 MB por arquivo. O acesso continua restrito aos membros da conversa pelas policies existentes de Storage/RLS.

No Chat, o botão de clipe permite múltiplos arquivos. `Ctrl+V` intercepta arquivos/imagens disponíveis no clipboard e abre o preview; texto puro continua sendo colado no campo da mensagem normalmente. Nenhum arquivo é enviado antes da confirmação no preview.


## Roles, AQS e Tópicos · migration 005

Depois da migration 004, execute:

```text
supabase/migrations/005_devboard_roles_aqs_topics.sql
```

Ela é incremental e não remove projetos, atividades, subatividades, mensagens ou anexos existentes. Adiciona:

- roles `developer`, `aqs` e `support`;
- status `waiting-aqs` / **Aguardando AQS**;
- `aqs_reviews`;
- `support_topics`;
- `topic_attachments`;
- alerta de retorno AQS em `subactivities`;
- RPCs com validação de role no PostgreSQL;
- bucket privado `devboard-topic-media`;
- RLS e Realtime das novas filas.

Após aplicar a 005, rode novamente `supabase/verify_backend.sql`.

## 008 · Links diretos e menções no Chat

Depois das migrations anteriores, execute:

```text
supabase/migrations/008_devboard_deeplinks_chat_mentions.sql
```

A 008 é incremental e não remove mensagens nem notificações existentes. Ela:

- adiciona `mentions` em `chat_messages` para persistir menções selecionadas no autocomplete;
- adiciona `conversation_id` em `notifications` para abrir a conversa exata ao clicar numa notificação de menção;
- substitui `send_chat_message` pela versão que valida menções em grupos e notifica cada usuário marcado uma única vez.

Os links copiados de atividade/subatividade usam as rotas já existentes do Devboard e não exigem alteração no banco.

## 009 · Histórico paginado e ações de conversa

Depois da 008, execute:

```text
supabase/migrations/009_devboard_chat_history_profile_actions.sql
```

A 009 é incremental e preserva os chats existentes. Ela:

- adiciona índice para buscar as mensagens mais recentes e carregar o histórico para trás com menor custo;
- cria `delete_direct_conversation`; na migration 010 este RPC é redefinido para remover a conversa somente da lista do usuário atual, sem apagar histórico ou mídia;
- adiciona uma policy de `DELETE` no bucket do chat para que o front-end remova as mídias pela Storage API antes de apagar a conversa;
- atualiza `delete_chat_group` para exigir que as mídias já tenham sido removidas com segurança antes da exclusão do grupo;
- cria `leave_chat_group`, removendo apenas o participante que saiu e transferindo a gestão quando o criador deixa um grupo ainda ativo.

No front-end, a lista de conversas passa a buscar apenas a última mensagem de cada chat. Ao abrir uma conversa, são carregadas as 20 mensagens mais recentes; ao subir pelo histórico, novas páginas de 20 mensagens são requisitadas sem deslocar a posição visual do usuário.

Depois de aplicar a 009, execute novamente `supabase/verify_backend.sql`.



## 010 · Remoção local de conversas individuais

Depois da 009, execute:

```text
supabase/migrations/010_devboard_chat_local_delete.sql
```

A 010 altera a semântica da ação de exclusão em chats individuais sem destruir dados:

- adiciona `chat_members.hidden_at`, mantendo o participante vinculado ao chat, mas permitindo ocultá-lo somente para ele;
- redefine `delete_direct_conversation` para apenas marcar a conversa como oculta para o usuário atual;
- o outro participante continua vendo a conversa, mensagens e mídias normalmente;
- ao iniciar novamente a conversa pelo perfil, ela volta apenas para quem a reabriu;
- ao chegar qualquer nova mensagem em uma conversa individual, o chat reaparece automaticamente para quem o havia removido, evitando perda de mensagens;
- restringe a exclusão física de mídias do bucket aos grupos que realmente forem excluídos. Conversas individuais não removem arquivos do Storage.

Depois de aplicar a 010, execute novamente `supabase/verify_backend.sql`.

## 011 · Corte individual do histórico do chat

Depois da 010, execute:

```text
supabase/migrations/011_devboard_chat_personal_history_cutoff.sql
```

A 011 corrige o comportamento de reabrir uma conversa individual depois de removê-la da própria lista:

- adiciona `chat_members.cleared_at`, um corte de histórico independente para cada participante;
- ao remover uma conversa individual, `hidden_at` e `cleared_at` recebem o instante da remoção;
- ao iniciar novamente uma conversa com o mesmo usuário, a conversa física é reutilizada, mas **as mensagens anteriores ao corte não voltam para quem removeu**;
- o outro participante continua vendo normalmente todo o histórico dele;
- se uma nova mensagem chegar depois da remoção, o chat reaparece e o usuário vê somente as mensagens posteriores ao seu corte;
- paginação, refresh, Realtime e acesso direto à tabela respeitam a mesma regra por RLS;
- mídias pertencentes a mensagens anteriores ao corte também deixam de ser legíveis por quem removeu, sem apagar o arquivo do outro participante.

A migration faz backfill de `cleared_at = hidden_at` para conversas que ainda estavam ocultas ao ser aplicada. Se uma conversa já havia sido removida e reaberta **antes** da 011, o instante antigo não existe mais no banco; nesse caso, remova essa conversa uma vez após aplicar a 011 para criar o novo corte.

Depois de aplicar a 011, execute novamente `supabase/verify_backend.sql`.

## 012 · Respostas a mensagens no chat

Depois da 011, execute:

```text
supabase/migrations/012_devboard_chat_message_replies.sql
```

A 012 adiciona resposta persistente a qualquer mensagem visível da conversa:

- adiciona `chat_messages.reply_to_message_id` com referência segura para a mensagem original;
- preserva a assinatura antiga de `send_chat_message` para compatibilidade e adiciona uma assinatura nova com a referência de reply;
- valida no backend que a mensagem respondida pertence à mesma conversa e está disponível para o usuário;
- permite que o front mostre autor e prévia da mensagem respondida mesmo depois de recarregar a página;
- adiciona índice parcial para leitura eficiente das referências.

O front-end possui fallback de leitura para um rollout seguro: se ele for publicado antes da 012, o chat continua abrindo e enviando mensagens comuns normalmente; somente o envio de respostas depende da migration nova.

Depois de aplicar a 012, execute novamente `supabase/verify_backend.sql`.

## Perfil · cor do avatar e remoção de foto (migration 014)

Depois das migrations anteriores, execute também:

```text
supabase/migrations/014_devboard_profile_avatar_color_remove.sql
```

A migration é incremental e não remove perfis existentes. Ela amplia `update_my_profile` para permitir que cada usuário escolha a própria cor de avatar e remova explicitamente a foto atual. A remoção física do arquivo antigo continua sendo feita pela Storage API do cliente, respeitando a policy que limita cada usuário à própria pasta no bucket `cadence-avatars`.

Depois, execute novamente:

```text
supabase/verify_backend.sql
```


## 015 · Painel pessoal do Desenvolvedor

Depois da 014, execute:

```text
supabase/migrations/015_devboard_developer_panel.sql
```

A 015 cria um módulo **exclusivo da role `developer`** e sem vínculo obrigatório com projetos. Ela adiciona:

- `developer_settings`: expediente, intervalo, dias úteis, hidratação, foco, música e IDE preferida;
- `developer_notes`: anotações privadas do desenvolvedor;
- `developer_water_logs`: registros diários de hidratação;
- RLS restrita a `auth.uid()` **e** role `developer` — administrador não herda acesso;
- Realtime nas três tabelas para sincronização entre abas/dispositivos;
- avisos de expediente/hidratação no navegador são disparados pelo front quando a permissão de Notification estiver concedida.

Depois, execute novamente:

```text
supabase/verify_backend.sql
```

## Painel Dev — múltiplas IDEs e projetos locais (migration 016)

Depois da migration 015, aplique também:

```sql
supabase/migrations/016_devboard_developer_multiple_ides_projects.sql
```

Ela cria `developer_ides` e `developer_local_projects`, mantendo RLS exclusivo da própria role `developer` e do próprio `auth.uid()`.

O caminho absoluto da pasta **não é salvo no Supabase**. A pasta escolhida pelo botão "Escolher pasta" usa a File System Access API e o `FileSystemDirectoryHandle` fica somente no IndexedDB daquele navegador/dispositivo. O banco sincroniza apenas nome do projeto, nome visível da pasta e a IDE associada.


## Painel Dev — cockpit, automações e contextos (migration 017)

Depois da 016, execute:

```text
supabase/migrations/017_devboard_developer_cockpit_automation.sql
```

A 017 adiciona as preferências de automação do developer e a tabela `developer_contexts`. Cada contexto pode vincular um projeto do Devboard a um projeto local/IDE e a uma playlist. O módulo usa isso para continuar o último trabalho, iniciar foco ao ligar um timer, abrir a IDE/música do contexto quando habilitado, detectar cronômetros possivelmente esquecidos, preparar o encerramento do expediente e montar o resumo diário pelas `work_sessions` já existentes.

Os contextos seguem a mesma regra do Painel Dev: somente o próprio `auth.uid()` com role `developer` pode consultar ou alterar os registros.

Depois execute novamente `supabase/verify_backend.sql`.

## Migration 018 — Devboard Agent para Windows

Execute `supabase/migrations/018_devboard_windows_agent.sql` depois da migration 017.

Ela cria o registro seguro dos agentes Windows e as RPCs usadas para:

- gerar um instalador individual para o developer autenticado;
- receber heartbeat do agente sem depender da sessão do navegador;
- exibir no Painel Dev se o agente está online, qual versão está instalada e se o atalho global foi registrado.

O segredo do agente não possui SELECT direto e nunca é retornado pelo painel. O instalador é gerado em `/api/dev-agent/installer` e recebe um token aleatório próprio daquela instalação.

> O agente não é instalado como Windows Service tradicional. Ele inicia automaticamente na sessão do usuário via HKCU porque precisa receber hotkeys globais e abrir IDEs/janelas na área de trabalho. Windows Services executam fora da sessão interativa e não são adequados para esse papel.

## Migration 019 — Git/SVN local vinculado às tarefas

Depois da migration 018, execute:

```text
supabase/migrations/019_devboard_developer_vcs.sql
```

A 019 adiciona o vínculo opcional entre `developer_local_projects` e um projeto real do Devboard (`devboard_project_id`) e cria `developer_vcs_changes` para guardar **somente os metadados de commits/revisões que o developer associar a uma subatividade**.

O código-fonte, credenciais Git/SVN e working copy continuam exclusivamente no computador. Git, SVN e TortoiseSVN são acessados pelo Devboard Agent em loopback. A escrita/alteração dos vínculos continua exclusiva do próprio developer. Quando um commit/revisão é associado a uma subatividade, os membros daquele workspace podem ler somente esse metadado; assim a AQS consegue conferir exatamente quais alterações foram vinculadas sem receber acesso à pasta local, credenciais ou código-fonte.

Depois execute novamente:

```text
supabase/verify_backend.sql
```
