package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	agentVersion = "0.4.3"
	configMarker = "\nDEVBOARD_AGENT_CONFIG_V1\n"
	hotkeyID     = 0xDB01
	wmHotkey     = 0x0312
	modControl   = 0x0002
	modShift     = 0x0004
	modNoRepeat  = 0x4000
	vk7          = 0x37
)

type agentConfig struct {
	AgentID      string `json:"agent_id"`
	AgentSecret  string `json:"agent_secret"`
	AppURL       string `json:"app_url"`
	SupabaseURL  string `json:"supabase_url"`
	SupabaseKey  string `json:"supabase_key"`
	AgentVersion string `json:"agent_version"`
}

type heartbeatPayload struct {
	AgentID      string `json:"p_agent_id"`
	AgentSecret  string `json:"p_agent_secret"`
	AgentVersion string `json:"p_agent_version"`
	MachineName  string `json:"p_machine_name"`
	OSName       string `json:"p_os_name"`
	HotkeyOK     bool   `json:"p_hotkey_ok"`
}

type winMsg struct {
	Hwnd     uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	PtX      int32
	PtY      int32
	LPrivate uint32
}

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	kernel32                = syscall.NewLazyDLL("kernel32.dll")
	procRegisterHotKey      = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey    = user32.NewProc("UnregisterHotKey")
	procGetMessageW         = user32.NewProc("GetMessageW")
	procSetWindowsHookExW   = user32.NewProc("SetWindowsHookExW")
	procUnhookWindowsHookEx = user32.NewProc("UnhookWindowsHookEx")
	procCallNextHookEx      = user32.NewProc("CallNextHookEx")
	procCreateMutexW        = kernel32.NewProc("CreateMutexW")
	procGetLastError        = kernel32.NewProc("GetLastError")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")

	keyboardHookHandle uintptr
	keyboardHookProc   uintptr
	hookAppURL         string
	hookCtrlDown       bool
	hookShiftDown      bool
	hookShortcutDown   bool
	registeredHotkey   bool
)

func main() {
	cfg, err := readEmbeddedConfig()
	if err != nil {
		return
	}

	installedExe, err := installedExecutablePath()
	if err != nil {
		return
	}

	currentExe, _ := os.Executable()
	currentExe, _ = filepath.Abs(currentExe)
	installedExe, _ = filepath.Abs(installedExe)

	// O helper de atualização roda a partir de um executável temporário e precisa
	// substituir o Agent instalado antes da lógica normal de instalação/instância única.
	if hasArg("--apply-update") {
		applyAgentUpdateMode(cfg, installedExe)
		return
	}

	// Nunca herdar Downloads/System32 como diretório de trabalho do Agent instalado.
	// Além de tornar o comportamento previsível, isto impede que qualquer caminho relativo
	// acidental seja interpretado como uma pasta válida de projeto.
	if samePath(currentExe, installedExe) {
		_ = os.Chdir(filepath.Dir(installedExe))
	}

	if !samePath(currentExe, installedExe) && !hasArg("--agent") {
		if err := installSelf(installedExe); err != nil {
			return
		}
		_ = launchInstalledAgent(installedExe)
		time.Sleep(500 * time.Millisecond)
		openDevboard(cfg.AppURL)
		return
	}

	if !acquireSingleInstance() {
		return
	}

	runAgent(cfg)
}

func hasArg(value string) bool {
	for _, arg := range os.Args[1:] {
		if strings.EqualFold(arg, value) {
			return true
		}
	}
	return false
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func readEmbeddedConfig() (agentConfig, error) {
	exe, err := os.Executable()
	if err != nil {
		return agentConfig{}, err
	}
	return readEmbeddedConfigFromPath(exe)
}

func installedExecutablePath() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA indisponível")
	}
	return filepath.Join(base, "Devboard", "Agent", "DevboardAgent.exe"), nil
}

