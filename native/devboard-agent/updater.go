package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	updateInitialDelay = 20 * time.Second
	updateCheckEvery   = 15 * time.Minute
	updateMaxSize      = 64 * 1024 * 1024
)

type agentUpdateManifest struct {
	Version     string `json:"version"`
	DownloadURL string `json:"download_url"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
}

type agentUpdateStatus struct {
	State          string     `json:"state"`
	CurrentVersion string     `json:"current_version,omitempty"`
	TargetVersion  string     `json:"target_version,omitempty"`
	Message        string     `json:"message,omitempty"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
}

func startAutoUpdater(cfg agentConfig) {
	go func() {
		time.Sleep(updateInitialDelay)
		for {
			_ = checkAndApplyAgentUpdate(cfg)
			time.Sleep(updateCheckEvery)
		}
	}()
}

func checkAndApplyAgentUpdate(cfg agentConfig) error {
	manifest, err := fetchAgentUpdateManifest(cfg.AppURL)
	if err != nil {
		return err
	}
	if compareAgentVersions(manifest.Version, agentVersion) <= 0 {
		return nil
	}

	previous := readAgentUpdateStatus()
	if previous.State == "failed" && previous.TargetVersion == manifest.Version && previous.FinishedAt != nil && time.Since(*previous.FinishedAt) < 2*time.Hour {
		// Evita bombardear o usuário quando a mesma versão falha por um problema
		// transitório. O Agent continua funcional e tenta novamente depois.
		return nil
	}

	// Nunca reinicia o Agent no meio de Commit/Update/Push, abertura de IDE ou
	// seletor de pasta. Se houver uma operação local ativa, aguardamos em silêncio.
	if !waitForAgentOperationsIdle(10 * time.Minute) {
		return errors.New("atualização adiada porque o Agent continua ocupado")
	}

	now := time.Now()
	status := agentUpdateStatus{
		State:          "updating",
		CurrentVersion: agentVersion,
		TargetVersion:  manifest.Version,
		Message:        "Baixando e preparando a nova versão do Devboard Agent.",
		StartedAt:      &now,
	}
	_ = writeAgentUpdateStatus(status)
	showAgentUpdateNotification("Atualizando Agent", fmt.Sprintf("Preparando atualização para v%s...", manifest.Version))

	if err := downloadAndStageAgentUpdate(cfg, manifest); err != nil {
		finished := time.Now()
		failed := status
		failed.State = "failed"
		failed.Message = err.Error()
		failed.FinishedAt = &finished
		_ = writeAgentUpdateStatus(failed)
		showAgentUpdateNotification("Atualização do Agent falhou", "O Devboard continuará usando a versão atual e tentará novamente mais tarde.")
		return err
	}

	// A partir daqui o executável auxiliar assume a substituição do binário.
	// Saímos somente depois que ele iniciou corretamente.
	os.Exit(0)
	return nil
}

func waitForAgentOperationsIdle(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if localActiveOperations.Load() == 0 && !runtimeHasActiveProcess() {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return localActiveOperations.Load() == 0 && !runtimeHasActiveProcess()
}

func fetchAgentUpdateManifest(appURL string) (agentUpdateManifest, error) {
	var manifest agentUpdateManifest
	base, err := url.Parse(strings.TrimSpace(appURL))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return manifest, errors.New("URL do Devboard inválida para atualização automática")
	}
	manifestURL := strings.TrimRight(appURL, "/") + "/api/dev-agent/update"
	req, err := http.NewRequest(http.MethodGet, manifestURL, nil)
	if err != nil {
		return manifest, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DevboardAgent/"+agentVersion)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return manifest, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return manifest, fmt.Errorf("manifesto de atualização respondeu HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&manifest); err != nil {
		return manifest, err
	}
	if strings.TrimSpace(manifest.Version) == "" || strings.TrimSpace(manifest.DownloadURL) == "" || len(strings.TrimSpace(manifest.SHA256)) != 64 {
		return manifest, errors.New("manifesto de atualização incompleto")
	}
	return manifest, nil
}

