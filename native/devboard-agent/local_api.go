package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const localAgentAddress = "127.0.0.1:43827"

type localBindingFile struct {
	Projects map[string]string `json:"projects"`
}

type localAgentIDE struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Kind              string `json:"kind"`
	CustomURITemplate string `json:"customUriTemplate"`
}

type localOpenProjectRequest struct {
	ProjectID         string        `json:"projectId"`
	ProjectName       string        `json:"projectName"`
	FolderName        string        `json:"folderName"`
	LegacyPath        string        `json:"legacyPath"`
	AllowFolderPicker bool          `json:"allowFolderPicker"`
	IDE               localAgentIDE `json:"ide"`
}

type localPickFolderRequest struct {
	ProjectID          string `json:"projectId"`
	ProjectName        string `json:"projectName"`
	ExpectedFolderName string `json:"expectedFolderName"`
}

type localBindProjectRequest struct {
	ProjectID string `json:"projectId"`
	Path      string `json:"path"`
}

type localLaunchResult struct {
	Path       string `json:"path"`
	Executable string `json:"executable"`
	Target     string `json:"target"`
}

var localBindingMu sync.Mutex
var localActiveOperations atomic.Int32

func startLocalAPIServer(cfg agentConfig) {
	listener, err := net.Listen("tcp", localAgentAddress)
	if err != nil {
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodGet {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		hostname, _ := os.Hostname()
		writeLocalAgentJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"version": agentVersion,
			"machine": hostname,
			"update":  readAgentUpdateStatus(),
		})
	})

	mux.HandleFunc("/v1/update/check", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		started := requestImmediateAgentUpdateCheck(cfg)
		writeLocalAgentJSON(w, http.StatusAccepted, map[string]any{
			"ok":      true,
			"started": started,
			"update":  readAgentUpdateStatus(),
		})
	})

	mux.HandleFunc("/v1/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodGet {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, collectAgentDiagnostics())
	})

	mux.HandleFunc("/v1/pick-folder", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localPickFolderRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Solicitação inválida.")
			return
		}
		initial := ""
		if input.ProjectID != "" {
			initial = readLocalProjectBinding(input.ProjectID)
		}
		selected, err := pickNativeFolder(input.ProjectName, initial)
		if err != nil {
			if errors.Is(err, errFolderPickerCancelled) {
				writeLocalAgentError(w, 499, "picker_cancelled", "Seleção de pasta cancelada.")
				return
			}
			writeLocalAgentError(w, http.StatusInternalServerError, "picker_failed", "Não foi possível abrir o seletor de pastas do Windows.")
			return
		}
		if input.ProjectID != "" {
			_ = saveLocalProjectBinding(input.ProjectID, selected)
		}
		writeLocalAgentJSON(w, http.StatusOK, map[string]any{"ok": true, "path": selected, "name": filepath.Base(selected)})
	})

	mux.HandleFunc("/v1/bind-project", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localBindProjectRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.Path) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto e pasta são obrigatórios.")
			return
		}
		clean := normalizeAbsoluteDirectory(input.Path)
		if clean == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "folder_not_found", "A pasta configurada não existe neste computador.")
			return
		}
		if err := saveLocalProjectBinding(input.ProjectID, clean); err != nil {
			writeLocalAgentError(w, http.StatusInternalServerError, "binding_failed", "Não foi possível guardar o vínculo local da pasta.")
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("/v1/open-project", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localOpenProjectRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.IDE.Kind) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto e IDE são obrigatórios.")
			return
		}

		folder, err := resolveLocalProjectFolder(input)
		if err != nil {
			if errors.Is(err, errFolderPickerCancelled) {
				writeLocalAgentError(w, 499, "picker_cancelled", "Seleção de pasta cancelada.")
				return
			}
			writeLocalAgentError(w, http.StatusConflict, "folder_not_found", "Não localizei a pasta deste projeto neste computador. Abra o atalho novamente e selecione a pasta quando solicitado.")
			return
		}

		result, err := launchLocalProject(folder, input.IDE, input.ProjectName, input.ProjectID)
		if err != nil {
			writeLocalAgentError(w, http.StatusUnprocessableEntity, "ide_launch_failed", err.Error())
			return
		}
		_ = saveLocalProjectBinding(input.ProjectID, folder)
		writeLocalAgentJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"path":       result.Path,
			"executable": result.Executable,
			"target":     result.Target,
		})
	})

	mux.HandleFunc("/v1/runtime/status", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localRuntimeRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		status, err := getLocalRuntimeStatus(input)
		if err != nil {
			code := "runtime_status_failed"
			if strings.Contains(strings.ToLower(err.Error()), "pasta") {
				code = "folder_not_found"
			}
			writeLocalAgentError(w, http.StatusUnprocessableEntity, code, err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, status)
	})

	mux.HandleFunc("/v1/runtime/action", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localRuntimeRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		status, err := runLocalRuntimeAction(input)
		if err != nil {
			code := "runtime_action_failed"
			if strings.Contains(strings.ToLower(err.Error()), "pasta") {
				code = "folder_not_found"
			}
			writeLocalAgentError(w, http.StatusUnprocessableEntity, code, err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, status)
	})

	mux.HandleFunc("/v1/vcs/status", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localVCSProjectRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		status, err := getLocalVCSStatus(input)
		if err != nil {
			code := "vcs_status_failed"
			if strings.Contains(strings.ToLower(err.Error()), "pasta") {
				code = "folder_not_found"
			}
			writeLocalAgentError(w, http.StatusUnprocessableEntity, code, err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, status)
	})

	mux.HandleFunc("/v1/vcs/log", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localVCSLogRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		result, err := getLocalVCSLog(input)
		if err != nil {
			writeLocalAgentError(w, http.StatusUnprocessableEntity, "vcs_log_failed", err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/v1/vcs/commit", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localVCSCommitRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Solicitação de commit inválida.")
			return
		}
		result, err := commitLocalVCS(input)
		if err != nil {
			writeLocalAgentError(w, http.StatusUnprocessableEntity, "vcs_commit_failed", err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/v1/vcs/update", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localVCSProjectRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		result, err := updateLocalVCS(input)
		if err != nil {
			writeLocalAgentError(w, http.StatusUnprocessableEntity, "vcs_update_failed", err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/v1/vcs/push", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localVCSProjectRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		result, err := pushLocalVCS(input)
		if err != nil {
			writeLocalAgentError(w, http.StatusUnprocessableEntity, "vcs_push_failed", err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/v1/vcs/native", func(w http.ResponseWriter, r *http.Request) {
		if !prepareLocalAgentRequest(w, r, cfg) {
			return
		}
		if r.Method != http.MethodPost {
			writeLocalAgentError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Método não permitido.")
			return
		}
		var input localVCSNativeRequest
		if err := decodeLocalAgentJSON(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
			writeLocalAgentError(w, http.StatusBadRequest, "invalid_payload", "Projeto local inválido.")
			return
		}
		result, err := openLocalVCSNative(input)
		if err != nil {
			writeLocalAgentError(w, http.StatusUnprocessableEntity, "vcs_native_failed", err.Error())
			return
		}
		writeLocalAgentJSON(w, http.StatusOK, result)
	})

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		track := r.Method != http.MethodOptions && r.URL.Path != "/v1/health"
		if track {
			localActiveOperations.Add(1)
			defer localActiveOperations.Add(-1)
		}
		mux.ServeHTTP(w, r)
	})

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 4 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	_ = server.Serve(listener)
}

func prepareLocalAgentRequest(w http.ResponseWriter, r *http.Request, cfg agentConfig) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && !localAgentOriginAllowed(origin, cfg.AppURL) {
		writeLocalAgentError(w, http.StatusForbidden, "origin_denied", "Origem não autorizada pelo Devboard Agent.")
		return false
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Devboard-Agent")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Cache-Control", "no-store")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	if r.Header.Get("X-Devboard-Agent") != "1" {
		writeLocalAgentError(w, http.StatusForbidden, "agent_header_missing", "Solicitação local inválida.")
		return false
	}
	return true
}

func localAgentOriginAllowed(origin, appURL string) bool {
	originURL, err1 := url.Parse(origin)
	app, err2 := url.Parse(appURL)
	if err1 == nil && err2 == nil && strings.EqualFold(originURL.Scheme, app.Scheme) && strings.EqualFold(originURL.Host, app.Host) {
		return true
	}
	host := ""
	if err1 == nil {
		host = strings.ToLower(originURL.Hostname())
	}
	return host == "localhost" || host == "127.0.0.1"
}

func decodeLocalAgentJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 128*1024))
	return decoder.Decode(target)
}

func writeLocalAgentJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeLocalAgentError(w http.ResponseWriter, status int, code, message string) {
	writeLocalAgentJSON(w, status, map[string]any{"ok": false, "code": code, "error": message})
}

func localBindingsPath() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Devboard", "Agent", "workspace-bindings.json")
}

func readLocalBindings() localBindingFile {
	localBindingMu.Lock()
	defer localBindingMu.Unlock()
	return readLocalBindingsUnlocked()
}

func readLocalBindingsUnlocked() localBindingFile {
	result := localBindingFile{Projects: map[string]string{}}
	raw, err := os.ReadFile(localBindingsPath())
	if err == nil {
		_ = json.Unmarshal(raw, &result)
	}
	if result.Projects == nil {
		result.Projects = map[string]string{}
	}
	return result
}

func normalizeAbsoluteDirectory(path string) string {
	raw := strings.TrimSpace(strings.Trim(path, `"`))
	if raw == "" || raw == "." || !filepath.IsAbs(raw) {
		return ""
	}
	clean := filepath.Clean(raw)
	if clean == "." || !directoryExists(clean) {
		return ""
	}
	return clean
}

func readLocalProjectBinding(projectID string) string {
	bindings := readLocalBindings()
	raw := strings.TrimSpace(bindings.Projects[projectID])
	if value := normalizeAbsoluteDirectory(raw); value != "" {
		return value
	}

	// Builds anteriores podiam persistir "." quando legacyPath vinha vazio.
	// Em Windows isso fazia a IDE herdar o diretório atual do Agent (por exemplo Downloads).
	// Removemos esse vínculo inválido para obrigar uma resolução real da pasta.
	if raw != "" {
		_ = removeLocalProjectBinding(projectID)
	}
	return ""
}

