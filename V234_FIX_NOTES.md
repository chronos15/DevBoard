# TaskBoard V234 — Agent: remoção definitiva do domínio legado

## Correções

- TaskBoard Agent atualizado de `0.6.0` para `0.6.1`.
- Qualquer `app_url` legado apontando para `https://swdevboard.vercel.app` é migrado em memória para `https://taskboard.softworksistema.com.br` ao iniciar o Agent.
- O menu da bandeja agora mostra **Abrir TaskBoard**.
- `Painel Dev` abre `https://taskboard.softworksistema.com.br/dev#dev-session`.
- `Diagnóstico do Agent` abre `https://taskboard.softworksistema.com.br/dev#integration-windows`.
- O Agent não reutiliza mais uma PWA antiga chamada **Devboard**. Isso evita que o Chromium use o app-id do domínio Vercel antigo e ignore a URL atual.
- Somente atalhos/PWAs atuais com nome **TaskBoard** podem ser reutilizados. Sem uma PWA atual instalada, o Agent abre diretamente o domínio atual em `--app=`.
- A rota de download do instalador também converte explicitamente qualquer host legado para o domínio oficial.
- Template Windows recompilado com as correções acima.

## Compatibilidade

- O executável instalado continua usando `%LOCALAPPDATA%\Devboard\Agent\DevboardAgent.exe` e os registros existentes para não quebrar autostart, protocolo, vínculo de projetos locais ou atualização automática.
- Nenhuma migration de banco é necessária.