func downloadAndStageAgentUpdate(cfg agentConfig, manifest agentUpdateManifest) error {
	downloadURL, err := trustedAgentUpdateURL(cfg.AppURL, manifest.DownloadURL)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodGet, downloadURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "DevboardAgent/"+agentVersion)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download da atualização respondeu HTTP %d", resp.StatusCode)
	}

	template, err := io.ReadAll(io.LimitReader(resp.Body, updateMaxSize+1))
	if err != nil {
		return err
	}
	if len(template) == 0 || len(template) > updateMaxSize {
		return errors.New("arquivo de atualização possui tamanho inválido")
	}
	if manifest.Size > 0 && int64(len(template)) != manifest.Size {
		return errors.New("tamanho da atualização não corresponde ao manifesto")
	}
	if len(template) < 2 || template[0] != 'M' || template[1] != 'Z' {
		return errors.New("arquivo baixado não é um executável Windows válido")
	}
	hash := sha256.Sum256(template)
	if !strings.EqualFold(hex.EncodeToString(hash[:]), strings.TrimSpace(manifest.SHA256)) {
		return errors.New("assinatura SHA-256 da atualização é inválida")
	}

	cfg.AgentVersion = manifest.Version
	configBytes, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	payload := make([]byte, 0, len(template)+len(configMarker)+len(configBytes))
	payload = append(payload, template...)
	payload = append(payload, []byte(configMarker)...)
	payload = append(payload, configBytes...)

	updatesDir, err := agentUpdatesDirectory()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(updatesDir, 0o755); err != nil {
		return err
	}
	staged := filepath.Join(updatesDir, "DevboardAgent-"+sanitizeUpdateVersion(manifest.Version)+".exe")
	tmp := staged + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o755); err != nil {
		return err
	}
	_ = os.Remove(staged)
	if err := os.Rename(tmp, staged); err != nil {
		return err
	}

	stagedCfg, err := readEmbeddedConfigFromPath(staged)
	if err != nil || stagedCfg.AgentID != cfg.AgentID || stagedCfg.AgentSecret != cfg.AgentSecret {
		_ = os.Remove(staged)
		return errors.New("configuração da atualização não pôde ser validada")
	}

	installed, err := installedExecutablePath()
	if err != nil {
		return err
	}
	cmd := exec.Command(
		staged,
		"--apply-update",
		"--target", installed,
		"--parent-pid", strconv.Itoa(os.Getpid()),
		"--target-version", manifest.Version,
	)
	cmd.Dir = updatesDir
	hideChildWindow(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("não foi possível iniciar o atualizador: %w", err)
	}

	// Dá alguns milissegundos para o helper inicializar antes de encerrar o processo atual.
	time.Sleep(350 * time.Millisecond)
	return nil
}

