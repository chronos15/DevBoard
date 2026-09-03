package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	idleAutopausePollEvery = 5 * time.Second
	idleWarningSeconds     = int64(4 * 60)
	idlePauseSeconds       = int64(5 * 60)
)

type agentRemoteActiveTimer struct {
	SubactivityID    string `json:"subactivity_id"`
	ActivityID       string `json:"activity_id"`
	ProjectID        string `json:"project_id"`
	SubactivityTitle string `json:"subactivity_title"`
	ActivityTitle    string `json:"activity_title"`
	ProjectName      string `json:"project_name"`
	TimerStartedAt   string `json:"timer_started_at"`
	SessionStartedAt string `json:"session_started_at"`
	Intermittent     bool   `json:"intermittent"`
}

type idleAutopauseMonitorState struct {
	SessionKey     string
	WarningSent    bool
	PauseAttempted bool
}

// startBackgroundIdleAutopause torna a regra de inatividade independente do
// navegador/PWA. O Agent consulta a sessão aberta diretamente no Supabase com
// seu segredo individual e pode pausá-la mesmo quando nenhuma página do
// Devboard está em execução.
func startBackgroundIdleAutopause(cfg agentConfig) {
	go func() {
		state := idleAutopauseMonitorState{}
		ticker := time.NewTicker(idleAutopausePollEvery)
		defer ticker.Stop()

		check := func() {
			claim := currentAgentSession()
			if !claim.Claimed {
				return
			}

			active, err := fetchAgentActiveTimer(cfg)
			if err != nil {
				return
			}
			if active == nil || strings.TrimSpace(active.SubactivityID) == "" {
				state = idleAutopauseMonitorState{}
				syncAgentSessionFromRemote(nil)
				return
			}

			if claim.SubactivityID != "" && claim.SubactivityID != active.SubactivityID {
				// O cronômetro ativo foi iniciado em outro dispositivo/sessão. Este
				// Agent não deve pausar uma tarefa que não foi assumida nesta máquina.
				return
			}
			if claim.SubactivityID == "" {
				// Compatibilidade durante auto-update: uma página antiga pode ter
				// sincronizado apenas título/projeto. Só adotamos o id remoto se o
				// contexto textual também corresponder.
				if !strings.EqualFold(strings.TrimSpace(claim.Title), strings.TrimSpace(active.SubactivityTitle)) ||
					!strings.EqualFold(strings.TrimSpace(claim.ProjectName), strings.TrimSpace(active.ProjectName)) {
					return
				}
			}

			syncAgentSessionFromRemote(active)
			if refreshed := currentAgentSession(); refreshed.Claimed && refreshed.SubactivityID != "" {
				_ = persistAgentSessionClaim(refreshed)
			}

			key := active.SubactivityID + "|" + active.SessionStartedAt
			if key != state.SessionKey {
				state = idleAutopauseMonitorState{SessionKey: key}
			}

			if active.Intermittent {
				state.WarningSent = false
				state.PauseAttempted = false
				return
			}

			idleSeconds := effectiveIdleSecondsForTimer(*active)
			if idleSeconds < 15 {
				// Um novo período de atividade permite um novo aviso se o usuário
				// ficar inativo novamente na mesma sessão.
				state.WarningSent = false
				state.PauseAttempted = false
			}

			if idleSeconds >= idleWarningSeconds && !state.WarningSent {
				state.WarningSent = true
				if !recentBrowserSessionFor(*active) {
					showAgentUpdateNotification(
						"Cronômetro será pausado em 1 minuto",
						fmt.Sprintf("Sem atividade no Windows. \"%s\" será pausada automaticamente aos 5 minutos.", compactNotificationText(active.SubactivityTitle, 120)),
					)
				}
			}

			if idleSeconds < idlePauseSeconds || state.PauseAttempted {
				return
			}

			state.PauseAttempted = true
			paused, err := pauseAgentTimerForIdle(cfg, active.SubactivityID, idleSeconds)
			if err != nil {
				// Permite nova tentativa no próximo ciclo. A RPC é idempotente e
				// revalida sessão, usuário e tipo intermitente no banco.
				state.PauseAttempted = false
				return
			}
			if paused {
				showAgentUpdateNotification(
					"Cronômetro pausado por inatividade",
					fmt.Sprintf("\"%s\" foi pausada após 5 minutos sem atividade no Windows.", compactNotificationText(active.SubactivityTitle, 120)),
				)
				state = idleAutopauseMonitorState{}
				// Atualiza imediatamente o estado da bandeja, sem esperar o próximo poll.
				syncAgentSessionFromRemote(nil)
				return
			}

			// Se a sessão já mudou/foi pausada por outro cliente, não insista.
			state = idleAutopauseMonitorState{}
		}

		check()
		for range ticker.C {
			check()
		}
	}()
}

