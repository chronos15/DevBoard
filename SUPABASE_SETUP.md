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
SUPABASE_SERVICE_ROLE_KEY=SEU_SERVICE_ROLE_SECRET
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

Em produção, `NEXT_PUBLIC_APP_URL` deve ser o domínio HTTPS real.

> `SUPABASE_SERVICE_ROLE_KEY` é usada **somente no servidor** pela tela **Configurações > Equipe** para criar usuários já confirmados. Configure-a também nas variáveis privadas da Vercel/servidor e **nunca** use o prefixo `NEXT_PUBLIC_` nessa chave.

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

## Migration 020 — diagnóstico administrativo de segurança

Depois da 019, execute:

```text
supabase/migrations/020_devboard_security_health.sql
```

A 020 adiciona o RPC administrativo `devboard_security_health()`, usado em **Configurações → Segurança**. O diagnóstico é somente leitura e não retorna chaves/tokens. Ele verifica RLS nas tabelas críticas, grants diretos para `anon`, `SECURITY DEFINER` sem `search_path`, policies do Storage, publicação Realtime e o modelo de segredo do Devboard Agent.

A função só pode ser executada por usuário autenticado com role `admin`.

## Migration 021 — baseline Git/SVN da subatividade

Depois da 020, execute:

```text
supabase/migrations/021_devboard_vcs_task_baseline.sql
```

Quando um developer inicia uma subatividade que possui projeto local vinculado, o Devboard tenta registrar automaticamente branch/revisão/repositório inicial em `developer_vcs_task_baselines`. Isso permite comparar a origem da sessão de desenvolvimento com commits/revisões associados posteriormente, sem enviar código-fonte ou credenciais locais ao Supabase.

Depois execute novamente:

```text
supabase/verify_backend.sql
```

## Migration 022 — detecção de ausência do developer

Depois da 021, execute:

```text
supabase/migrations/022_devboard_developer_idle_adjustment.sql
```

A 022 adiciona as preferências pessoais de detecção de ausência do Windows (`idle_detection_enabled` e `idle_threshold_minutes`) e o RPC `developer_adjust_active_session(...)`. O RPC só permite que o próprio responsável developer ajuste a sessão ativa: ele pode desconsiderar o período ausente mantendo o timer em execução ou desconsiderar e pausar. O Agent informa somente duração de inatividade/bloqueio; não captura teclas, textos, arquivos ou conteúdo de tela.

### 024 · Hotfix do Controle de horas (RLS)

Se após aplicar a migration `023_devboard_hours_reporting.sql` aparecer:

```text
permission denied for function is_workspace_admin
```

aplique também:

```text
supabase/migrations/024_devboard_hours_reporting_rls_fix.sql
```

A primeira versão da policy de `work_sessions` chamava `is_workspace_admin(...)` diretamente. O backend base do Devboard revoga `EXECUTE` de helpers internos para evitar que o cliente consulte funções privilegiadas arbitrariamente. A migration 024 troca a policy por `can_read_work_session(subactivity_id, user_id)`, um helper `SECURITY DEFINER` restrito ao próprio `auth.uid()`.

Depois execute novamente:

```text
supabase/verify_backend.sql
```

## Migration 043 — Solicitações / Protocolo AQS → DEV

Para ativar a nova área **Solicitações**, aplique:

```text
supabase/migrations/043_devboard_service_requests_protocol.sql
```

A migration cria uma camada de protocolo independente de Projetos/Atividades/Subatividades: solicitações, participantes, mensagens, eventos, anexos privados e fluxo AQS → DEV → AQS → build. Quando o AQS encaminha ao DEV, a solicitação pode apenas **vincular** um projeto e uma atividade já existentes; nenhuma atividade ou subatividade é criada, excluída ou tem status alterado por esse módulo.

Também é criado o bucket privado `devboard-request-media`, o campo `request_id` nas notificações e as políticas/RPCs necessárias para que solicitante, AQS, DEV e Admin tenham visibilidade compatível com o protocolo.

## Migration 044 — Unidades e recursos externos das Solicitações

Para a evolução do módulo **Solicitações**, aplique também:

```text
supabase/migrations/044_devboard_request_units_external_resources.sql
```

Ela adiciona:

