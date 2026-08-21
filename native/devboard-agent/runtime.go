package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type localRuntimeRequest struct {
	ProjectID         string `json:"projectId"`
	ProjectName       string `json:"projectName"`
	FolderName        string `json:"folderName"`
	LegacyPath        string `json:"legacyPath"`
	AllowFolderPicker bool   `json:"allowFolderPicker"`
	Action            string `json:"action,omitempty"`
}

type runtimeCommand struct {
	Executable string
	Args       []string
	Label      string
}

type runtimeCapabilities struct {
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	CanRun      bool   `json:"canRun"`
	CanBuild    bool   `json:"canBuild"`
	CanTest     bool   `json:"canTest"`
	CanTerminal bool   `json:"canTerminal"`
	RunLabel    string `json:"runLabel,omitempty"`
	BuildLabel  string `json:"buildLabel,omitempty"`
	TestLabel   string `json:"testLabel,omitempty"`
}

type runtimeStatus struct {
	OK            bool                `json:"ok"`
	Path          string              `json:"path"`
	Capabilities  runtimeCapabilities `json:"capabilities"`
	Running       bool                `json:"running"`
	RunningAction string              `json:"runningAction,omitempty"`
	RunningLabel  string              `json:"runningLabel,omitempty"`
	StartedAt     string              `json:"startedAt,omitempty"`
	PID           int                 `json:"pid,omitempty"`
	ExitCode      *int                `json:"exitCode,omitempty"`
	LastResult    string              `json:"lastResult,omitempty"`
	LogTail       []string            `json:"logTail"`
}

type runtimeProcess struct {
	ProjectID string
	Action    string
	Label     string
	StartedAt time.Time
	PID       int
	Cmd       *exec.Cmd
	LogPath   string
	ExitCode  *int
	Result    string
}

var runtimeProcesses = struct {
	sync.Mutex
	items map[string]*runtimeProcess
}{items: map[string]*runtimeProcess{}}

func (input localRuntimeRequest) resolveFolder() (string, error) {
	return resolveLocalProjectFolder(localOpenProjectRequest{
		ProjectID: input.ProjectID, ProjectName: input.ProjectName, FolderName: input.FolderName,
		LegacyPath: input.LegacyPath, AllowFolderPicker: input.AllowFolderPicker,
		IDE: localAgentIDE{Kind: "custom"},
	})
}

func getLocalRuntimeStatus(input localRuntimeRequest) (runtimeStatus, error) {
	folder, err := input.resolveFolder()
	if err != nil {
		return runtimeStatus{}, err
	}
	caps, commands := detectRuntime(folder)
	status := runtimeStatus{OK: true, Path: folder, Capabilities: caps, LogTail: []string{}}
	runtimeProcesses.Lock()
	process := runtimeProcesses.items[input.ProjectID]
	if process != nil {
		status.Running = process.ExitCode == nil
		status.RunningAction = process.Action
		status.RunningLabel = process.Label
		status.StartedAt = process.StartedAt.Format(time.RFC3339)
		status.PID = process.PID
		status.ExitCode = process.ExitCode
		status.LastResult = process.Result
		status.LogTail = tailRuntimeLog(process.LogPath, 28)
		if process.ExitCode != nil && time.Since(process.StartedAt) > 20*time.Minute {
			delete(runtimeProcesses.items, input.ProjectID)
		}
	}
	runtimeProcesses.Unlock()
	_ = commands
	return status, nil
}