func saveLocalProjectBinding(projectID, folder string) error {
	projectID = strings.TrimSpace(projectID)
	folder = normalizeAbsoluteDirectory(folder)
	if projectID == "" || folder == "" {
		return errors.New("vínculo local inválido")
	}
	localBindingMu.Lock()
	defer localBindingMu.Unlock()
	bindings := readLocalBindingsUnlocked()
	bindings.Projects[projectID] = folder
	raw, err := json.MarshalIndent(bindings, "", "  ")
	if err != nil {
		return err
	}
	path := localBindingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func removeLocalProjectBinding(projectID string) error {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil
	}
	localBindingMu.Lock()
	defer localBindingMu.Unlock()
	bindings := readLocalBindingsUnlocked()
	if _, ok := bindings.Projects[projectID]; !ok {
		return nil
	}
	delete(bindings.Projects, projectID)
	raw, err := json.MarshalIndent(bindings, "", "  ")
	if err != nil {
		return err
	}
	path := localBindingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func directoryExists(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

var errFolderPickerCancelled = errors.New("folder picker cancelled")

func pickNativeFolder(projectName, initial string) (string, error) {
	title := "Selecione a pasta do projeto"
	if strings.TrimSpace(projectName) != "" {
		title = "Selecione a pasta de " + strings.TrimSpace(projectName)
	}

	// O FolderBrowserDialog sem janela proprietária pode aparecer atrás da PWA/browser.
	// Criamos uma janela invisível/topmost somente para ser owner do diálogo; assim o seletor
	// nasce em primeiro plano, recebe foco e continua modal em relação ao Agent.
	const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DevboardNativeWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$owner = New-Object System.Windows.Forms.Form
$owner.Text = $env:DEVBOARD_FOLDER_TITLE
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Size = New-Object System.Drawing.Size(2,2)
$owner.Opacity = 0.01
$owner.Show()
$owner.Activate()
[System.Windows.Forms.Application]::DoEvents()
[DevboardNativeWindow]::BringWindowToTop($owner.Handle) | Out-Null
[DevboardNativeWindow]::SetForegroundWindow($owner.Handle) | Out-Null

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:DEVBOARD_FOLDER_TITLE
$dialog.ShowNewFolderButton = $true
if ($env:DEVBOARD_FOLDER_INITIAL -and (Test-Path -LiteralPath $env:DEVBOARD_FOLDER_INITIAL -PathType Container)) {
  $dialog.SelectedPath = $env:DEVBOARD_FOLDER_INITIAL
}
$result = $dialog.ShowDialog($owner)
$selected = if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath } else { "" }
$owner.Close()
$owner.Dispose()
$dialog.Dispose()
if ($selected) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $selected
  exit 0
}
exit 17
`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = append(os.Environ(), "DEVBOARD_FOLDER_TITLE="+title, "DEVBOARD_FOLDER_INITIAL="+normalizeAbsoluteDirectory(initial))
	hideChildWindow(cmd)
	output, err := cmd.Output()
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok && exitError.ExitCode() == 17 {
			return "", errFolderPickerCancelled
		}
		return "", err
	}
	selected := normalizeAbsoluteDirectory(string(bytes.TrimSpace(output)))
	if selected == "" {
		return "", errors.New("pasta selecionada inválida")
	}
	return selected, nil
}

func resolveLocalProjectFolder(input localOpenProjectRequest) (string, error) {
	if binding := readLocalProjectBinding(input.ProjectID); binding != "" {
		return binding, nil
	}
	if legacy := normalizeAbsoluteDirectory(input.LegacyPath); legacy != "" {
		_ = saveLocalProjectBinding(input.ProjectID, legacy)
		return legacy, nil
	}
	if discovered := discoverProjectFolder(input.FolderName, input.ProjectName); discovered != "" {
		_ = saveLocalProjectBinding(input.ProjectID, discovered)
		return discovered, nil
	}
	if !input.AllowFolderPicker {
		return "", errors.New("pasta não localizada")
	}
	selected, err := pickNativeFolder(input.ProjectName, "")
	if err != nil {
		return "", err
	}
	_ = saveLocalProjectBinding(input.ProjectID, selected)
	return selected, nil
}

func discoverProjectFolder(folderName, projectName string) string {
	expected := strings.TrimSpace(folderName)
	if expected == "" {
		expected = strings.TrimSpace(projectName)
	}
	if expected == "" || strings.ContainsAny(expected, `\\/:*?"<>|`) {
		return ""
	}

	home := os.Getenv("USERPROFILE")
	roots := []string{
		filepath.Join(home, "source", "repos"), filepath.Join(home, "Source", "Repos"),
		filepath.Join(home, "Projects"), filepath.Join(home, "Projetos"), filepath.Join(home, "Dev"), filepath.Join(home, "Code"),
		filepath.Join(home, "Documents"), filepath.Join(home, "Desktop"),
		`C:\Projetos`, `C:\Projects`, `C:\Dev`, `C:\Code`, `D:\Projetos`, `D:\Projects`, `D:\Dev`, `D:\Code`,
	}

	for _, drive := range []string{"C:\\", "D:\\", "E:\\"} {
		direct := filepath.Join(drive, expected)
		if directoryExists(direct) {
			return filepath.Clean(direct)
		}
	}

	for _, root := range roots {
		if !directoryExists(root) {
			continue
		}
		if found := findDirectoryByLeaf(root, expected, 5, 12000); found != "" {
			return found
		}
	}
	return ""
}

