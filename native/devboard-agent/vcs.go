package main

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type localVCSProjectRequest struct {
	ProjectID         string `json:"projectId"`
	ProjectName       string `json:"projectName"`
	FolderName        string `json:"folderName"`
	LegacyPath        string `json:"legacyPath"`
	AllowFolderPicker bool   `json:"allowFolderPicker"`
}

type localVCSCommitRequest struct {
	localVCSProjectRequest
	Message            string `json:"message"`
	IncludeUnversioned bool   `json:"includeUnversioned"`
}

type localVCSLogRequest struct {
	localVCSProjectRequest
	Limit int `json:"limit"`
}

type localVCSNativeRequest struct {
	localVCSProjectRequest
	Command string `json:"command"`
	Message string `json:"message"`
}

type localVCSFile struct {
	Path       string `json:"path"`
	Status     string `json:"status"`
	Label      string `json:"label"`
	Staged     bool   `json:"staged,omitempty"`
	Conflicted bool   `json:"conflicted,omitempty"`
}

type localVCSStatus struct {
	OK              bool           `json:"ok"`
	Provider        string         `json:"provider"`
	Client          string         `json:"client"`
	Path            string         `json:"path"`
	RepoRoot        string         `json:"repoRoot"`
	Repository      string         `json:"repository"`
	Revision        string         `json:"revision"`
	Branch          string         `json:"branch"`
	Upstream        string         `json:"upstream"`
	Ahead           int            `json:"ahead"`
	Behind          int            `json:"behind"`
	ChangedCount    int            `json:"changedCount"`
	Added           int            `json:"added"`
	Modified        int            `json:"modified"`
	Removed         int            `json:"removed"`
	Untracked       int            `json:"untracked"`
	Conflicted      int            `json:"conflicted"`
	Clean           bool           `json:"clean"`
	DirectStatus    bool           `json:"directStatus"`
	DirectCommit    bool           `json:"directCommit"`
	DirectUpdate    bool           `json:"directUpdate"`
	DirectLog       bool           `json:"directLog"`
	CanPush         bool           `json:"canPush"`
	NativeAvailable bool           `json:"nativeAvailable"`
	NativeName      string         `json:"nativeName"`
	Files           []localVCSFile `json:"files"`
}

type localVCSLogEntry struct {
	ID           string `json:"id"`
	ShortID      string `json:"shortId"`
	Author       string `json:"author"`
	Date         string `json:"date"`
	Message      string `json:"message"`
	FilesChanged int    `json:"filesChanged,omitempty"`
}

type localVCSLogResult struct {
	OK              bool               `json:"ok"`
	Provider        string             `json:"provider"`
	Entries         []localVCSLogEntry `json:"entries"`
	DirectLog       bool               `json:"directLog"`
	NativeAvailable bool               `json:"nativeAvailable"`
}

type localVCSActionResult struct {
	OK           bool   `json:"ok"`
	Provider     string `json:"provider"`
	Action       string `json:"action"`
	Mode         string `json:"mode"`
	Message      string `json:"message"`
	Revision     string `json:"revision"`
	Branch       string `json:"branch"`
	Repository   string `json:"repository"`
	Output       string `json:"output"`
	NativeOpened bool   `json:"nativeOpened"`
}

type vcsRuntime struct {
	Provider     string
	Root         string
	Git          string
	SVN          string
	TortoiseProc string
}

func (input localVCSProjectRequest) resolveFolder() (string, error) {
	return resolveLocalProjectFolder(localOpenProjectRequest{
		ProjectID:         input.ProjectID,
		ProjectName:       input.ProjectName,
		FolderName:        input.FolderName,
		LegacyPath:        input.LegacyPath,
		AllowFolderPicker: input.AllowFolderPicker,
	})
}

func resolveVCSRuntime(input localVCSProjectRequest) (vcsRuntime, string, error) {
	folder, err := input.resolveFolder()
	if err != nil {
		return vcsRuntime{}, "", err
	}
	provider, root := discoverVCSRoot(folder)
	runtime := vcsRuntime{Provider: provider, Root: root, Git: findGitExecutable(), SVN: findSVNExecutable(), TortoiseProc: findTortoiseProcExecutable()}
	return runtime, folder, nil
}

