# Devboard Agent para Windows

Agente nativo pequeno usado pelo Painel Dev para:

- iniciar automaticamente com a sessão do Windows;
- registrar `Ctrl + Shift + 7` como atalho global;
- usar automaticamente um hook global como fallback quando outro aplicativo já reservou o atalho;
- abrir o Devboard diretamente em `/dev#dev-session`, mesmo com o navegador fechado;
- priorizar automaticamente a PWA do Devboard que já estiver instalada no Windows, seja Chrome ou Edge;
- se houver mais de uma PWA instalada, usar a instalação detectada mais recente, sem preferência fixa por navegador;
- enviar heartbeat para o Supabase para o Painel Dev mostrar o estado real da integração;
- abrir projetos locais diretamente na IDE configurada;
- manter o caminho local do projeto por máquina em `%LOCALAPPDATA%\\Devboard\\Agent\\workspace-bindings.json`;
- abrir o seletor nativo de pastas do Windows quando um projeto ainda não possui vínculo local;
- localizar automaticamente VS Code, Cursor, Delphi/RAD Studio, Visual Studio e IDEs JetBrains;
- para Delphi, procurar automaticamente `.groupproj`, `.dproj` ou `.dpr` dentro da pasta;
- para Visual Studio, priorizar `.slnx`/`.sln` e usar `vswhere.exe` quando disponível;
- expor uma API estritamente em loopback (`127.0.0.1:43827`) para a PWA conversar com o Agent sem expor a porta na rede;
- registrar o protocolo `devboard-agent://` para integrações locais futuras.

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

As respostas CORS também suportam Private Network Access para permitir a comunicação da PWA HTTPS com o loopback local.

## Build

Em Linux/macOS com Go instalado:

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H windowsgui" -o ../../public/downloads/devboard-agent-setup-template.exe .
```

O arquivo em `public/downloads/` é um template. A rota `/api/dev-agent/installer` anexa uma configuração individual e autenticada ao final do executável antes do download.