- cadastro de **Unidades** administrado apenas por usuários `admin`;
- vínculo estruturado da Solicitação com a unidade escolhida, preservando o nome histórico;
- suporte a **URL FTP/FTPS/HTTP/HTTPS** para vídeo/evidência, banco de dados e certificado digital, evitando upload de arquivos grandes;
- validações de tamanho dos campos da Solicitação também no banco;
- políticas/RPCs necessários para criar, ativar, desativar e excluir unidades sem alterar solicitações antigas.

A Ordem de Serviço em PDF continua sendo anexada ao protocolo. Vídeo/evidência, banco e certificado podem ser arquivo ou referência externa conforme a necessidade.

## Migration 045 — Identidade visual das Unidades de Solicitações

Depois da 044, aplique:

```text
supabase/migrations/045_devboard_request_unit_visuals.sql
```

A 045 adiciona ícone e imagem personalizada opcional às Unidades usadas pela central de Solicitações. Também cria o bucket público `devboard-request-unit-icons` (máx. 3 MB; JPG, PNG, WEBP ou GIF) e restringe criação/alteração da identidade visual a administradores do workspace.

A mudança é apenas de identidade/navegação visual da central de Solicitações e não altera Projetos, Atividades ou Subatividades.

## Migration 046 — Solicitações vinculadas ao trabalho técnico

Depois da 045, aplique:

```text
supabase/migrations/046_devboard_service_request_activity_sync.sql
```

A 046 integra o protocolo de Solicitações ao fluxo real de Projetos/Atividades/Subatividades. Ao encaminhar uma solicitação ao DEV, o Devboard cria ou vincula a atividade técnica, registra execução/pausas/comentários/evidências no histórico da solicitação e protege a conclusão das subatividades vinculadas: elas precisam obrigatoriamente passar pela **Análise AQS** antes de serem concluídas.

## Migration 047 — Solicitações internas sem OS/anexos obrigatórios

Depois da 046, aplique:

```text
supabase/migrations/047_devboard_internal_service_requests.sql
```

A 047 adiciona o tipo **Interno**. Para esse tipo, o usuário não precisa informar número de OS nem anexar OS em PDF, vídeo/evidência ou banco. Quando nenhuma OS é informada, o banco gera apenas uma referência interna única (`INT-...`) para preservar busca, notificações, vínculos e histórico sem fingir que existe uma OS externa.

Anexos continuam disponíveis de forma opcional. Se a solicitação interna for encaminhada ao DEV, a atividade técnica usa a referência interna no título e mantém o mesmo fluxo obrigatório de validação AQS da migration 046.


## Migration 048 — Reuniões contextuais por atividade

Depois da 047, aplique:

```text
supabase/migrations/048_devboard_context_meetings.sql
```

A 048 conecta o modo de reunião do Chat ao **Acompanhamento**, **Solicitações** e **Análise AQS**. Cada atividade passa a ter um único grupo persistente de reunião, reutilizado nas chamadas futuras. O grupo usa o nome atual da atividade e inclui os responsáveis/participantes envolvidos no trabalho, no protocolo e na validação AQS.

Ao iniciar uma chamada pelo contexto da atividade, o Devboard abre o Chat já na sala de vídeo e registra no histórico técnico **Ligação de reunião iniciada**. Quando a sala termina, o banco registra automaticamente a duração e os usuários que efetivamente participaram. Se a atividade estiver vinculada a uma Solicitação, os mesmos eventos também entram no histórico do protocolo.

Reuniões iniciadas depois diretamente pelo mesmo grupo do Chat continuam vinculadas à atividade e usam os participantes atuais do trabalho, sem criar um novo grupo para o mesmo tópico.

## Migration 049 — Somente usuários com e-mail confirmado

Depois da 048, aplique:

```text
supabase/migrations/049_devboard_confirmed_members_only.sql
```

A 049 corrige o ciclo de cadastro do Supabase Auth para que uma conta **não apareça na equipe, nos seletores de Projeto ou nas demais regras do workspace antes de confirmar o e-mail**. Novos cadastros continuam recebendo o registro de perfil, porém `workspace_members.active` nasce como `false` enquanto `email_confirmed_at` estiver vazio.

Quando o usuário confirma o link enviado pelo Supabase, o trigger ativa automaticamente a associação ao workspace. Cadastros antigos ainda não confirmados também são desativados durante a migration. Como os helpers `current_workspace_id`, `is_workspace_member` e `is_workspace_admin` já exigem `workspace_members.active = true`, a mesma regra passa a proteger o backend inteiro sem duplicar permissões.