func discoverVCSRoot(folder string) (string, string) {
	current := normalizeAbsoluteDirectory(folder)
	if current == "" {
		return "none", ""
	}
	for {
		if _, err := os.Stat(filepath.Join(current, ".git")); err == nil {
			return "git", current
		}
		if info, err := os.Stat(filepath.Join(current, ".svn")); err == nil && info.IsDir() {
			return "svn", current
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return "none", folder
}

func getLocalVCSStatus(input localVCSProjectRequest) (localVCSStatus, error) {
	runtime, folder, err := resolveVCSRuntime(input)
	if err != nil {
		return localVCSStatus{}, err
	}
	if runtime.Provider == "git" {
		if runtime.Git == "" {
			return localVCSStatus{OK: true, Provider: "git", Client: "none", Path: folder, RepoRoot: runtime.Root, ChangedCount: -1, NativeAvailable: false, NativeName: "Git não encontrado", Files: []localVCSFile{}}, nil
		}
		return gitStatus(runtime, folder)
	}
	if runtime.Provider == "svn" {
		return svnStatus(runtime, folder)
	}
	return localVCSStatus{
		OK:           true,
		Provider:     "none",
		Client:       "none",
		Path:         folder,
		RepoRoot:     folder,
		ChangedCount: 0,
		Clean:        true,
		Files:        []localVCSFile{},
	}, nil
}

func gitStatus(runtime vcsRuntime, folder string) (localVCSStatus, error) {
	status := localVCSStatus{
		OK: true, Provider: "git", Client: "git", Path: folder, RepoRoot: runtime.Root,
		DirectStatus: true, DirectCommit: true, DirectUpdate: true, DirectLog: true, CanPush: true,
		NativeAvailable: false, NativeName: "Git", Files: []localVCSFile{},
	}

	raw, err := runVCSCommand(runtime.Root, 12*time.Second, runtime.Git, "status", "--porcelain=v1", "--untracked-files=all")
	if err != nil {
		return status, fmt.Errorf("não foi possível consultar o status Git: %s", vcsCommandMessage(err, raw))
	}
	for _, line := range splitNonEmptyLines(raw) {
		if len(line) < 3 {
			continue
		}
		code := line[:2]
		path := strings.TrimSpace(line[3:])
		if strings.Contains(path, " -> ") {
			parts := strings.Split(path, " -> ")
			path = parts[len(parts)-1]
		}
		path = strings.Trim(path, `"`)
		file := localVCSFile{Path: path, Status: code, Label: gitStatusLabel(code), Staged: code[0] != ' ' && code[0] != '?', Conflicted: strings.ContainsAny(code, "U") || code == "AA" || code == "DD"}
		status.Files = append(status.Files, file)
		classifyVCSFile(&status, file)
	}
	status.ChangedCount = len(status.Files)
	status.Clean = status.ChangedCount == 0

	status.Branch = strings.TrimSpace(commandOutput(runtime.Root, 6*time.Second, runtime.Git, "branch", "--show-current"))
	status.Upstream = strings.TrimSpace(commandOutput(runtime.Root, 6*time.Second, runtime.Git, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"))
	status.Revision = strings.TrimSpace(commandOutput(runtime.Root, 6*time.Second, runtime.Git, "rev-parse", "--short=10", "HEAD"))
	status.Repository = strings.TrimSpace(commandOutput(runtime.Root, 6*time.Second, runtime.Git, "config", "--get", "remote.origin.url"))
	if status.Upstream != "" {
		counts := strings.Fields(commandOutput(runtime.Root, 8*time.Second, runtime.Git, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"))
		if len(counts) >= 2 {
			status.Behind, _ = strconv.Atoi(counts[0])
			status.Ahead, _ = strconv.Atoi(counts[1])
		}
	}
	return status, nil
}

func gitStatusLabel(code string) string {
	code = strings.TrimSpace(code)
	switch {
	case code == "??":
		return "Novo"
	case strings.Contains(code, "U") || code == "AA" || code == "DD":
		return "Conflito"
	case strings.Contains(code, "D"):
		return "Removido"
	case strings.Contains(code, "A"):
		return "Adicionado"
	case strings.Contains(code, "R"):
		return "Renomeado"
	default:
		return "Modificado"
	}
}

func classifyVCSFile(status *localVCSStatus, file localVCSFile) {
	if file.Conflicted {
		status.Conflicted++
		return
	}
	label := strings.ToLower(file.Label)
	switch {
	case strings.Contains(label, "novo"), strings.Contains(label, "adicionado"):
		status.Added++
		if file.Status == "??" {
			status.Untracked++
		}
	case strings.Contains(label, "remov"):
		status.Removed++
	default:
		status.Modified++
	}
}

type svnStatusXML struct {
	Targets []struct {
		Entries []struct {
			Path string `xml:"path,attr"`
			WC   struct {
				Item string `xml:"item,attr"`
			} `xml:"wc-status"`
		} `xml:"entry"`
	} `xml:"target"`
}

type svnInfoXML struct {
	Entries []struct {
		Revision string `xml:"revision,attr"`
		URL      string `xml:"url"`
	} `xml:"entry"`
}

func svnStatus(runtime vcsRuntime, folder string) (localVCSStatus, error) {
	status := localVCSStatus{
		OK: true, Provider: "svn", Path: folder, RepoRoot: runtime.Root, Files: []localVCSFile{},
		NativeAvailable: runtime.TortoiseProc != "", NativeName: "TortoiseSVN",
	}
	if runtime.SVN == "" {
		status.Client = "tortoise"
		status.ChangedCount = -1
		status.Clean = false
		status.DirectStatus = false
		status.DirectCommit = false
		status.DirectUpdate = false
		status.DirectLog = false
		return status, nil
	}

	status.Client = "svn-cli"
	status.DirectStatus = true
	status.DirectCommit = true
	status.DirectUpdate = true
	status.DirectLog = true

	raw, err := runVCSCommand(runtime.Root, 15*time.Second, runtime.SVN, "status", "--xml")
	if err != nil {
		return status, fmt.Errorf("não foi possível consultar a working copy SVN: %s", vcsCommandMessage(err, raw))
	}
	var parsed svnStatusXML
	if err := xml.Unmarshal([]byte(raw), &parsed); err != nil {
		return status, fmt.Errorf("o SVN retornou um status inválido: %w", err)
	}
	for _, target := range parsed.Targets {
		for _, entry := range target.Entries {
			item := strings.ToLower(strings.TrimSpace(entry.WC.Item))
			if item == "" || item == "normal" || item == "ignored" || item == "external" {
				continue
			}
			path := entry.Path
			if filepath.IsAbs(path) {
				if relative, relErr := filepath.Rel(runtime.Root, path); relErr == nil {
					path = relative
				}
			}
			file := localVCSFile{Path: filepath.Clean(path), Status: item, Label: svnStatusLabel(item), Conflicted: item == "conflicted" || item == "obstructed"}
			status.Files = append(status.Files, file)
			classifyVCSFile(&status, file)
		}
	}
	status.ChangedCount = len(status.Files)
	status.Clean = status.ChangedCount == 0

	infoRaw, infoErr := runVCSCommand(runtime.Root, 10*time.Second, runtime.SVN, "info", "--xml")
	if infoErr == nil {
		var info svnInfoXML
		if xml.Unmarshal([]byte(infoRaw), &info) == nil && len(info.Entries) > 0 {
			status.Revision = info.Entries[0].Revision
			if status.Revision != "" {
				status.Revision = "r" + strings.TrimPrefix(status.Revision, "r")
			}
			status.Repository = strings.TrimSpace(info.Entries[0].URL)
		}
	}
	return status, nil
}

func svnStatusLabel(item string) string {
	switch strings.ToLower(item) {
	case "unversioned":
		return "Novo"
	case "added":
		return "Adicionado"
	case "deleted", "missing":
		return "Removido"
	case "conflicted", "obstructed":
		return "Conflito"
	case "replaced":
		return "Substituído"
	default:
		return "Modificado"
	}
}

func getLocalVCSLog(input localVCSLogRequest) (localVCSLogResult, error) {
	if input.Limit <= 0 {
		input.Limit = 20
	}
	if input.Limit > 100 {
		input.Limit = 100
	}
	runtime, _, err := resolveVCSRuntime(input.localVCSProjectRequest)
	if err != nil {
		return localVCSLogResult{}, err
	}
	if runtime.Provider == "git" {
		if runtime.Git == "" {
			return localVCSLogResult{}, errors.New("Git não foi encontrado neste Windows")
		}
		return gitLog(runtime, input.Limit)
	}
	if runtime.Provider == "svn" {
		if runtime.SVN == "" {
			return localVCSLogResult{OK: true, Provider: "svn", Entries: []localVCSLogEntry{}, DirectLog: false, NativeAvailable: runtime.TortoiseProc != ""}, nil
		}
		return svnLog(runtime, input.Limit)
	}
	return localVCSLogResult{OK: true, Provider: "none", Entries: []localVCSLogEntry{}}, nil
}

func gitLog(runtime vcsRuntime, limit int) (localVCSLogResult, error) {
	format := "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e"
	raw, err := runVCSCommand(runtime.Root, 15*time.Second, runtime.Git, "log", "-n", strconv.Itoa(limit), "--date=iso-strict", "--pretty=format:"+format)
	if err != nil {
		if strings.Contains(strings.ToLower(raw), "does not have any commits") {
			return localVCSLogResult{OK: true, Provider: "git", Entries: []localVCSLogEntry{}, DirectLog: true}, nil
		}
		return localVCSLogResult{}, fmt.Errorf("não foi possível carregar o histórico Git: %s", vcsCommandMessage(err, raw))
	}
	entries := []localVCSLogEntry{}
	for _, record := range strings.Split(raw, string(rune(0x1e))) {
		record = strings.TrimSpace(record)
		if record == "" {
			continue
		}
		parts := strings.SplitN(record, string(rune(0x1f)), 5)
		if len(parts) < 5 {
			continue
		}
		entries = append(entries, localVCSLogEntry{ID: parts[0], ShortID: parts[1], Author: parts[2], Date: parts[3], Message: parts[4]})
	}
	return localVCSLogResult{OK: true, Provider: "git", Entries: entries, DirectLog: true}, nil
}

type svnLogXML struct {
	Entries []struct {
		Revision string `xml:"revision,attr"`
		Author   string `xml:"author"`
		Date     string `xml:"date"`
		Message  string `xml:"msg"`
		Paths    []struct {
			Path string `xml:",chardata"`
		} `xml:"paths>path"`
	} `xml:"logentry"`
}

func svnLog(runtime vcsRuntime, limit int) (localVCSLogResult, error) {
	raw, err := runVCSCommand(runtime.Root, 20*time.Second, runtime.SVN, "log", "--xml", "-v", "-l", strconv.Itoa(limit))
	if err != nil {
		return localVCSLogResult{}, fmt.Errorf("não foi possível carregar o histórico SVN: %s", vcsCommandMessage(err, raw))
	}
	var parsed svnLogXML
	if err := xml.Unmarshal([]byte(raw), &parsed); err != nil {
		return localVCSLogResult{}, fmt.Errorf("o SVN retornou um histórico inválido: %w", err)
	}
	entries := make([]localVCSLogEntry, 0, len(parsed.Entries))
	for _, entry := range parsed.Entries {
		id := "r" + strings.TrimPrefix(entry.Revision, "r")
		entries = append(entries, localVCSLogEntry{ID: id, ShortID: id, Author: entry.Author, Date: entry.Date, Message: strings.TrimSpace(entry.Message), FilesChanged: len(entry.Paths)})
	}
	return localVCSLogResult{OK: true, Provider: "svn", Entries: entries, DirectLog: true, NativeAvailable: runtime.TortoiseProc != ""}, nil
}

func commitLocalVCS(input localVCSCommitRequest) (localVCSActionResult, error) {
	message := strings.TrimSpace(input.Message)
	if message == "" {
		return localVCSActionResult{}, errors.New("informe uma mensagem para o commit")
	}
	if len(message) > 4000 {
		return localVCSActionResult{}, errors.New("a mensagem do commit é muito longa")
	}
	runtime, _, err := resolveVCSRuntime(input.localVCSProjectRequest)
	if err != nil {
		return localVCSActionResult{}, err
	}
	if runtime.Provider == "git" {
		if runtime.Git == "" {
			return localVCSActionResult{}, errors.New("Git não foi encontrado neste Windows")
		}
		return gitCommit(runtime, message)
	}
	if runtime.Provider == "svn" {
		if runtime.SVN != "" {
			return svnCommit(runtime, message, input.IncludeUnversioned)
		}
		if runtime.TortoiseProc != "" {
			if err := launchTortoise(runtime, "commit", message); err != nil {
				return localVCSActionResult{}, err
			}
			return localVCSActionResult{OK: true, Provider: "svn", Action: "commit", Mode: "native", Message: "Janela de commit do TortoiseSVN aberta.", NativeOpened: true}, nil
		}
		return localVCSActionResult{}, errors.New("nem svn.exe nem TortoiseSVN foram encontrados neste Windows")
	}
	return localVCSActionResult{}, errors.New("esta pasta não é uma working copy Git ou SVN")
}

func gitCommit(runtime vcsRuntime, message string) (localVCSActionResult, error) {
	status, err := gitStatus(runtime, runtime.Root)
	if err != nil {
		return localVCSActionResult{}, err
	}
	if status.Clean {
		return localVCSActionResult{}, errors.New("não existem alterações para commit")
	}
	addOutput, addErr := runVCSCommand(runtime.Root, 60*time.Second, runtime.Git, "add", "-A")
	if addErr != nil {
		return localVCSActionResult{}, fmt.Errorf("não foi possível preparar as alterações Git: %s", vcsCommandMessage(addErr, addOutput))
	}
	commitOutput, commitErr := runVCSCommand(runtime.Root, 120*time.Second, runtime.Git, "commit", "-m", message)
	if commitErr != nil {
		return localVCSActionResult{}, fmt.Errorf("o commit Git não foi concluído: %s", vcsCommandMessage(commitErr, commitOutput))
	}
	hash := strings.TrimSpace(commandOutput(runtime.Root, 8*time.Second, runtime.Git, "rev-parse", "--short=10", "HEAD"))
	branch := strings.TrimSpace(commandOutput(runtime.Root, 8*time.Second, runtime.Git, "branch", "--show-current"))
	repository := strings.TrimSpace(commandOutput(runtime.Root, 8*time.Second, runtime.Git, "config", "--get", "remote.origin.url"))
	return localVCSActionResult{OK: true, Provider: "git", Action: "commit", Mode: "direct", Message: "Commit Git realizado.", Revision: hash, Branch: branch, Repository: repository, Output: trimVCSOutput(commitOutput), NativeOpened: false}, nil
}

func svnCommit(runtime vcsRuntime, message string, includeUnversioned bool) (localVCSActionResult, error) {
	if includeUnversioned {
		// --force percorre a working copy e respeita svn:ignore. Não usamos --no-ignore.
		_, _ = runVCSCommand(runtime.Root, 60*time.Second, runtime.SVN, "add", "--force", ".")
	}
	commitOutput, commitErr := runVCSCommand(runtime.Root, 180*time.Second, runtime.SVN, "commit", ".", "-m", message, "--non-interactive")
	if commitErr != nil {
		return localVCSActionResult{}, fmt.Errorf("o commit SVN não foi concluído: %s", vcsCommandMessage(commitErr, commitOutput))
	}
	infoRaw, _ := runVCSCommand(runtime.Root, 10*time.Second, runtime.SVN, "info", "--xml")
	revision := ""
	repository := ""
	var info svnInfoXML
	if xml.Unmarshal([]byte(infoRaw), &info) == nil && len(info.Entries) > 0 {
		revision = strings.TrimSpace(info.Entries[0].Revision)
		if revision != "" {
			revision = "r" + strings.TrimPrefix(revision, "r")
		}
		repository = strings.TrimSpace(info.Entries[0].URL)
	}
	return localVCSActionResult{OK: true, Provider: "svn", Action: "commit", Mode: "direct", Message: "Commit SVN realizado.", Revision: revision, Repository: repository, Output: trimVCSOutput(commitOutput)}, nil
}

func updateLocalVCS(input localVCSProjectRequest) (localVCSActionResult, error) {
	runtime, _, err := resolveVCSRuntime(input)
	if err != nil {
		return localVCSActionResult{}, err
	}
	if runtime.Provider == "git" {
		if runtime.Git == "" {
			return localVCSActionResult{}, errors.New("Git não foi encontrado neste Windows")
		}
		output, cmdErr := runVCSCommand(runtime.Root, 180*time.Second, runtime.Git, "pull", "--ff-only")
		if cmdErr != nil {
			return localVCSActionResult{}, fmt.Errorf("o Pull não foi concluído: %s", vcsCommandMessage(cmdErr, output))
		}
		status, _ := gitStatus(runtime, runtime.Root)
		return localVCSActionResult{OK: true, Provider: "git", Action: "update", Mode: "direct", Message: "Pull concluído.", Revision: status.Revision, Branch: status.Branch, Repository: status.Repository, Output: trimVCSOutput(output)}, nil
	}
	if runtime.Provider == "svn" {
		if runtime.SVN != "" {
			output, cmdErr := runVCSCommand(runtime.Root, 180*time.Second, runtime.SVN, "update", ".", "--non-interactive")
			if cmdErr != nil {
				return localVCSActionResult{}, fmt.Errorf("o Update SVN não foi concluído: %s", vcsCommandMessage(cmdErr, output))
			}
			status, _ := svnStatus(runtime, runtime.Root)
			return localVCSActionResult{OK: true, Provider: "svn", Action: "update", Mode: "direct", Message: "Update SVN concluído.", Revision: status.Revision, Repository: status.Repository, Output: trimVCSOutput(output)}, nil
		}
		if runtime.TortoiseProc != "" {
			if err := launchTortoise(runtime, "update", ""); err != nil {
				return localVCSActionResult{}, err
			}
			return localVCSActionResult{OK: true, Provider: "svn", Action: "update", Mode: "native", Message: "Update aberto no TortoiseSVN.", NativeOpened: true}, nil
		}
	}
	return localVCSActionResult{}, errors.New("esta pasta não possui um controle de versão suportado")
}

func pushLocalVCS(input localVCSProjectRequest) (localVCSActionResult, error) {
	runtime, _, err := resolveVCSRuntime(input)
	if err != nil {
		return localVCSActionResult{}, err
	}
	if runtime.Provider != "git" {
		return localVCSActionResult{}, errors.New("Push está disponível somente para Git")
	}
	if runtime.Git == "" {
		return localVCSActionResult{}, errors.New("Git não foi encontrado neste Windows")
	}
	statusBefore, statusErr := gitStatus(runtime, runtime.Root)
	if statusErr != nil {
		return localVCSActionResult{}, statusErr
	}
	args := []string{"push"}
	if strings.TrimSpace(statusBefore.Upstream) == "" {
		if strings.TrimSpace(statusBefore.Branch) == "" {
			return localVCSActionResult{}, errors.New("não foi possível identificar a branch atual para configurar o upstream")
		}
		if strings.TrimSpace(statusBefore.Repository) == "" {
			return localVCSActionResult{}, errors.New("o projeto Git não possui remote origin configurado")
		}
		args = []string{"push", "-u", "origin", statusBefore.Branch}
	}
	output, cmdErr := runVCSCommand(runtime.Root, 180*time.Second, runtime.Git, args...)
	if cmdErr != nil {
		return localVCSActionResult{}, fmt.Errorf("o Push não foi concluído: %s", vcsCommandMessage(cmdErr, output))
	}
	status, _ := gitStatus(runtime, runtime.Root)
	return localVCSActionResult{OK: true, Provider: "git", Action: "push", Mode: "direct", Message: "Push concluído.", Revision: status.Revision, Branch: status.Branch, Repository: status.Repository, Output: trimVCSOutput(output)}, nil
}

func openLocalVCSNative(input localVCSNativeRequest) (localVCSActionResult, error) {
	runtime, _, err := resolveVCSRuntime(input.localVCSProjectRequest)
	if err != nil {
		return localVCSActionResult{}, err
	}
	if runtime.Provider != "svn" || runtime.TortoiseProc == "" {
		return localVCSActionResult{}, errors.New("TortoiseSVN não foi encontrado para este projeto")
	}
	command := strings.ToLower(strings.TrimSpace(input.Command))
	switch command {
	case "status", "log", "commit", "update":
	default:
		return localVCSActionResult{}, errors.New("ação nativa não permitida")
	}
	if err := launchTortoise(runtime, command, input.Message); err != nil {
		return localVCSActionResult{}, err
	}
	return localVCSActionResult{OK: true, Provider: "svn", Action: "native", Mode: "native", Message: "TortoiseSVN aberto.", NativeOpened: true}, nil
}

func launchTortoise(runtime vcsRuntime, command, message string) error {
	args := []string{"/command:" + command, "/path:" + runtime.Root}
	if command == "commit" && strings.TrimSpace(message) != "" {
		args = append(args, "/logmsg:"+strings.TrimSpace(message))
	}
	cmd := exec.Command(runtime.TortoiseProc, args...)
	cmd.Dir = runtime.Root
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("não foi possível abrir o TortoiseSVN: %w", err)
	}
	return nil
}

func runVCSCommand(dir string, timeout time.Duration, executable string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Dir = dir
	hideChildWindow(cmd)
	raw, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(raw))
	if ctx.Err() == context.DeadlineExceeded {
		return output, errors.New("tempo limite excedido")
	}
	return output, err
}

func commandOutput(dir string, timeout time.Duration, executable string, args ...string) string {
	output, err := runVCSCommand(dir, timeout, executable, args...)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(output)
}

func vcsCommandMessage(err error, output string) string {
	output = trimVCSOutput(output)
	if output != "" {
		return output
	}
	if err != nil {
		return err.Error()
	}
	return "erro desconhecido"
}

func trimVCSOutput(value string) string {
	value = strings.TrimSpace(value)
	const max = 12000
	if len(value) > max {
		return value[:max] + "\n…"
	}
	return value
}

func splitNonEmptyLines(value string) []string {
	lines := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func findGitExecutable() string {
	if exe, err := exec.LookPath("git.exe"); err == nil {
		return exe
	}
	if exe, err := exec.LookPath("git"); err == nil {
		return exe
	}
	return firstExistingFile(
		filepath.Join(os.Getenv("ProgramFiles"), "Git", "cmd", "git.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Git", "bin", "git.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Git", "cmd", "git.exe"),
	)
}

func findSVNExecutable() string {
	if exe, err := exec.LookPath("svn.exe"); err == nil {
		return exe
	}
	if exe, err := exec.LookPath("svn"); err == nil {
		return exe
	}
	return firstExistingFile(
		filepath.Join(os.Getenv("ProgramFiles"), "TortoiseSVN", "bin", "svn.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "TortoiseSVN", "bin", "svn.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "SlikSvn", "bin", "svn.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "SlikSvn", "bin", "svn.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "CollabNet", "Subversion Client", "svn.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "CollabNet", "Subversion Client", "svn.exe"),
	)
}

func findTortoiseProcExecutable() string {
	if exe, err := exec.LookPath("TortoiseProc.exe"); err == nil {
		return exe
	}
	return firstExistingFile(
		filepath.Join(os.Getenv("ProgramFiles"), "TortoiseSVN", "bin", "TortoiseProc.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "TortoiseSVN", "bin", "TortoiseProc.exe"),
	)
}

var safeRevisionPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,200}$`)

func safeRevision(value string) string {
	value = strings.TrimSpace(value)
	if safeRevisionPattern.MatchString(value) {
		return value
	}
	return ""
}