func installSelf(installedExe string) error {
	dir := filepath.Dir(installedExe)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// Se existir uma versão em execução, encerra somente o agente instalado.
	// O instalador baixado possui outro nome e não é afetado.
	_ = exec.Command("taskkill", "/IM", "DevboardAgent.exe", "/F").Run()
	time.Sleep(350 * time.Millisecond)

	self, err := os.Executable()
	if err != nil {
		return err
	}
	if err := copyFile(self, installedExe); err != nil {
		return err
	}

	if err := registerAutoStart(installedExe); err != nil {
		return err
	}
	if err := registerProtocol(installedExe); err != nil {
		return err
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func registerAutoStart(installedExe string) error {
	command := fmt.Sprintf(`"%s" --agent`, installedExe)
	return exec.Command(
		"reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v", "DevboardAgent", "/t", "REG_SZ", "/d", command, "/f",
	).Run()
}

func registerProtocol(installedExe string) error {
	base := `HKCU\Software\Classes\devboard-agent`
	commands := [][]string{
		{"add", base, "/ve", "/t", "REG_SZ", "/d", "URL:Devboard Agent Protocol", "/f"},
		{"add", base, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"},
		{"add", base + `\DefaultIcon`, "/ve", "/t", "REG_SZ", "/d", installedExe + ",0", "/f"},
		{"add", base + `\shell\open\command`, "/ve", "/t", "REG_SZ", "/d", fmt.Sprintf(`"%s" --protocol "%%1"`, installedExe), "/f"},
	}
	for _, args := range commands {
		if err := exec.Command("reg", args...).Run(); err != nil {
			return err
		}
	}
	return nil
}

func launchInstalledAgent(installedExe string) error {
	cmd := exec.Command(installedExe, "--agent")
	cmd.Dir = filepath.Dir(installedExe)
	hideChildWindow(cmd)
	return cmd.Start()
}

func hideChildWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func acquireSingleInstance() bool {
	name, _ := syscall.UTF16PtrFromString(`Local\DevboardAgent_7F07A6D6`)
	handle, _, _ := procCreateMutexW.Call(0, 1, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return false
	}
	code, _, _ := procGetLastError.Call()
	const errorAlreadyExists = 183
	return code != errorAlreadyExists
}

func runAgent(cfg agentConfig) {
	hotkeyOK := startGlobalShortcut(cfg.AppURL)
	defer stopGlobalShortcut()
	_ = startTray(cfg.AppURL)
	defer stopTray()

	cleanupAgentUpdateArtifacts()
	go heartbeatLoop(cfg, hotkeyOK)
	go startLocalAPIServer(cfg)
	startAutoUpdater(cfg)

	if hasArg("--protocol") {
		for index, arg := range os.Args {
			if strings.EqualFold(arg, "--protocol") && index+1 < len(os.Args) {
				handleProtocol(cfg, os.Args[index+1])
				break
			}
		}
	}

	var msg winMsg
	for {
		result, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) <= 0 {
			break
		}
		if msg.Message == wmHotkey && msg.WParam == hotkeyID {
			openDevboard(cfg.AppURL)
			continue
		}
		dispatchWindowMessage(&msg)
	}
}

const (
	whKeyboardLL = 13
	wmKeyDown    = 0x0100
	wmKeyUp      = 0x0101
	wmSysKeyDown = 0x0104
	wmSysKeyUp   = 0x0105
	vkControl    = 0x11
	vkShift      = 0x10
	vkLControl   = 0xA2
	vkRControl   = 0xA3
	vkLShift     = 0xA0
	vkRShift     = 0xA1
)

type kbdLLHookStruct struct {
	VkCode      uint32
	ScanCode    uint32
	Flags       uint32
	Time        uint32
	DwExtraInfo uintptr
}

// startGlobalShortcut tenta primeiro RegisterHotKey, que é o caminho mais leve.
// Se outro aplicativo (por exemplo a extensão antiga do Devboard) já tiver
// reservado Ctrl+Shift+7, usamos um WH_KEYBOARD_LL como fallback. Assim o Agent
// continua respondendo ao mesmo atalho sem exigir qualquer configuração do usuário.
func startGlobalShortcut(appURL string) bool {
	r, _, _ := procRegisterHotKey.Call(0, hotkeyID, modControl|modShift|modNoRepeat, vk7)
	if r != 0 {
		registeredHotkey = true
		return true
	}

	hookAppURL = appURL
	keyboardHookProc = syscall.NewCallback(lowLevelKeyboardProc)
	module, _, _ := procGetModuleHandleW.Call(0)
	hook, _, _ := procSetWindowsHookExW.Call(
		whKeyboardLL,
		keyboardHookProc,
		module,
		0,
	)
	if hook == 0 {
		// Alguns ambientes aceitam hook low-level com hMod nulo mesmo quando o
		// módulo não foi resolvido. Tentamos uma segunda vez antes de desistir.
		hook, _, _ = procSetWindowsHookExW.Call(
			whKeyboardLL,
			keyboardHookProc,
			0,
			0,
		)
	}
	keyboardHookHandle = hook
	return keyboardHookHandle != 0
}

func stopGlobalShortcut() {
	if registeredHotkey {
		procUnregisterHotKey.Call(0, hotkeyID)
		registeredHotkey = false
	}
	if keyboardHookHandle != 0 {
		procUnhookWindowsHookEx.Call(keyboardHookHandle)
		keyboardHookHandle = 0
	}
}

func lowLevelKeyboardProc(nCode int, wParam uintptr, lParam uintptr) uintptr {
	if nCode < 0 || lParam == 0 {
		result, _, _ := procCallNextHookEx.Call(keyboardHookHandle, uintptr(nCode), wParam, lParam)
		return result
	}

	info := (*kbdLLHookStruct)(unsafe.Pointer(lParam))
	isDown := wParam == wmKeyDown || wParam == wmSysKeyDown
	isUp := wParam == wmKeyUp || wParam == wmSysKeyUp

	switch info.VkCode {
	case vkControl, vkLControl, vkRControl:
		if isDown {
			hookCtrlDown = true
		} else if isUp {
			hookCtrlDown = false
		}
	case vkShift, vkLShift, vkRShift:
		if isDown {
			hookShiftDown = true
		} else if isUp {
			hookShiftDown = false
		}
	case vk7:
		if isDown && hookCtrlDown && hookShiftDown {
			if !hookShortcutDown {
				hookShortcutDown = true
				go openDevboard(hookAppURL)
			}
			// Consumimos o atalho no fallback para evitar que a extensão antiga
			// ou outro aplicativo execute a mesma combinação em paralelo.
			return 1
		}
		if isUp && hookShortcutDown {
			hookShortcutDown = false
			return 1
		}
	}

	result, _, _ := procCallNextHookEx.Call(keyboardHookHandle, uintptr(nCode), wParam, lParam)
	return result
}

func heartbeatLoop(cfg agentConfig, hotkeyOK bool) {
	sendHeartbeat(cfg, hotkeyOK)
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		sendHeartbeat(cfg, hotkeyOK)
	}
}

func sendHeartbeat(cfg agentConfig, hotkeyOK bool) {
	hostname, _ := os.Hostname()
	payload := heartbeatPayload{
		AgentID:      cfg.AgentID,
		AgentSecret:  cfg.AgentSecret,
		AgentVersion: agentVersion,
		MachineName:  hostname,
		OSName:       "Windows " + runtime.GOARCH,
		HotkeyOK:     hotkeyOK,
	}
	raw, _ := json.Marshal(payload)
	endpoint := strings.TrimRight(cfg.SupabaseURL, "/") + "/rest/v1/rpc/developer_agent_heartbeat"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("apikey", cfg.SupabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err == nil && resp != nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
}

func handleProtocol(cfg agentConfig, raw string) {
	parsed, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(parsed.Scheme, "devboard-agent") {
		return
	}
	switch strings.ToLower(parsed.Host) {
	case "open-dev", "dev":
		openDevboard(cfg.AppURL)
	}
}

var (
	profileDirectoryPattern = regexp.MustCompile(`(?i)--profile-directory=(?:"([^"]+)"|([^\s]+))`)
	appIDPattern            = regexp.MustCompile(`(?i)--app-id=(?:"([^"]+)"|([^\s]+))`)
)

type installedPWA struct {
	Launcher         string
	ProfileDirectory string
	AppID            string
	Browser          string
	ShortcutPath     string
	ModifiedAt       time.Time
}

func openDevboard(appURL string) {
	openDevboardPath(appURL, "/dev#dev-session")
}

func openDevboardPath(appURL, relative string) {
	relative = strings.TrimSpace(relative)
	if relative == "" || !strings.HasPrefix(relative, "/") {
		relative = "/"
	}
	target := strings.TrimRight(appURL, "/") + relative

	// 1) Sempre prioriza uma instalação PWA REAL já existente no Windows.
	// Não existe preferência fixa por Edge ou Chrome: usamos o Devboard que o
	// usuário já instalou. Se houver mais de uma instalação válida, a mais recente
	// é escolhida. Isso preserva o perfil/cookies/sessão daquela PWA.
	if pwa, ok := findInstalledDevboardPWA(); ok {
		if launchInstalledPWA(pwa, target) == nil {
			return
		}
	}

	// 2) Se nenhuma PWA do Devboard estiver instalada, abre em app-mode.
	// Chrome vem antes somente neste fallback, sem interferir em PWAs existentes.
	if exe := findBrowserExecutable([]string{
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
	}); exe != "" {
		cmd := exec.Command(exe, "--app="+target)
		hideChildWindow(cmd)
		if err := cmd.Start(); err == nil {
			return
		}
	}

	if exe := findBrowserExecutable([]string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "Application", "msedge.exe"),
	}); exe != "" {
		cmd := exec.Command(exe, "--app="+target)
		hideChildWindow(cmd)
		if err := cmd.Start(); err == nil {
			return
		}
	}

	// 3) Último fallback: navegador padrão do Windows.
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", target)
	hideChildWindow(cmd)
	_ = cmd.Start()
}