func applyAgentUpdateMode(cfg agentConfig, installedExe string) {
	target := commandArgValue("--target")
	parentPID, _ := strconv.Atoi(commandArgValue("--parent-pid"))
	targetVersion := strings.TrimSpace(commandArgValue("--target-version"))
	if target == "" || !samePath(target, installedExe) || parentPID <= 0 || targetVersion == "" {
		return
	}

	self, err := os.Executable()
	if err != nil {
		return
	}
	self, _ = filepath.Abs(self)

	// Aguarda o processo anterior liberar o executável instalado. O replace em si
	// também possui retry, porque antivírus pode segurar o arquivo por alguns instantes.
	waitForAgentProcessExit(parentPID, 12*time.Second)

	backup := installedExe + ".bak"
	var replaceErr error
	deadline := time.Now().Add(18 * time.Second)
	for time.Now().Before(deadline) {
		replaceErr = replaceInstalledAgent(self, installedExe, backup)
		if replaceErr == nil {
			break
		}
		time.Sleep(450 * time.Millisecond)
	}
	if replaceErr != nil {
		restoreAgentBackup(installedExe, backup)
		finished := time.Now()
		_ = writeAgentUpdateStatus(agentUpdateStatus{
			State:          "failed",
			CurrentVersion: agentVersion,
			TargetVersion:  targetVersion,
			Message:        "Não foi possível substituir o executável instalado.",
			FinishedAt:     &finished,
		})
		showAgentUpdateNotification("Atualização do Agent falhou", "Não foi possível substituir o Agent. A versão anterior será mantida.")
		_ = launchInstalledAgent(installedExe)
		return
	}

	if err := launchInstalledAgent(installedExe); err != nil {
		restoreAgentBackup(installedExe, backup)
		_ = launchInstalledAgent(installedExe)
		finished := time.Now()
		_ = writeAgentUpdateStatus(agentUpdateStatus{
			State:          "failed",
			CurrentVersion: agentVersion,
			TargetVersion:  targetVersion,
			Message:        "A nova versão foi instalada, mas não conseguiu iniciar.",
			FinishedAt:     &finished,
		})
		showAgentUpdateNotification("Atualização do Agent falhou", "A nova versão não iniciou e o Devboard restaurou a versão anterior.")
		return
	}

	if !waitForLocalAgentVersion(cfg, targetVersion, 14*time.Second) {
		_ = exec.Command("taskkill", "/IM", "DevboardAgent.exe", "/F").Run()
		time.Sleep(450 * time.Millisecond)
		restoreAgentBackup(installedExe, backup)
		_ = launchInstalledAgent(installedExe)
		finished := time.Now()
		_ = writeAgentUpdateStatus(agentUpdateStatus{
			State:          "failed",
			CurrentVersion: agentVersion,
			TargetVersion:  targetVersion,
			Message:        "A nova versão não respondeu ao teste de saúde e foi revertida.",
			FinishedAt:     &finished,
		})
		showAgentUpdateNotification("Atualização do Agent falhou", "A nova versão não respondeu corretamente. A versão anterior foi restaurada.")
		return
	}

	finished := time.Now()
	_ = writeAgentUpdateStatus(agentUpdateStatus{
		State:          "completed",
		CurrentVersion: targetVersion,
		TargetVersion:  targetVersion,
		Message:        "Devboard Agent atualizado com sucesso.",
		FinishedAt:     &finished,
	})
	showAgentUpdateNotification("Atualização finalizada", fmt.Sprintf("Devboard Agent v%s atualizado com sucesso.", targetVersion))
}

func replaceInstalledAgent(source, target, backup string) error {
	if _, err := os.Stat(target); err == nil {
		_ = os.Remove(backup)
		if err := copyFile(target, backup); err != nil {
			return err
		}
	}

	newPath := target + ".new"
	_ = os.Remove(newPath)
	if err := copyFile(source, newPath); err != nil {
		return err
	}
	if _, err := readEmbeddedConfigFromPath(newPath); err != nil {
		_ = os.Remove(newPath)
		return err
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(newPath)
		return err
	}
	if err := os.Rename(newPath, target); err != nil {
		restoreAgentBackup(target, backup)
		return err
	}
	_ = registerAutoStart(target)
	_ = registerProtocol(target)
	return nil
}

func restoreAgentBackup(target, backup string) {
	if _, err := os.Stat(backup); err != nil {
		return
	}
	_ = os.Remove(target)
	_ = copyFile(backup, target)
	_ = registerAutoStart(target)
	_ = registerProtocol(target)
}

func waitForAgentProcessExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH")
		hideChildWindow(cmd)
		output, err := cmd.Output()
		if err != nil || !bytes.Contains(output, []byte(strconv.Itoa(pid))) {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func waitForLocalAgentVersion(cfg agentConfig, expected string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 1200 * time.Millisecond}
	for time.Now().Before(deadline) {
		req, _ := http.NewRequest(http.MethodGet, "http://"+localAgentAddress+"/v1/health", nil)
		req.Header.Set("X-Devboard-Agent", "1")
		req.Header.Set("Origin", strings.TrimRight(cfg.AppURL, "/"))
		resp, err := client.Do(req)
		if err == nil && resp != nil {
			var body struct {
				OK      bool   `json:"ok"`
				Version string `json:"version"`
			}
			_ = json.NewDecoder(io.LimitReader(resp.Body, 32*1024)).Decode(&body)
			resp.Body.Close()
			if body.OK && compareAgentVersions(body.Version, expected) >= 0 {
				return true
			}
		}
		time.Sleep(450 * time.Millisecond)
	}
	return false
}