Uma conta que for desativada manualmente depois de já estar confirmada **não é reativada** por simples alterações de nome/e-mail no Auth.


## Migration 050 — Duplicidade de OS com retorno amigável

Depois da 049, aplique:

```text
supabase/migrations/050_devboard_friendly_service_request_duplicates.sql
```

A 050 introduziu o tratamento amigável de duplicidade de OS e protegeu a concorrência no banco. **A regra de unicidade desta etapa é substituída pela migration 051**, que passa a considerar a Unidade selecionada.

A aplicação também passou a converter falhas de autenticação, permissão, rede, armazenamento e inconsistências do banco em mensagens adequadas para a interface. Os detalhes técnicos continuam sendo registrados no console para diagnóstico, mas não devem ser exibidos ao usuário final.

## Migration 051 — Numeração de OS independente por Unidade

Depois da 050, aplique:

```text
supabase/migrations/051_devboard_service_request_order_per_unit.sql
```

A 051 corrige a regra de unicidade das Solicitações: o número da OS passa a ser único **dentro de cada Unidade**, e não no workspace inteiro. Assim, por exemplo, a OS `123` pode existir em `Multsoft.com` e também em outra Unidade, mas não pode ser cadastrada duas vezes na mesma Unidade.

A criação grava `unit_id` junto com a Solicitação antes de validar a duplicidade, mantendo a proteção também quando duas pessoas tentam protocolar a mesma OS ao mesmo tempo. A interface usa a mesma regra ao avisar sobre uma OS já cadastrada e oferece acesso ao protocolo existente somente quando a duplicidade pertence à Unidade selecionada.

## Migration 052 — Compartilhamento PWA e anexos por Atividade

Para habilitar o recebimento de evidências pelo menu **Compartilhar** do Android e permitir que o destino seja Projeto, Atividade ou Subatividade, execute depois da 051:

```text
supabase/migrations/052_devboard_pwa_share_activity_attachments.sql
```

A migration é incremental. Ela adiciona `attachments.activity_id`, preserva os anexos já existentes de Projeto/Subatividade, cria a RPC `add_activity_attachment` e atualiza a leitura/ativação de anexos para reconhecer o novo destino.

> Aplique a migration 052 **antes** de publicar o front-end desta versão, pois a consulta de projetos passa a carregar também os anexos vinculados às atividades.

No Android, o recurso depende do Devboard instalado como **PWA pelo Chrome**. O `share_target` do manifesto registra o Devboard no seletor nativo de compartilhamento e o service worker mantém o arquivo temporariamente no aparelho até o usuário escolher o destino.

## Migration 053 — Compartilhamento por acompanhamento e notificações

Depois da 052, aplique:

```text
supabase/migrations/053_devboard_share_following_notifications.sql
```

A 053 restringe o compartilhamento de não-admin aos contextos realmente acompanhados e amplia as notificações de mensagens, anexos e alterações de status feitas por outros usuários.

## Migration 054 — Reunião persistente com chat

Depois da 053, aplique:

```text
supabase/migrations/054_devboard_persistent_meeting_chat.sql
```

A 054 persiste o contexto de origem da reunião, participantes extras e reações do chat, permitindo minimizar a chamada sem desmontar a sessão WebRTC.

## Migration 055 — Gravação automática de reunião

Depois da 054, aplique:

```text
supabase/migrations/055_devboard_automatic_meeting_recording.sql
```

A 055 adiciona o controle da gravação automática e o vínculo da gravação com o tópico de origem da reunião.

## Migration 056 — Interface Focada por usuário

Depois da 055, aplique:

```text
supabase/migrations/056_devboard_focused_interface_mode.sql
```

A 056 adiciona `user_preferences.interface_mode`, com `complete` como padrão e `focused` como alternativa. A preferência pertence somente ao usuário autenticado e não modifica roles, permissões, projetos ou regras de negócio.

No **Modo Focado**, o Devboard reutiliza os mesmos dados e componentes do modo completo, mas reduz a navegação, prioriza Acompanhamento/Minhas tarefas/Solicitações e apresenta uma Home orientada ao que exige atenção. O usuário pode alternar entre os modos em **Configurações → Aparência** ou pelo atalho de interface no topo da aplicação.

## Migration 065 — Imagem de projeto / Storage / Admin

Depois da 064, ou diretamente em ambientes que ainda não receberam a correção anterior, aplique:

```text
supabase/migrations/065_taskboard_project_images_storage_final_fix.sql
```