func runLocalRuntimeAction(input localRuntimeRequest) (runtimeStatus, error) {
	action := strings.ToLower(strings.TrimSpace(input.Action))
	if action != "run" && action != "build" && action != "test" && action != "terminal" && action != "stop" {
		return runtimeStatus{}, errors.New("ação de runtime não permitida")
	}
	folder, err := input.resolveFolder()
	if err != nil {
		return runtimeStatus{}, err
	}

	if action == "terminal" {
		if err := openProjectTerminal(folder); err != nil {
			return runtimeStatus{}, err
		}
		return getLocalRuntimeStatus(input)
	}
	if action == "stop" {
		stopRuntimeProcess(input.ProjectID)
		return getLocalRuntimeStatus(input)
	}

	caps, commands := detectRuntime(folder)
	command, ok := commands[action]
	if !ok || strings.TrimSpace(command.Executable) == "" {
		return runtimeStatus{}, fmt.Errorf("%s não está disponível para este tipo de projeto", action)
	}

	runtimeProcesses.Lock()
	if existing := runtimeProcesses.items[input.ProjectID]; existing != nil && existing.ExitCode == nil {
		runtimeProcesses.Unlock()
		return runtimeStatus{}, errors.New("já existe uma ação local em execução para este projeto")
	}
	runtimeProcesses.Unlock()

	logPath, err := runtimeLogPath(input.ProjectID)
	if err != nil {
		return runtimeStatus{}, err
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return runtimeStatus{}, err
	}
	logFile, err := os.Create(logPath)
	if err != nil {
		return runtimeStatus{}, err
	}

	cmd := exec.Command(command.Executable, command.Args...)
	cmd.Dir = folder
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	hideChildWindow(cmd)
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return runtimeStatus{}, err
	}
	process := &runtimeProcess{ProjectID: input.ProjectID, Action: action, Label: command.Label, StartedAt: time.Now(), PID: cmd.Process.Pid, Cmd: cmd, LogPath: logPath}
	runtimeProcesses.Lock()
	runtimeProcesses.items[input.ProjectID] = process
	runtimeProcesses.Unlock()

	go func() {
		err := cmd.Wait()
		_ = logFile.Close()
		exit := 0
		result := "Concluído com sucesso."
		if err != nil {
			exit = 1
			if exitErr, ok := err.(*exec.ExitError); ok {
				exit = exitErr.ExitCode()
			}
			result = fmt.Sprintf("Finalizado com código %d.", exit)
		}
		runtimeProcesses.Lock()
		if current := runtimeProcesses.items[input.ProjectID]; current == process {
			current.ExitCode = &exit
			current.Result = result
		}
		runtimeProcesses.Unlock()
	}()

	_ = caps
	return getLocalRuntimeStatus(input)
}

func stopRuntimeProcess(projectID string) {
	runtimeProcesses.Lock()
	process := runtimeProcesses.items[projectID]
	runtimeProcesses.Unlock()
	if process == nil || process.ExitCode != nil || process.PID <= 0 {
		return
	}
	cmd := exec.Command("taskkill", "/PID", fmt.Sprintf("%d", process.PID), "/T", "/F")
	hideChildWindow(cmd)
	_ = cmd.Run()
}

