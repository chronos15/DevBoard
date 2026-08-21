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
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	agentVersion = "0.1.0"
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
	user32               = syscall.NewLazyDLL("user32.dll")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procCreateMutexW     = kernel32.NewProc("CreateMutexW")
	procGetLastError     = kernel32.NewProc("GetLastError")
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
	var cfg agentConfig
	exe, err := os.Executable()
	if err != nil {
		return cfg, err
	}
	raw, err := os.ReadFile(exe)
	if err != nil {
		return cfg, err
	}
	idx := bytes.LastIndex(raw, []byte(configMarker))
	if idx < 0 {
		return cfg, errors.New("configuração do Devboard Agent não encontrada")
	}
	payload := bytes.TrimSpace(raw[idx+len(configMarker):])
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return cfg, err
	}
	if cfg.AgentID == "" || cfg.AgentSecret == "" || cfg.AppURL == "" || cfg.SupabaseURL == "" || cfg.SupabaseKey == "" {
		return cfg, errors.New("configuração do Devboard Agent incompleta")
	}
	return cfg, nil
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
	hotkeyOK := registerHotkey()
	defer unregisterHotkey()

	go heartbeatLoop(cfg, hotkeyOK)

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
		}
	}
}

func registerHotkey() bool {
	r, _, _ := procRegisterHotKey.Call(0, hotkeyID, modControl|modShift|modNoRepeat, vk7)
	return r != 0
}

func unregisterHotkey() {
	procUnregisterHotKey.Call(0, hotkeyID)
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

func openDevboard(appURL string) {
	target := strings.TrimRight(appURL, "/") + "/dev#dev-session"

	// App-mode dá uma experiência de PWA mesmo quando o navegador estava fechado.
	if exe := findBrowserExecutable("msedge.exe", []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "Application", "msedge.exe"),
	}); exe != "" {
		cmd := exec.Command(exe, "--app="+target)
		hideChildWindow(cmd)
		_ = cmd.Start()
		return
	}

	if exe := findBrowserExecutable("chrome.exe", []string{
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
	}); exe != "" {
		cmd := exec.Command(exe, "--app="+target)
		hideChildWindow(cmd)
		_ = cmd.Start()
		return
	}

	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", target)
	hideChildWindow(cmd)
	_ = cmd.Start()
}

func findBrowserExecutable(_ string, candidates []string) string {
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