A 065 é intencionalmente **autocontida** para os pontos críticos. Ela recria as policies do bucket `devboard-project-icons`, valida o caminho do upload por um helper `SECURITY DEFINER` restrito ao usuário atual e reafirma `set_project_visual`/`update_project` sem exigir que um Admin esteja em `project_members`.

Ela também reafirma a policy de INSERT do bucket `cadence-attachments`, mantendo `is_workspace_admin(uuid,uuid)` fechado para chamadas diretas do cliente.

> Se a troca de imagem continuar mostrando apenas `VM... reportAllChanges ... startTime` no Console, esse stack é de instrumentação de Web Vitals do navegador/ambiente e não identifica falha do Supabase. Para confirmar falha real de upload, procure no mesmo momento uma linha `[TaskBoard/Supabase] StorageApiError` ou uma requisição `storage/v1/object/...` com status 4xx.

## V75 — remoção definitiva da imagem do projeto

Depois da migration 065, execute também:

```sql
supabase/migrations/066_taskboard_project_image_removal_fix.sql
```

A 066 corrige a exclusão de imagens de projeto enviadas originalmente por outro usuário e torna o estado "Remover imagem" persistente durante a edição.

## Migration 067 — DEV observador no Acompanhamento / Modo Resumido

Depois da 066, execute:

```text
supabase/migrations/067_taskboard_simplified_observer_access.sql
```

A 067 **não cria nem altera tabelas**. Ela separa a permissão de **visualizar** da permissão de **alterar** uma subatividade. Administradores continuam com acesso total. Desenvolvedores do workspace passam a enxergar todas as subatividades no Acompanhamento; quando não são responsáveis nem participantes, entram como **observadores**.

O observador pode consultar a conversa e o checklist, reagir aos itens do histórico e adicionar um comentário somente pelo comando **Responder**. Ele não pode enviar uma mensagem nova, anexar arquivos, usar menções, alterar checklist, membros, status, cronômetro ou iniciar reunião daquela subatividade. Essas limitações são aplicadas na interface e, nos pontos de escrita do Acompanhamento, também no backend.

A migration mantém `can_access_followup_subactivity()` intacta para não ampliar por acidente as permissões de edição existentes. O novo helper `can_view_followup_subactivity()` é usado apenas onde a leitura/reação do observador precisa ser permitida.

## Migration 068 — Entrega de versão + indicador “digitando...”

Depois da 067, execute:

```text
supabase/migrations/068_taskboard_release_handoff_and_typing.sql
```

A 068 **não cria nem altera tabelas**. Ela adiciona apenas a RPC `set_subactivity_status_with_release_info`, reutilizando a validação oficial de `set_subactivity_status` e registrando no histórico os dados opcionais de entrega quando uma subatividade é enviada para **AQS** ou concluída diretamente: caminho da pasta, número da versão, build e nome do ZIP. Se nenhum desses dados for informado, o avanço continua permitido e o histórico registra explicitamente que a entrega foi feita sem essas informações.

O arquivo ZIP é enviado pelo fluxo de anexos já existente da subatividade e mantém o limite de 50 MB. Por isso, nenhuma coluna ou bucket novo é necessário.

O indicador **“digitando...”** desta versão usa **Supabase Realtime Presence** e não depende da migration para persistência. Ele compartilha o mesmo escopo entre Acompanhamento/Subatividade e Análise AQS, além de funcionar nos canais/conversas e nas Solicitações. O estado é efêmero: não é salvo no banco nem gera histórico.

## Migration 069 — Reunião por subatividade + menções coletivas

Depois da 068, execute:

```text
supabase/migrations/069_taskboard_context_meeting_logs_and_group_mentions.sql
```

A 069 corrige o escopo dos logs de reunião. Reuniões iniciadas em uma subatividade passam a registrar também o `meeting-id` e a `subactivity-id`, permitindo que o Acompanhamento e a Análise AQS mostrem **somente** os logs pertencentes à subatividade aberta. Logs antigos sem essa identificação deixam de ser exibidos dentro de uma subatividade para não vazar histórico de outro tópico; eles continuam disponíveis no histórico geral do projeto.