func effectiveIdleSecondsForTimer(active agentRemoteActiveTimer) int64 {
	idle := currentWindowsIdleSeconds()
	if idle < 0 {
		idle = 0
	}

	startedAt := strings.TrimSpace(active.SessionStartedAt)
	if startedAt == "" {
		startedAt = strings.TrimSpace(active.TimerStartedAt)
	}
	if parsed, err := time.Parse(time.RFC3339, startedAt); err == nil {
		elapsed := int64(time.Since(parsed).Seconds())
		if elapsed < 0 {
			elapsed = 0
		}
		// Só contamos a parte da inatividade que realmente coincidiu com o
		// cronômetro em execução. Isso evita pausar uma tarefa recém-iniciada
		// quando o Windows já estava idle antes do início da sessão.
		if elapsed < idle {
			idle = elapsed
		}
	}
	return idle
}

func recentBrowserSessionFor(active agentRemoteActiveTimer) bool {
	state := currentAgentSession()
	if !state.Active || state.BrowserUpdatedAt.IsZero() || time.Since(state.BrowserUpdatedAt) > 45*time.Second {
		return false
	}
	if state.SubactivityID != "" && active.SubactivityID != "" {
		return state.SubactivityID == active.SubactivityID
	}
	return strings.EqualFold(strings.TrimSpace(state.Title), strings.TrimSpace(active.SubactivityTitle)) &&
		strings.EqualFold(strings.TrimSpace(state.ProjectName), strings.TrimSpace(active.ProjectName))
}

func compactNotificationText(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	if limit < 2 {
		return string(runes[:limit])
	}
	return string(runes[:limit-1]) + "…"
}

func fetchAgentActiveTimer(cfg agentConfig) (*agentRemoteActiveTimer, error) {
	payload := map[string]any{
		"p_agent_id":     cfg.AgentID,
		"p_agent_secret": cfg.AgentSecret,
	}
	var rows []agentRemoteActiveTimer
	if err := callAgentSupabaseRPC(cfg, "developer_agent_active_timer", payload, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}

func pauseAgentTimerForIdle(cfg agentConfig, subactivityID string, idleSeconds int64) (bool, error) {
	payload := map[string]any{
		"p_agent_id":       cfg.AgentID,
		"p_agent_secret":   cfg.AgentSecret,
		"p_subactivity_id": subactivityID,
		"p_idle_seconds":   idleSeconds,
	}
	var paused bool
	if err := callAgentSupabaseRPC(cfg, "developer_agent_pause_for_idle", payload, &paused); err != nil {
		return false, err
	}
	return paused, nil
}

func callAgentSupabaseRPC(cfg agentConfig, functionName string, payload any, output any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(cfg.SupabaseURL, "/") + "/rest/v1/rpc/" + functionName
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", cfg.SupabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DevboardAgent/"+agentVersion)

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
		return fmt.Errorf("RPC %s respondeu HTTP %d: %s", functionName, resp.StatusCode, strings.TrimSpace(string(message)))
	}
	if output == nil {
		io.Copy(io.Discard, resp.Body)
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(output); err != nil {
		return err
	}
	return nil
}
