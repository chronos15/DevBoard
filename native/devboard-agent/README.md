# Devboard Agent para Windows

Agente nativo pequeno usado pelo Painel Dev para:

- iniciar automaticamente com a sessão do Windows;
- registrar `Ctrl + Shift + 7` como atalho global;
- abrir o Devboard diretamente em `/dev#dev-session`, mesmo com o navegador fechado;
- enviar heartbeat para o Supabase para o Painel Dev mostrar o estado real da integração;
- registrar o protocolo `devboard-agent://` para integrações locais futuras.

## Por que não é um Windows Service tradicional?

Windows Services executam na Session 0 e não devem abrir IDEs, navegador ou manipular a área de trabalho do usuário. Como o Devboard Agent precisa receber hotkeys globais e abrir aplicativos na sessão interativa, ele é instalado **por usuário** e registrado em `HKCU\\...\\Run`, iniciando automaticamente no login sem exigir privilégios administrativos.

## Build

Em Linux/macOS com Go instalado:

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H windowsgui" -o ../../public/downloads/devboard-agent-setup-template.exe .
```

O arquivo em `public/downloads/` é um template. A rota `/api/dev-agent/installer` anexa uma configuração individual e autenticada ao final do executável antes do download.