func trustedAgentUpdateURL(appURL, raw string) (string, error) {
	base, err := url.Parse(strings.TrimSpace(appURL))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", errors.New("origem do Devboard inválida")
	}
	candidate, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", errors.New("URL de atualização inválida")
	}
	resolved := base.ResolveReference(candidate)
	if !strings.EqualFold(resolved.Scheme, base.Scheme) || !strings.EqualFold(resolved.Host, base.Host) {
		return "", errors.New("o manifesto tentou usar uma origem de download não autorizada")
	}
	if !strings.EqualFold(resolved.Scheme, "https") {
		host := strings.ToLower(resolved.Hostname())
		if host != "localhost" && host != "127.0.0.1" {
			return "", errors.New("atualizações automáticas exigem HTTPS")
		}
	}
	return resolved.String(), nil
}

func compareAgentVersions(a, b string) int {
	pa := parseAgentVersion(a)
	pb := parseAgentVersion(b)
	for i := 0; i < 3; i++ {
		if pa[i] < pb[i] {
			return -1
		}
		if pa[i] > pb[i] {
			return 1
		}
	}
	return 0
}

func parseAgentVersion(value string) [3]int {
	var out [3]int
	clean := strings.TrimSpace(strings.TrimPrefix(strings.ToLower(value), "v"))
	parts := strings.Split(clean, ".")
	for i := 0; i < len(parts) && i < 3; i++ {
		n, _ := strconv.Atoi(strings.TrimSpace(parts[i]))
		out[i] = n
	}
	return out
}

func sanitizeUpdateVersion(value string) string {
	value = strings.TrimSpace(value)
	value = strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "-").Replace(value)
	if value == "" {
		return "update"
	}
	return value
}

func agentUpdatesDirectory() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA indisponível")
	}
	return filepath.Join(base, "Devboard", "Agent", "updates"), nil
}

func agentUpdateStatusPath() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA indisponível")
	}
	return filepath.Join(base, "Devboard", "Agent", "update-status.json"), nil
}

func writeAgentUpdateStatus(status agentUpdateStatus) error {
	path, err := agentUpdateStatusPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(status)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	_ = os.Remove(path)
	return os.Rename(tmp, path)
}

func readAgentUpdateStatus() agentUpdateStatus {
	status := agentUpdateStatus{State: "idle", CurrentVersion: agentVersion}
	path, err := agentUpdateStatusPath()
	if err != nil {
		return status
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return status
	}
	if json.Unmarshal(raw, &status) != nil || strings.TrimSpace(status.State) == "" {
		return agentUpdateStatus{State: "idle", CurrentVersion: agentVersion}
	}
	return status
}

func cleanupAgentUpdateArtifacts() {
	dir, err := agentUpdatesDirectory()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

func commandArgValue(name string) string {
	for index, arg := range os.Args {
		if strings.EqualFold(arg, name) && index+1 < len(os.Args) {
			return os.Args[index+1]
		}
	}
	return ""
}

func readEmbeddedConfigFromPath(path string) (agentConfig, error) {
	var cfg agentConfig
	raw, err := os.ReadFile(path)
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

func showAgentUpdateNotification(title, message string) {
	// Balloon nativo do Windows sem depender do Devboard/PWA estar aberto. A janela
	// do PowerShell fica oculta e o ícone temporário é descartado após o aviso.
	const script = `$ErrorActionPreference='SilentlyContinue'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle=$env:DEVBOARD_NOTIFY_TITLE; $n.BalloonTipText=$env:DEVBOARD_NOTIFY_TEXT; $n.Visible=$true; $n.ShowBalloonTip(4500); Start-Sleep -Milliseconds 4800; $n.Dispose();`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = append(os.Environ(), "DEVBOARD_NOTIFY_TITLE="+title, "DEVBOARD_NOTIFY_TEXT="+message)
	hideChildWindow(cmd)
	_ = cmd.Start()
}