func findInstalledDevboardPWA() (installedPWA, bool) {
	var best installedPWA
	found := false

	roots := []string{
		filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs"),
		filepath.Join(os.Getenv("USERPROFILE"), "Desktop"),
		filepath.Join(os.Getenv("PUBLIC"), "Desktop"),
	}

	// Evita considerar o mesmo PWA duas vezes quando há atalho no menu Iniciar e Desktop.
	seen := map[string]struct{}{}

	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		rootInfo, err := os.Stat(root)
		if err != nil || !rootInfo.IsDir() {
			continue
		}

		_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if entry.IsDir() {
				if path != root {
					relative, _ := filepath.Rel(root, path)
					// O menu Iniciar pode ter muita coisa. Atalhos PWA não precisam de
					// uma busca profunda para serem encontrados.
					if strings.Count(relative, string(os.PathSeparator)) >= 4 {
						return filepath.SkipDir
					}
				}
				return nil
			}

			if !strings.EqualFold(filepath.Ext(path), ".lnk") {
				return nil
			}
			shortcutName := strings.ToLower(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
			if !strings.Contains(shortcutName, "devboard") {
				return nil
			}

			launcher, arguments, ok := readWindowsShortcut(path)
			if !ok {
				return nil
			}
			browser, ok := classifyInstalledPWALauncher(launcher)
			if !ok {
				return nil
			}

			profile := extractSwitchValue(profileDirectoryPattern, arguments)
			appID := extractSwitchValue(appIDPattern, arguments)
			if appID == "" {
				return nil
			}
			// Alguns launchers dedicados já carregam o perfil internamente. Quando o
			// atalho fornece --profile-directory, preservamos explicitamente.
			key := strings.ToLower(filepath.Clean(launcher) + "|" + profile + "|" + appID)
			if _, exists := seen[key]; exists {
				return nil
			}
			seen[key] = struct{}{}

			info, _ := entry.Info()
			modifiedAt := time.Time{}
			if info != nil {
				modifiedAt = info.ModTime()
			}
			candidate := installedPWA{
				Launcher:         launcher,
				ProfileDirectory: profile,
				AppID:            appID,
				Browser:          browser,
				ShortcutPath:     path,
				ModifiedAt:       modifiedAt,
			}

			if !found || candidate.ModifiedAt.After(best.ModifiedAt) {
				best = candidate
				found = true
			}
			return nil
		})
	}

	return best, found
}

