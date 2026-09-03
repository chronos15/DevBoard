"use client"

const IDLE_PERMISSION_KEY = "devboard-idle-detection-permission-v1"
export const IDLE_PERMISSION_CHANGED_EVENT = "devboard:idle-permission-changed"

export type IdleDetectionPermission = "granted" | "denied" | "unsupported" | "unknown"

type IdleDetectorStatic = {
  requestPermission?: () => Promise<"granted" | "denied">
}

export function getIdleDetectorConstructor(): (new () => EventTarget & {
  userState?: "active" | "idle"
  screenState?: "locked" | "unlocked"
  start: (options: { threshold: number; signal?: AbortSignal }) => Promise<void>
}) | null {
  if (typeof window === "undefined") return null
  return ((window as unknown as { IdleDetector?: new () => EventTarget & {
    userState?: "active" | "idle"
    screenState?: "locked" | "unlocked"
    start: (options: { threshold: number; signal?: AbortSignal }) => Promise<void>
  } }).IdleDetector) ?? null
}

export function storedIdleDetectionPermission(): IdleDetectionPermission {
  if (typeof window === "undefined") return "unknown"
  if (!getIdleDetectorConstructor()) return "unsupported"
  const value = window.localStorage.getItem(IDLE_PERMISSION_KEY)
  if (value === "granted" || value === "denied") return value
  return "unknown"
}

export function primeIdleDetectionPermission() {
  if (typeof window === "undefined") return
  const ctor = getIdleDetectorConstructor() as unknown as IdleDetectorStatic | null
  if (!ctor?.requestPermission) return
  if (storedIdleDetectionPermission() !== "unknown") return

  // Esta função é chamada diretamente a partir da ação de iniciar o cronômetro.
  // Em Chromium/PWA isso preserva o gesto do usuário necessário para o prompt.
  try {
    void ctor.requestPermission().then((permission) => {
      window.localStorage.setItem(IDLE_PERMISSION_KEY, permission)
      window.dispatchEvent(new CustomEvent(IDLE_PERMISSION_CHANGED_EVENT, { detail: permission }))
    }).catch(() => {
      // Falha/indisponibilidade não bloqueia o timer: o guard usa fallback local.
    })
  } catch {
    // Opcional; fallback local continua disponível.
  }
}