func findDirectoryByLeaf(root, expected string, maxDepth, maxVisited int) string {
	root = filepath.Clean(root)
	visited := 0
	var walk func(string, int) string
	walk = func(current string, depth int) string {
		if depth > maxDepth || visited >= maxVisited {
			return ""
		}
		entries, err := os.ReadDir(current)
		if err != nil {
			return ""
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			visited++
			name := entry.Name()
			if strings.EqualFold(name, expected) {
				candidate := filepath.Join(current, name)
				if directoryExists(candidate) {
					return candidate
				}
			}
			lower := strings.ToLower(name)
			if lower == "node_modules" || lower == ".git" || lower == ".next" || lower == "bin" || lower == "obj" || lower == "windows" || strings.HasPrefix(lower, ".") {
				continue
			}
			if found := walk(filepath.Join(current, name), depth+1); found != "" {
				return found
			}
		}
		return ""
	}
	return walk(root, 0)
}

func launchLocalProject(folder string, ide localAgentIDE, projectName, projectID string) (localLaunchResult, error) {
	folder = normalizeAbsoluteDirectory(folder)
	if folder == "" {
		return localLaunchResult{}, errors.New("a pasta local do projeto é inválida ou não existe neste computador")
	}
	kind := strings.ToLower(strings.TrimSpace(ide.Kind))
	switch kind {
	case "vscode":
		exe := findVSCodeExecutable(ide.Name)
		if exe == "" {
			return localLaunchResult{}, errors.New("Visual Studio Code não foi encontrado neste Windows.")
		}
		if err := startHiddenProcess(folder, exe, "--reuse-window", folder); err != nil {
			return localLaunchResult{}, fmt.Errorf("não foi possível abrir o VS Code: %w", err)
		}
		return localLaunchResult{Path: folder, Executable: exe, Target: folder}, nil
	case "cursor":
		exe := findCursorExecutable()
		if exe == "" {
			return localLaunchResult{}, errors.New("Cursor não foi encontrado neste Windows.")
		}
		if err := startHiddenProcess(folder, exe, folder); err != nil {
			return localLaunchResult{}, fmt.Errorf("não foi possível abrir o Cursor: %w", err)
		}
		return localLaunchResult{Path: folder, Executable: exe, Target: folder}, nil
	case "delphi":
		exe := findDelphiExecutable()
		if exe == "" {
			return localLaunchResult{}, errors.New("Delphi/RAD Studio não foi encontrado neste Windows.")
		}
		target := findBestProjectFile(folder, projectName, []string{".groupproj", ".dproj", ".dpr"}, 2)
		args := []string{}
		if target != "" {
			args = append(args, target)
		}
		if err := startHiddenProcess(folder, exe, args...); err != nil {
			return localLaunchResult{}, fmt.Errorf("não foi possível abrir o Delphi: %w", err)
		}
		return localLaunchResult{Path: folder, Executable: exe, Target: target}, nil
	case "visual-studio":
		exe := findVisualStudioExecutable()
		if exe == "" {
			return localLaunchResult{}, errors.New("Visual Studio não foi encontrado neste Windows.")
		}
		target := findBestProjectFile(folder, projectName, []string{".slnx", ".sln", ".csproj", ".vbproj"}, 2)
		if target == "" {
			target = folder
		}
		if err := startHiddenProcess(folder, exe, target); err != nil {
			return localLaunchResult{}, fmt.Errorf("não foi possível abrir o Visual Studio: %w", err)
		}
		return localLaunchResult{Path: folder, Executable: exe, Target: target}, nil
	case "jetbrains":
		exe := findJetBrainsExecutable(ide.Name)
		if exe == "" {
			return localLaunchResult{}, errors.New("A IDE JetBrains configurada não foi encontrada neste Windows.")
		}
		if err := startHiddenProcess(folder, exe, folder); err != nil {
			return localLaunchResult{}, fmt.Errorf("não foi possível abrir a IDE JetBrains: %w", err)
		}
		return localLaunchResult{Path: folder, Executable: exe, Target: folder}, nil
	case "custom":
		if strings.TrimSpace(ide.CustomURITemplate) == "" {
			return localLaunchResult{}, errors.New("A IDE personalizada precisa de um launcher/protocolo configurado.")
		}
		target := expandAgentCustomURI(ide.CustomURITemplate, folder, projectName, projectID)
		cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", target)
		hideChildWindow(cmd)
		if err := cmd.Start(); err != nil {
			return localLaunchResult{}, fmt.Errorf("não foi possível executar o launcher personalizado: %w", err)
		}
		return localLaunchResult{Path: folder, Executable: "protocol", Target: target}, nil
	default:
		return localLaunchResult{}, fmt.Errorf("tipo de IDE não suportado pelo Agent: %s", ide.Kind)
	}
}