Também amplia as menções para `@here`, `@todos`, `@desenvolvedores`, `@aqs` e `@admin`. O front-end resolve cada alias em usuários ativos do workspace e o backend preserva as regras existentes: menções em Acompanhamento/Subatividade associam o usuário ao projeto/subatividade; se houver análise AQS ativa, ele também entra como participante da análise; em Solicitações entra como participante do protocolo; e, no chat da reunião, a menção chama o usuário e o associa ao contexto da reunião. `@here` usa as pessoas presentes/online no contexto quando essa informação está disponível.

A migration eleva o limite técnico de metadados de menção do Chat para 250 destinatários para que `@todos` funcione em workspaces maiores. Nenhuma role é alterada e uma menção coletiva não transforma automaticamente ninguém em responsável principal da atividade/subatividade.

## Migration 070 — @todos somente para participantes existentes

Depois da 069, execute:

```text
supabase/migrations/070_taskboard_todos_scope_existing_participants.sql
```

A 070 corrige a semântica de `@todos`: ele passa a notificar **somente usuários que já pertencem ao tópico/contexto aberto**. `@todos` e `@here` são tratados como broadcasts e não criam novos vínculos em projeto, subatividade, análise AQS ou solicitação. O `@here` continua sendo resolvido pelo Presence para quem está presente/online no contexto.

Menções individuais e os grupos `@desenvolvedores`, `@aqs` e `@admin` continuam com a regra da V80 e podem associar os usuários ao contexto quando permitido. Se uma mesma pessoa estiver no `@todos` e também for mencionada diretamente/por equipe na mesma mensagem, prevalece a menção explícita e a associação continua sendo permitida.

A migration não cria nem altera tabelas/colunas. Participantes que tenham sido adicionados indevidamente por um `@todos` enviado **antes** desta correção não são removidos automaticamente, porque o histórico atual não permite distinguir com segurança esse vínculo de uma associação legítima feita por menção individual ou ação manual.

## Migration 071 — Brainstorm por subatividade + criação rápida de projeto

Depois da 070, execute:

```text
supabase/migrations/071_taskboard_brainstorm_mode_and_quick_project.sql
```

A 071 adiciona o estado persistente `brainstorm_mode` às subatividades. O modo só pode permanecer ativo enquanto a subatividade estiver **Em execução**; ao pausar, concluir, cancelar ou enviar para AQS, o banco o desativa automaticamente.

Enquanto o Brainstorm estiver ativo, tanto a proteção de inatividade do navegador/PWA quanto o **TaskBoard Agent para Windows** ignoram a pausa automática de 5 minutos. O cronômetro continua contando normalmente. Ativar e encerrar o Brainstorm gera registros no histórico do projeto e o encerramento por mudança de status também é registrado.

A RPC `set_subactivity_brainstorm` mantém a permissão existente: Administrador pode operar qualquer subatividade; Desenvolvedor só pode alternar o Brainstorm da própria subatividade em execução. O atalho global é **Ctrl + Shift + B** e alterna o estado da subatividade atualmente em execução do usuário.

A criação rápida de projeto no primeiro item da barra do **Modo Resumido** reutiliza a RPC `create_project` já existente. Portanto, não há uma nova estrutura para esse recurso: o botão aparece somente para **Administrador** e **Desenvolvedor**, que já são os perfis autorizados pelo backend a criar projetos.

## Migration 072 — data de entrega opcional nos projetos

Depois da 071, execute:

```text
supabase/migrations/072_taskboard_optional_project_due_date.sql
```

A 072 remove o `NOT NULL` de `projects.due_date` e atualiza as RPCs `create_project` e `update_project` para aceitar projeto sem prazo. A regra de permissão vigente é preservada: Administrador pode editar qualquer projeto do workspace e Desenvolvedor precisa estar integrado ao projeto para editar.

O frontend envia `NULL` quando a data não é informada. Agenda, cards e detalhes passam a ignorar projetos sem prazo ou exibir **Sem prazo**, evitando `Invalid Date`.

O novo quadro **Equipe agora** não usa tabela nova. Tela atual, presença e última interação são publicados de forma efêmera no Supabase Realtime Presence e não são persistidos no banco.

## Migration 073 — Anotações por atividade + Presence resiliente

Depois da 072, execute:

```text
supabase/migrations/073_taskboard_activity_notes_and_realtime_presence.sql
```

A 073 cria `activity_notes`, com leitura para membros do workspace e escrita por RPC. Administradores e Desenvolvedores podem anotar atividades; integrantes de projeto mantêm a permissão estrutural já existente. Cada anotação pode ser transformada em uma subatividade em **Backlog**, escolhendo responsável e estimativa. A anotação original permanece registrada e passa a apontar para a subatividade criada.