func detectRuntime(folder string) (runtimeCapabilities, map[string]runtimeCommand) {
	commands := map[string]runtimeCommand{}
	caps := runtimeCapabilities{Kind: "generic", Label: "Projeto local", CanTerminal: true}

	packagePath := filepath.Join(folder, "package.json")
	if data, err := os.ReadFile(packagePath); err == nil {
		var pkg struct {
			Scripts map[string]string `json:"scripts"`
		}
		if json.Unmarshal(data, &pkg) == nil {
			manager := "npm.cmd"
			managerLabel := "npm"
			if _, err := os.Stat(filepath.Join(folder, "pnpm-lock.yaml")); err == nil && executableOnPath("pnpm.cmd", "pnpm") != "" {
				manager, managerLabel = "pnpm.cmd", "pnpm"
			}
			if path := executableOnPath(manager, strings.TrimSuffix(manager, ".cmd")); path != "" {
				manager = path
			}
			caps = runtimeCapabilities{Kind: "node", Label: "Node / Web", CanTerminal: true}
			if _, ok := pkg.Scripts["dev"]; ok {
				commands["run"] = runtimeCommand{Executable: manager, Args: []string{"run", "dev"}, Label: managerLabel + " run dev"}
				caps.CanRun = true
				caps.RunLabel = "Dev"
			} else if _, ok := pkg.Scripts["start"]; ok {
				commands["run"] = runtimeCommand{Executable: manager, Args: []string{"run", "start"}, Label: managerLabel + " run start"}
				caps.CanRun = true
				caps.RunLabel = "Start"
			}
			if _, ok := pkg.Scripts["build"]; ok {
				commands["build"] = runtimeCommand{Executable: manager, Args: []string{"run", "build"}, Label: managerLabel + " run build"}
				caps.CanBuild = true
				caps.BuildLabel = "Build"
			}
			if script, ok := pkg.Scripts["test"]; ok && !strings.Contains(strings.ToLower(script), "no test specified") {
				commands["test"] = runtimeCommand{Executable: manager, Args: []string{"run", "test"}, Label: managerLabel + " run test"}
				caps.CanTest = true
				caps.TestLabel = "Testes"
			}
			return caps, commands
		}
	}

	if _, err := os.Stat(filepath.Join(folder, "pubspec.yaml")); err == nil {
		flutter := executableOnPath("flutter.bat", "flutter")
		caps = runtimeCapabilities{Kind: "flutter", Label: "Flutter", CanTerminal: true}
		if flutter != "" {
			if directoryExists(filepath.Join(folder, "windows")) {
				commands["run"] = runtimeCommand{Executable: flutter, Args: []string{"run", "-d", "windows"}, Label: "flutter run -d windows"}
				caps.CanRun = true
				caps.RunLabel = "Executar Windows"
			}
			if directoryExists(filepath.Join(folder, "web")) && !caps.CanRun {
				commands["run"] = runtimeCommand{Executable: flutter, Args: []string{"run", "-d", "chrome"}, Label: "flutter run -d chrome"}
				caps.CanRun = true
				caps.RunLabel = "Executar Web"
			}
			commands["test"] = runtimeCommand{Executable: flutter, Args: []string{"test"}, Label: "flutter test"}
			caps.CanTest = true
			caps.TestLabel = "Testes"
			if directoryExists(filepath.Join(folder, "windows")) {
				commands["build"] = runtimeCommand{Executable: flutter, Args: []string{"build", "windows"}, Label: "flutter build windows"}
			} else if directoryExists(filepath.Join(folder, "android")) {
				commands["build"] = runtimeCommand{Executable: flutter, Args: []string{"build", "apk", "--debug"}, Label: "flutter build apk --debug"}
			} else if directoryExists(filepath.Join(folder, "web")) {
				commands["build"] = runtimeCommand{Executable: flutter, Args: []string{"build", "web"}, Label: "flutter build web"}
			}
			if _, ok := commands["build"]; ok {
				caps.CanBuild = true
				caps.BuildLabel = "Build"
			}
		}
		return caps, commands
	}

	if files, _ := filepath.Glob(filepath.Join(folder, "*.sln")); len(files) > 0 || hasExtensionInRoot(folder, ".csproj") {
		dotnet := executableOnPath("dotnet.exe", "dotnet")
		caps = runtimeCapabilities{Kind: "dotnet", Label: ".NET", CanTerminal: true}
		if dotnet != "" {
			commands["build"] = runtimeCommand{Executable: dotnet, Args: []string{"build"}, Label: "dotnet build"}
			caps.CanBuild = true
			caps.BuildLabel = "Build"
			commands["test"] = runtimeCommand{Executable: dotnet, Args: []string{"test"}, Label: "dotnet test"}
			caps.CanTest = true
			caps.TestLabel = "Testes"
			commands["run"] = runtimeCommand{Executable: dotnet, Args: []string{"run"}, Label: "dotnet run"}
			caps.CanRun = true
			caps.RunLabel = "Executar"
		}
		return caps, commands
	}

	if hasExtensionInRoot(folder, ".dproj") || hasExtensionInRoot(folder, ".groupproj") || hasExtensionInRoot(folder, ".dpr") {
		caps = runtimeCapabilities{Kind: "delphi", Label: "Delphi", CanTerminal: true}
		if msbuild := executableOnPath("msbuild.exe", "msbuild"); msbuild != "" {
			target := findBestProjectFile(folder, filepath.Base(folder), []string{".groupproj", ".dproj"}, 2)
			if target != "" {
				commands["build"] = runtimeCommand{Executable: msbuild, Args: []string{target, "/t:Build", "/p:Config=Debug", "/nologo"}, Label: "MSBuild Debug"}
				caps.CanBuild = true
				caps.BuildLabel = "Build Debug"
			}
		}
		return caps, commands
	}

	return caps, commands
}

func hasExtensionInRoot(folder, extension string) bool {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), extension) {
			return true
		}
	}
	return false
}

func openProjectTerminal(folder string) error {
	if terminal := findWindowsTerminalExecutable(); terminal != "" {
		cmd := exec.Command(terminal, "-d", folder)
		hideChildWindow(cmd)
		return cmd.Start()
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-Command", "Set-Location -LiteralPath $env:DEVBOARD_PROJECT_PATH; powershell.exe")
	cmd.Env = append(os.Environ(), "DEVBOARD_PROJECT_PATH="+folder)
	cmd.Dir = folder
	return cmd.Start()
}

func runtimeLogPath(projectID string) (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA indisponível")
	}
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, projectID)
	return filepath.Join(base, "Devboard", "Agent", "runtime", clean+".log"), nil
}

func tailRuntimeLog(path string, limit int) []string {
	if strings.TrimSpace(path) == "" {
		return []string{}
	}
	file, err := os.Open(path)
	if err != nil {
		return []string{}
	}
	defer file.Close()
	lines := make([]string, 0, limit)
	scanner := bufio.NewScanner(file)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		lines = append(lines, line)
		if len(lines) > limit {
			lines = lines[len(lines)-limit:]
		}
	}
	return lines
}

func runtimeProjectIDs() []string {
	runtimeProcesses.Lock()
	defer runtimeProcesses.Unlock()
	ids := make([]string, 0, len(runtimeProcesses.items))
	for id := range runtimeProcesses.items {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func runtimeHasActiveProcess() bool {
	runtimeProcesses.Lock()
	defer runtimeProcesses.Unlock()
	for _, process := range runtimeProcesses.items {
		if process != nil && process.ExitCode == nil {
			return true
		}
	}
	return false
}
