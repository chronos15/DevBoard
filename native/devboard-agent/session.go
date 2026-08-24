package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type agentSessionSync struct {
	Active         bool                     `json:"active"`
	Title          string                   `json:"title"`
	ProjectName    string                   `json:"projectName"`
	TaskPath       string                   `json:"taskPath"`
	TimerStartedAt string                   `json:"timerStartedAt"`
	LocalProject   *localOpenProjectRequest `json:"localProject,omitempty"`
}

type agentSessionState struct {
	Active         bool
	Title          string
	ProjectName    string
	TaskPath       string
	TimerStartedAt time.Time
	LocalProject   *localOpenProjectRequest
	UpdatedAt      time.Time
}

var syncedSession = struct {
	sync.RWMutex
	value agentSessionState
}{}

func syncAgentSession(input agentSessionSync) {
	state := agentSessionState{
		Active:       input.Active,
		Title:        strings.TrimSpace(input.Title),
		ProjectName:  strings.TrimSpace(input.ProjectName),
		TaskPath:     strings.TrimSpace(input.TaskPath),
		LocalProject: input.LocalProject,
		UpdatedAt:    time.Now(),
	}
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(input.TimerStartedAt)); err == nil {
		state.TimerStartedAt = parsed
	}
	syncedSession.Lock()
	syncedSession.value = state
	syncedSession.Unlock()
}

func currentAgentSession() agentSessionState {
	syncedSession.RLock()
	defer syncedSession.RUnlock()
	return syncedSession.value
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
