package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type agentToolDiagnostic struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Found  bool   `json:"found"`
	Path   string `json:"path,omitempty"`
	Detail string `json:"detail,omitempty"`
	Group  string `json:"group"`
}

type agentDiagnostics struct {
	OK           bool                  `json:"ok"`
	Version      string                `json:"version"`
	Machine      string                `json:"machine"`
	HotkeyOK     bool                  `json:"hotkeyOk"`
	TrayOK       bool                  `json:"trayOk"`
	AutoUpdate   bool                  `json:"autoUpdate"`
	PWAInstalled bool                  `json:"pwaInstalled"`
	PWABrowser   string                `json:"pwaBrowser,omitempty"`
	PWAShortcut  string                `json:"pwaShortcut,omitempty"`
	Tools        []agentToolDiagnostic `json:"tools"`
}

var diagnosticsCache = struct {
	sync.Mutex
	at    time.Time
	value agentDiagnostics
}{}

func collectAgentDiagnostics() agentDiagnostics {
	// Algumas verificações (atalhos da PWA, VS/Delphi/JetBrains e PATH) podem tocar
	// disco/registro. Cacheamos a parte pesada por 45s para o painel abrir instantaneamente
	// nas consultas seguintes sem perder os estados dinâmicos do hotkey/tray.
	diagnosticsCache.Lock()
	if !diagnosticsCache.at.IsZero() && time.Since(diagnosticsCache.at) < 45*time.Second {
		cached := diagnosticsCache.value
		diagnosticsCache.Unlock()
		cached.HotkeyOK = registeredHotkey || keyboardHookHandle != 0
		cached.TrayOK = trayIsReady()
		cached.Version = agentVersion
		return cached
	}
	diagnosticsCache.Unlock()

	hostname, _ := os.Hostname()
	result := agentDiagnostics{
		OK:         true,
		Version:    agentVersion,
		Machine:    hostname,
		HotkeyOK:   registeredHotkey || keyboardHookHandle != 0,
		TrayOK:     trayIsReady(),
		AutoUpdate: true,
	}
	if pwa, ok := findInstalledDevboardPWA(); ok {
		result.PWAInstalled = true
		result.PWABrowser = pwa.Browser
		result.PWAShortcut = pwa.ShortcutPath
	}

	add := func(id, label, group, path, detail string) {
		path = strings.TrimSpace(path)
		result.Tools = append(result.Tools, agentToolDiagnostic{ID: id, Label: label, Group: group, Found: path != "", Path: path, Detail: detail})
	}
	add("vscode", "Visual Studio Code", "IDE", findVSCodeExecutable("Visual Studio Code"), "Abertura direta de workspaces")
	add("cursor", "Cursor", "IDE", findCursorExecutable(), "Abertura direta de workspaces")
	add("delphi", "Delphi / RAD Studio", "IDE", findDelphiExecutable(), "Projetos .groupproj/.dproj/.dpr")
	add("visual-studio", "Visual Studio", "IDE", findVisualStudioExecutable(), "Solutions .sln/.slnx")
	add("git", "Git", "Código", findGitExecutable(), "Status, pull, commit, push e histórico")
	add("svn", "SVN CLI", "Código", findSVNExecutable(), "Status, update, commit e histórico")
	add("tortoise", "TortoiseSVN", "Código", findTortoiseProcExecutable(), "Interface nativa do TortoiseSVN")
	add("terminal", "Windows Terminal", "Runtime", findWindowsTerminalExecutable(), "Terminal diretamente na pasta do projeto")
	add("node", "Node.js", "Runtime", executableOnPath("node.exe", "node"), "Projetos Node/Next.js")
	add("npm", "npm", "Runtime", executableOnPath("npm.cmd", "npm"), "Scripts de projeto")
	add("pnpm", "pnpm", "Runtime", executableOnPath("pnpm.cmd", "pnpm"), "Scripts de projeto")
	add("flutter", "Flutter", "Runtime", executableOnPath("flutter.bat", "flutter"), "Build e testes Flutter")
	add("dotnet", ".NET SDK", "Runtime", executableOnPath("dotnet.exe", "dotnet"), "Build, run e testes .NET")

	diagnosticsCache.Lock()
	diagnosticsCache.at = time.Now()
	diagnosticsCache.value = result
	diagnosticsCache.Unlock()
	return result
}

func executableOnPath(names ...string) string {
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil {
			if abs, err := filepath.Abs(path); err == nil {
				return abs
			}
			return path
		}
	}
	return ""
}

func findWindowsTerminalExecutable() string {
	if path := executableOnPath("wt.exe"); path != "" {
		return path
	}
	candidates := []string{
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WindowsApps", "wt.exe"),
	}
	return firstExistingFile(candidates...)
}
