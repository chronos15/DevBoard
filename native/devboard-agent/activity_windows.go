package main

import (
	"sync"
	"time"
	"unsafe"
)

type lastInputInfo struct {
	CbSize uint32
	DwTime uint32
}

type agentActivityStatus struct {
	OK              bool   `json:"ok"`
	IdleSeconds     int64  `json:"idleSeconds"`
	Locked          bool   `json:"locked"`
	LastIdleSeconds int64  `json:"lastIdleSeconds"`
	LastIdleEndedAt string `json:"lastIdleEndedAt,omitempty"`
	LastIdleEventID int64  `json:"lastIdleEventId"`
}

var (
	procGetLastInputInfo = user32.NewProc("GetLastInputInfo")
	procGetTickCount     = kernel32.NewProc("GetTickCount")
	procOpenInputDesktop = user32.NewProc("OpenInputDesktop")
	procCloseDesktop     = user32.NewProc("CloseDesktop")

	activityState = struct {
		sync.RWMutex
		lastIdleSeconds int64
		lastIdleEndedAt time.Time
		lastIdleEventID int64
		previousIdle    int64
	}{}
)

const desktopSwitchDesktop = 0x0100

func currentWindowsIdleSeconds() int64 {
	info := lastInputInfo{CbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	ok, _, _ := procGetLastInputInfo.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		return 0
	}
	tick, _, _ := procGetTickCount.Call()
	// GetLastInputInfo e GetTickCount usam DWORD e compartilham o mesmo wrap (~49 dias).
	current := uint32(tick)
	return int64(uint32(current-info.DwTime)) / 1000
}

func windowsSessionLocked() bool {
	desktop, _, _ := procOpenInputDesktop.Call(0, 0, desktopSwitchDesktop)
	if desktop == 0 {
		return true
	}
	procCloseDesktop.Call(desktop)
	return false
}

func startActivityMonitor() {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			idle := currentWindowsIdleSeconds()
			activityState.Lock()
			previous := activityState.previousIdle
			// Uma queda grande do idle para poucos segundos representa retorno do usuário.
			// Guardamos a duração para que a PWA consiga perguntar sobre o intervalo mesmo
			// depois do primeiro clique que trouxe a janela para frente.
			if previous >= 60 && idle <= 5 && previous-idle >= 30 {
				activityState.lastIdleSeconds = previous
				activityState.lastIdleEndedAt = time.Now()
				activityState.lastIdleEventID++
			}
			activityState.previousIdle = idle
			activityState.Unlock()
		}
	}()
}

func getAgentActivityStatus() agentActivityStatus {
	idle := currentWindowsIdleSeconds()
	activityState.RLock()
	defer activityState.RUnlock()
	status := agentActivityStatus{
		OK:              true,
		IdleSeconds:     idle,
		Locked:          windowsSessionLocked(),
		LastIdleSeconds: activityState.lastIdleSeconds,
		LastIdleEventID: activityState.lastIdleEventID,
	}
	if !activityState.lastIdleEndedAt.IsZero() {
		status.LastIdleEndedAt = activityState.lastIdleEndedAt.Format(time.RFC3339)
	}
	return status
}
