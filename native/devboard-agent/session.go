package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type agentSessionSync struct {
	Active         bool                     `json:"active"`
	Title          string                   `json:"title"`
	ProjectID      string                   `json:"projectId"`
	ActivityID     string                   `json:"activityId"`
	SubactivityID  string                   `json:"subactivityId"`
	ProjectName    string                   `json:"projectName"`
	TaskPath       string                   `json:"taskPath"`
	TimerStartedAt string                   `json:"timerStartedAt"`
	LocalProject   *localOpenProjectRequest `json:"localProject,omitempty"`
}

type agentSessionState struct {
	Active           bool
	Title            string
	ProjectID        string
	ActivityID       string
	SubactivityID    string
	ProjectName      string
	TaskPath         string
	TimerStartedAt   time.Time
	LocalProject     *localOpenProjectRequest
	UpdatedAt        time.Time
	BrowserUpdatedAt time.Time
	Claimed          bool
}

var syncedSession = struct {
	sync.RWMutex
	value agentSessionState
}{}

func syncAgentSession(input agentSessionSync) {
	state := agentSessionState{
		Active:           input.Active,
		Title:            strings.TrimSpace(input.Title),
		ProjectID:        strings.TrimSpace(input.ProjectID),
		ActivityID:       strings.TrimSpace(input.ActivityID),
		SubactivityID:    strings.TrimSpace(input.SubactivityID),
		ProjectName:      strings.TrimSpace(input.ProjectName),
		TaskPath:         strings.TrimSpace(input.TaskPath),
		LocalProject:     input.LocalProject,
		UpdatedAt:        time.Now(),
		BrowserUpdatedAt: time.Now(),
		Claimed:          input.Active,
	}
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(input.TimerStartedAt)); err == nil {
		state.TimerStartedAt = parsed
	}
	syncedSession.Lock()
	syncedSession.value = state
	syncedSession.Unlock()
	if state.Active {
		_ = persistAgentSessionClaim(state)
	} else {
		clearPersistedAgentSessionClaim()
	}
}

func currentAgentSession() agentSessionState {
	syncedSession.RLock()
	defer syncedSession.RUnlock()
	return syncedSession.value
}

func syncAgentSessionFromRemote(active *agentRemoteActiveTimer) {
	if active == nil {
		syncedSession.Lock()
		current := syncedSession.value
		// Não apagamos uma sessão recém-sincronizada pelo navegador por uma
		// falha transitória. O chamador usa nil apenas quando o backend confirmou
		// ausência de timer ou após uma pausa concluída.
		syncedSession.value = agentSessionState{UpdatedAt: time.Now(), BrowserUpdatedAt: current.BrowserUpdatedAt, LocalProject: current.LocalProject}
		syncedSession.Unlock()
		clearPersistedAgentSessionClaim()
		return
	}

	state := currentAgentSession()
	localProject := state.LocalProject
	if state.ProjectID != "" && state.ProjectID != active.ProjectID {
		localProject = nil
	}

	startedAt, _ := time.Parse(time.RFC3339, strings.TrimSpace(active.TimerStartedAt))
	if startedAt.IsZero() {
		startedAt, _ = time.Parse(time.RFC3339, strings.TrimSpace(active.SessionStartedAt))
	}

	syncedSession.Lock()
	syncedSession.value = agentSessionState{
		Active:           true,
		Title:            strings.TrimSpace(active.SubactivityTitle),
		ProjectID:        strings.TrimSpace(active.ProjectID),
		ActivityID:       strings.TrimSpace(active.ActivityID),
		SubactivityID:    strings.TrimSpace(active.SubactivityID),
		ProjectName:      strings.TrimSpace(active.ProjectName),
		TaskPath:         fmt.Sprintf("/projetos/%s#sub:%s", strings.TrimSpace(active.ProjectID), strings.TrimSpace(active.SubactivityID)),
		TimerStartedAt:   startedAt,
		LocalProject:     localProject,
		UpdatedAt:        time.Now(),
		BrowserUpdatedAt: state.BrowserUpdatedAt,
		Claimed:          state.Claimed,
	}
	syncedSession.Unlock()
}

type persistedAgentSessionClaim struct {
	Active         bool   `json:"active"`
	Title          string `json:"title"`
	ProjectID      string `json:"projectId"`
	ActivityID     string `json:"activityId"`
	SubactivityID  string `json:"subactivityId"`
	ProjectName    string `json:"projectName"`
	TaskPath       string `json:"taskPath"`
	TimerStartedAt string `json:"timerStartedAt"`
}

func agentSessionClaimPath() string {
	base := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if base == "" {
		return ""
	}
	return filepath.Join(base, "Devboard", "Agent", "active-session.json")
}

func persistAgentSessionClaim(state agentSessionState) error {
	path := agentSessionClaimPath()
	if path == "" || !state.Active {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	started := ""
	if !state.TimerStartedAt.IsZero() {
		started = state.TimerStartedAt.Format(time.RFC3339)
	}
	raw, err := json.Marshal(persistedAgentSessionClaim{
		Active:         true,
		Title:          state.Title,
		ProjectID:      state.ProjectID,
		ActivityID:     state.ActivityID,
		SubactivityID:  state.SubactivityID,
		ProjectName:    state.ProjectName,
		TaskPath:       state.TaskPath,
		TimerStartedAt: started,
	})
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

func clearPersistedAgentSessionClaim() {
	path := agentSessionClaimPath()
	if path != "" {
		_ = os.Remove(path)
	}
}

func loadPersistedAgentSessionClaim() {
	path := agentSessionClaimPath()
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var saved persistedAgentSessionClaim
	if json.Unmarshal(raw, &saved) != nil || !saved.Active {
		clearPersistedAgentSessionClaim()
		return
	}
	startedAt, _ := time.Parse(time.RFC3339, strings.TrimSpace(saved.TimerStartedAt))
	syncedSession.Lock()
	syncedSession.value = agentSessionState{
		Active:         true,
		Title:          strings.TrimSpace(saved.Title),
		ProjectID:      strings.TrimSpace(saved.ProjectID),
		ActivityID:     strings.TrimSpace(saved.ActivityID),
		SubactivityID:  strings.TrimSpace(saved.SubactivityID),
		ProjectName:    strings.TrimSpace(saved.ProjectName),
		TaskPath:       strings.TrimSpace(saved.TaskPath),
		TimerStartedAt: startedAt,
		UpdatedAt:      time.Now(),
		Claimed:        true,
	}
	syncedSession.Unlock()
}

func sessionElapsedLabel(state agentSessionState) string {
	if !state.Active || state.TimerStartedAt.IsZero() {
		return ""
	}
	seconds := int(time.Since(state.TimerStartedAt).Seconds())
	if seconds < 0 {
		seconds = 0
	}
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	if hours > 0 {
		return fmt.Sprintf("%dh%02d", hours, minutes)
	}
	return fmt.Sprintf("%dmin", minutes)
}
