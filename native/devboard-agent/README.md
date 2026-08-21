# Devboard Agent para Windows

Agente nativo pequeno usado pelo Painel Dev para:

- iniciar automaticamente com a sessão do Windows;
- registrar `Ctrl + Shift + 7` como atalho global;
- usar automaticamente um hook global como fallback quando outro aplicativo já reservou o atalho;
- abrir o Devboard diretamente em `/dev#dev-session`, mesmo com o navegador fechado;
- priorizar automaticamente a PWA do Devboard que já estiver instalada no Windows, seja Chrome ou Edge;
- se houver mais de uma PWA instalada, usar a instalação detectada mais recente, sem preferência fixa por navegador;
- enviar heartbeat para o Supabase para o Painel Dev mostrar o estado real da integração;
- verificar novas versões automaticamente em segundo plano, baixar somente do próprio Devboard, validar SHA-256 e atualizar sem reinstalação manual;
- fazer rollback automático para o executável anterior caso a nova versão não responda ao teste de saúde;
- abrir projetos locais diretamente na IDE configurada;
- manter o caminho local do projeto por máquina em `%LOCALAPPDATA%\\Devboard\\Agent\\workspace-bindings.json`;
- abrir o seletor nativo de pastas do Windows quando um projeto ainda não possui vínculo local;
- localizar automaticamente VS Code, Cursor, Delphi/RAD Studio, Visual Studio e IDEs JetBrains;
- para Delphi, procurar automaticamente `.groupproj`, `.dproj` ou `.dpr` dentro da pasta;
- para Visual Studio, priorizar `.slnx`/`.sln` e usar `vswhere.exe` quando disponível;
- expor uma API estritamente em loopback (`127.0.0.1:43827`) para a PWA conversar com o Agent sem expor a porta na rede;
- registrar o protocolo `devboard-agent://` para integrações locais futuras;
- detectar automaticamente `.git` e `.svn` na pasta do projeto ou em diretórios-pai;
- consultar status e histórico Git localmente, fazer Pull, Commit de todas as alterações e Push;
- consultar SVN via `svn.exe` quando disponível e fazer Update, Commit e Logs dentro do Devboard;
- usar `TortoiseProc.exe` como fallback seguro para Update, Commit, Logs e Check for modifications quando o cliente CLI do SVN não estiver instalado.


## Atualização automática

A partir da versão `0.3.0`, o Agent verifica o manifesto `/api/dev-agent/update` após iniciar e novamente em intervalos regulares. Quando existe uma versão mais nova:

1. aguarda o Agent ficar ocioso para não interromper Commit, Pull/Update, Push, seletor de pasta ou abertura de IDE;
2. mostra apenas o aviso **Atualizando Agent**;
3. baixa o template genérico exclusivamente da mesma origem HTTPS do Devboard;
4. valida tamanho, formato PE e SHA-256 informado pelo manifesto;
5. reaproveita localmente o `agent_id`/segredo já instalado, sem gerar novo pareamento;
6. inicia um helper temporário, encerra a versão antiga e substitui o executável em `%LOCALAPPDATA%\Devboard\Agent`;
7. inicia a nova versão e consulta `/v1/health`;
8. se a nova versão responder corretamente, mostra **Atualização finalizada**;
9. se falhar, restaura automaticamente `DevboardAgent.exe.bak`, reinicia a versão anterior e mostra **Atualização do Agent falhou**.

A atualização `0.3.0` é o bootstrap do mecanismo. Máquinas ainda em `0.2.x` precisam executar esse instalador uma última vez; as versões seguintes passam a ser automáticas.

O template de atualização é público e não contém segredo. A configuração individual continua somente na máquina e é reaplicada pelo próprio Agent durante o update.

## Abertura de IDEs

A PWA tenta o Agent primeiro. Dessa forma o navegador não precisa descobrir o caminho absoluto da pasta, algo que o File System Access API deliberadamente não expõe.

Fluxo:

1. o usuário escolhe a pasta pelo Painel Dev;
2. com o Agent online, abre o seletor nativo do Windows;
3. o Agent guarda o vínculo local daquele projeto nesta máquina;
4. ao clicar em **Abrir**, o Agent executa a IDE real passando a pasta/projeto como argumento;
5. em outro computador, o mesmo projeto pode ter outro caminho local sem quebrar o vínculo da primeira máquina.

Se um projeto antigo ainda não tiver vínculo local, o Agent tenta recuperar pelo caminho legado e por pastas comuns de desenvolvimento. Se não localizar com segurança, abre o seletor nativo uma única vez.

## Por que não é um Windows Service tradicional?

Windows Services executam na Session 0 e não devem abrir IDEs, navegador ou manipular a área de trabalho do usuário. Como o Devboard Agent precisa receber hotkeys globais e abrir aplicativos na sessão interativa, ele é instalado **por usuário** e registrado em `HKCU\\...\\Run`, iniciando automaticamente no login sem exigir privilégios administrativos.

## API local

A API escuta somente em `127.0.0.1:43827` e valida a origem configurada do Devboard. Endpoints atuais:

- `GET /v1/health`
- `POST /v1/pick-folder`
- `POST /v1/bind-project`
- `POST /v1/open-project`
- `POST /v1/vcs/status`
- `POST /v1/vcs/log`
- `POST /v1/vcs/update`
- `POST /v1/vcs/commit`
- `POST /v1/vcs/push`
- `POST /v1/vcs/native`

As respostas CORS também suportam Private Network Access para permitir a comunicação da PWA HTTPS com o loopback local.

A API não possui endpoint de shell/comando arbitrário. As operações locais são allowlisted e tipadas (`open-project`, `vcs/status`, `vcs/commit`, etc.), e o Agent monta os argumentos dos executáveis localmente.

## Build

Em Linux/macOS com Go instalado:

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H windowsgui" -o ../../public/downloads/devboard-agent-setup-template.exe .
```

O arquivo em `public/downloads/` é um template. A rota `/api/dev-agent/installer` anexa uma configuração individual e autenticada ao final do executável antes do download.

## v0.4.0

- ícone na bandeja do Windows com acesso rápido ao Devboard/Painel Dev/diagnóstico;
- endpoint local `/v1/diagnostics` para PWA, hotkey, auto-update, IDEs, Git/SVN e runtimes;
- execução tipada de projetos locais (`run`, `build`, `test`, `terminal`, `stop`) sem shell arbitrário vindo do frontend;
- detecção de Node/Next.js, Flutter, .NET e Delphi;
- logs locais de execução e parada da árvore de processos;
- auto-update adiado enquanto Run/Build/Test estiver em execução.