func startHiddenProcess(workingDir, executable string, args ...string) error {
	cmd := exec.Command(executable, args...)
	cmd.Dir = workingDir
	hideChildWindow(cmd)
	return cmd.Start()
}

func firstExistingFile(paths ...string) string {
	for _, candidate := range paths {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func findVSCodeExecutable(name string) string {
	local := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("ProgramFiles")
	programFiles86 := os.Getenv("ProgramFiles(x86)")
	if strings.Contains(strings.ToLower(name), "insider") {
		if exe := firstExistingFile(
			filepath.Join(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"),
			filepath.Join(programFiles, "Microsoft VS Code Insiders", "Code - Insiders.exe"),
		); exe != "" {
			return exe
		}
	}
	return firstExistingFile(
		filepath.Join(local, "Programs", "Microsoft VS Code", "Code.exe"),
		filepath.Join(programFiles, "Microsoft VS Code", "Code.exe"),
		filepath.Join(programFiles86, "Microsoft VS Code", "Code.exe"),
	)
}

func findCursorExecutable() string {
	return firstExistingFile(
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "cursor", "Cursor.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Cursor", "Cursor.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Cursor", "Cursor.exe"),
	)
}

func findDelphiExecutable() string {
	candidates := []string{}
	for _, root := range []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Embarcadero", "Studio"),
		filepath.Join(os.Getenv("ProgramFiles"), "Embarcadero", "Studio"),
	} {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			exe := filepath.Join(root, entry.Name(), "bin", "bds.exe")
			if firstExistingFile(exe) != "" {
				candidates = append(candidates, exe)
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return versionFromPath(candidates[i]) > versionFromPath(candidates[j]) })
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

func versionFromPath(path string) float64 {
	parts := strings.Split(filepath.Clean(path), string(os.PathSeparator))
	for _, part := range parts {
		if value, err := strconv.ParseFloat(part, 64); err == nil {
			return value
		}
	}
	return 0
}

func findVisualStudioExecutable() string {
	vswhere := filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft Visual Studio", "Installer", "vswhere.exe")
	if firstExistingFile(vswhere) != "" {
		cmd := exec.Command(vswhere, "-latest", "-products", "*", "-property", "productPath")
		hideChildWindow(cmd)
		if raw, err := cmd.Output(); err == nil {
			if exe := firstExistingFile(strings.TrimSpace(string(raw))); exe != "" {
				return exe
			}
		}
	}
	candidates := []string{}
	for _, year := range []string{"2022", "2019", "2017"} {
		for _, edition := range []string{"Enterprise", "Professional", "Community", "BuildTools"} {
			candidates = append(candidates,
				filepath.Join(os.Getenv("ProgramFiles"), "Microsoft Visual Studio", year, edition, "Common7", "IDE", "devenv.exe"),
				filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft Visual Studio", year, edition, "Common7", "IDE", "devenv.exe"),
			)
		}
	}
	return firstExistingFile(candidates...)
}

func findJetBrainsExecutable(ideName string) string {
	name := strings.ToLower(ideName)
	preferred := []string{}
	switch {
	case strings.Contains(name, "rider"):
		preferred = []string{"rider64.exe", "rider.exe"}
	case strings.Contains(name, "webstorm"):
		preferred = []string{"webstorm64.exe", "webstorm.exe"}
	case strings.Contains(name, "pycharm"):
		preferred = []string{"pycharm64.exe", "pycharm.exe"}
	case strings.Contains(name, "clion"):
		preferred = []string{"clion64.exe", "clion.exe"}
	case strings.Contains(name, "goland"):
		preferred = []string{"goland64.exe", "goland.exe"}
	case strings.Contains(name, "phpstorm"):
		preferred = []string{"phpstorm64.exe", "phpstorm.exe"}
	case strings.Contains(name, "datagrip"):
		preferred = []string{"datagrip64.exe", "datagrip.exe"}
	case strings.Contains(name, "rustrover"):
		preferred = []string{"rustrover64.exe", "rustrover.exe"}
	default:
		preferred = []string{"idea64.exe", "idea.exe", "rider64.exe", "webstorm64.exe", "pycharm64.exe", "clion64.exe", "goland64.exe"}
	}
	roots := []string{
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs"),
		filepath.Join(os.Getenv("ProgramFiles"), "JetBrains"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "JetBrains", "Toolbox", "apps"),
	}
	for _, binary := range preferred {
		for _, root := range roots {
			if found := findFileByName(root, binary, 7, 16000); found != "" {
				return found
			}
		}
	}
	return ""
}

func findFileByName(root, expected string, maxDepth, maxVisited int) string {
	if !directoryExists(root) {
		return ""
	}
	visited := 0
	var walk func(string, int) string
	walk = func(current string, depth int) string {
		if depth > maxDepth || visited >= maxVisited {
			return ""
		}
		entries, err := os.ReadDir(current)
		if err != nil {
			return ""
		}
		for _, entry := range entries {
			visited++
			if entry.IsDir() {
				if found := walk(filepath.Join(current, entry.Name()), depth+1); found != "" {
					return found
				}
				continue
			}
			if strings.EqualFold(entry.Name(), expected) {
				return filepath.Join(current, entry.Name())
			}
		}
		return ""
	}
	return walk(filepath.Clean(root), 0)
}

func findBestProjectFile(root, projectName string, extensions []string, maxDepth int) string {
	type candidate struct {
		path  string
		ext   int
		match int
		depth int
	}
	lowerProject := strings.ToLower(strings.TrimSpace(projectName))
	items := []candidate{}
	var walk func(string, int)
	walk = func(current string, depth int) {
		if depth > maxDepth {
			return
		}
		entries, err := os.ReadDir(current)
		if err != nil {
			return
		}
		for _, entry := range entries {
			path := filepath.Join(current, entry.Name())
			if entry.IsDir() {
				lower := strings.ToLower(entry.Name())
				if lower != "bin" && lower != "obj" && lower != "node_modules" && !strings.HasPrefix(lower, ".") {
					walk(path, depth+1)
				}
				continue
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			index := -1
			for i, allowed := range extensions {
				if ext == allowed {
					index = i
					break
				}
			}
			if index < 0 {
				continue
			}
			base := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
			match := 0
			if lowerProject != "" && (base == lowerProject || strings.Contains(lowerProject, base) || strings.Contains(base, lowerProject)) {
				match = 1
			}
			items = append(items, candidate{path: path, ext: index, match: match, depth: depth})
		}
	}
	walk(root, 0)
	if len(items) == 0 {
		return ""
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].match != items[j].match {
			return items[i].match > items[j].match
		}
		if items[i].ext != items[j].ext {
			return items[i].ext < items[j].ext
		}
		if items[i].depth != items[j].depth {
			return items[i].depth < items[j].depth
		}
		return strings.ToLower(items[i].path) < strings.ToLower(items[j].path)
	})
	return items[0].path
}

func expandAgentCustomURI(template, folder, projectName, projectID string) string {
	folderName := filepath.Base(folder)
	return strings.NewReplacer(
		"{project}", url.QueryEscape(projectName),
		"{folder}", url.QueryEscape(folderName),
		"{path}", url.QueryEscape(folder),
		"{projectId}", url.QueryEscape(projectID),
	).Replace(strings.TrimSpace(template))
}