A estrutura antiga `subactivity_checklist_items` é mantida para compatibilidade, mas a interface e os novos logs passam a usar o nome **Anotações**. Nenhum dado histórico é apagado.

O conserto de **Equipe agora** é de frontend/Realtime: o cliente recria automaticamente o canal Presence após timeout, fechamento, suspensão do PWA ou troca de rede e não depende mais exclusivamente de um único evento `sync` para sair de “Atualizando status…”.

## Migration 074 — edição administrativa de subatividade

Depois da 073, execute:

```text
supabase/migrations/074_taskboard_admin_subactivity_edit_and_team_expand.sql
```

A 074 adiciona a RPC `update_subactivity_admin`, usada exclusivamente por **Administradores** para alterar os dados principais de uma subatividade já existente: descrição, estimativa, tipo e responsável. A permissão é validada no backend pelo papel do usuário no workspace; Desenvolvedor, AQS, Suporte e Membro não conseguem executar a edição administrativa mesmo que tentem chamar a RPC diretamente.

Quando o responsável é alterado, o novo usuário é associado à subatividade e recebe uma notificação. Para preservar a sessão de trabalho e o cronômetro, a troca de responsável é bloqueada enquanto a subatividade estiver **Em execução**; pause-a antes de trocar. Toda alteração gera o log **Subatividade atualizada** com os campos modificados.

As mudanças de formato `HH:mm`, o título **Equipe**, a expansão inline dos usuários e a equalização dos três cards do painel são somente de frontend e não criam estruturas adicionais no banco.

## Migration 075 — mensagem e anexos agrupados no Acompanhamento

Depois da 074, execute:

```text
supabase/migrations/075_taskboard_followup_message_attachment_groups.sql
```

A 075 adiciona o campo opcional `message_group_id` em `subactivity_comments` e `attachments`. Ele é usado somente para manter a relação visual entre o texto e os arquivos enviados na mesma ação do compositor do Acompanhamento, inclusive depois de atualizar a página.

As RPCs antigas não têm a assinatura alterada. A migration adiciona apenas `set_followup_comment_message_group` e `set_followup_attachment_message_group`, preservando compatibilidade com clientes/PWA ainda em cache durante o deploy.

O novo modo **Horas efetivadas** do quadro `Equipe` é exibido para Administradores e não cria tabela: ele usa `work_sessions` já existente (cuja RLS já permite ao Admin consultar a equipe) e calcula as sessões do dia atual no frontend, incluindo a sessão em andamento.

## Migration 076 — gestão de equipe, jornada diária e moderação de reunião

Depois da 075, execute:

```text
supabase/migrations/076_taskboard_team_schedule_and_meeting_controls.sql
```

A 076 adiciona em `workspace_members` os campos `work_days` e `daily_hours`, usados como a jornada configurada de cada colaborador. Em **Configurações > Equipe**, Administradores podem definir os dias trabalhados, a quantidade de horas por dia, inativar/reativar usuários e consultar também contas inativas. A meta do quadro **Equipe > Horas efetivadas** deixa de usar 08:00 fixas e passa a respeitar essa jornada; em dias não selecionados o colaborador aparece como **Folga**.

A criação direta de usuários pela tela de Equipe usa a rota server-side `/api/admin/users` e a Supabase Admin API. Para isso, configure no ambiente de produção:

```text
SUPABASE_SERVICE_ROLE_KEY=seu_service_role_secret
```

Essa chave é **privada** e nunca deve usar o prefixo `NEXT_PUBLIC_`. O usuário criado por um Admin entra com e-mail já confirmado (`email_confirm: true`), portanto não recebe e-mail de confirmação. Nome, perfil de acesso e jornada são vinculados ao workspace na mesma operação.

Inativar um colaborador não apaga a conta nem o histórico: apenas define `workspace_members.active = false`, bloqueando o acesso ao workspace pelas regras já existentes. A própria conta do Administrador logado não pode ser inativada por essa tela e o último Admin ativo do workspace é protegido.

A migration também adiciona as RPCs de moderação da reunião. Administradores, o criador da reunião e os responsáveis pela subatividade/atividade de origem podem remover outro participante da call. O encerramento da reunião foi desacoplado do upload da gravação: a chamada é finalizada imediatamente e o navegador responsável continua preparando e enviando o arquivo em segundo plano enquanto a aplicação permanecer aberta.