func launchInstalledPWA(pwa installedPWA, target string) error {
	args := make([]string, 0, 3)
	if pwa.ProfileDirectory != "" {
		args = append(args, "--profile-directory="+pwa.ProfileDirectory)
	}
	args = append(args, "--app-id="+pwa.AppID)
	// Chromium usa este switch ao abrir URLs internas de um Web App instalado.
	// Como /dev está dentro do scope do Devboard, a navegação permanece dentro
	// da própria PWA em vez de criar uma janela genérica do navegador.
	args = append(args, "--app-launch-url-for-shortcuts-menu-item="+target)

	cmd := exec.Command(pwa.Launcher, args...)
	hideChildWindow(cmd)
	return cmd.Start()
}

func readWindowsShortcut(shortcutPath string) (string, string, bool) {
	if shortcutPath == "" {
		return "", "", false
	}
	const script = `$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DEVBOARD_PWA_SHORTCUT); [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $shortcut.TargetPath; Write-Output $shortcut.Arguments`
	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-Command", script,
	)
	cmd.Env = append(os.Environ(), "DEVBOARD_PWA_SHORTCUT="+shortcutPath)
	hideChildWindow(cmd)
	output, err := cmd.Output()
	if err != nil {
		return "", "", false
	}
	lines := strings.Split(strings.ReplaceAll(string(output), "\r\n", "\n"), "\n")
	if len(lines) < 2 {
		return "", "", false
	}
	launcher := strings.TrimSpace(lines[0])
	arguments := strings.TrimSpace(strings.Join(lines[1:], " "))
	if launcher == "" || arguments == "" {
		return "", "", false
	}
	return launcher, arguments, true
}

func classifyInstalledPWALauncher(path string) (string, bool) {
	lower := strings.ToLower(filepath.Clean(path))
	base := strings.ToLower(filepath.Base(lower))
	if !strings.HasSuffix(base, ".exe") {
		return "", false
	}

	if strings.Contains(lower, `\google\chrome\`) || strings.Contains(lower, `\google\chrome sxs\`) {
		if base == "chrome_proxy.exe" || base == "chrome_pwa_launcher.exe" || base == "chrome.exe" || strings.Contains(lower, `\web applications\`) {
			return "chrome", true
		}
	}

	if strings.Contains(lower, `\microsoft\edge\`) {
		if base == "msedge_proxy.exe" || base == "msedge_pwa_launcher.exe" || base == "msedge.exe" || strings.Contains(lower, `\web applications\`) {
			return "edge", true
		}
	}

	return "", false
}

func extractSwitchValue(pattern *regexp.Regexp, arguments string) string {
	match := pattern.FindStringSubmatch(arguments)
	if len(match) < 3 {
		return ""
	}
	if match[1] != "" {
		return strings.TrimSpace(match[1])
	}
	return strings.TrimSpace(match[2])
}

func findBrowserExecutable(candidates []string) string {
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}
