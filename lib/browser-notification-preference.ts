export const BROWSER_NOTIFICATION_PREFERENCE_EVENT = "taskboard:browser-notification-preference"

function storageKey(userId: string) {
  return `taskboard:web-notification-prompt-dismissed:v1:${userId}`
}

export function isBrowserNotificationPromptDismissed(userId?: string | null) {
  if (typeof window === "undefined" || !userId) return false
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1"
  } catch {
    return false
  }
}

function emit(userId: string, dismissed: boolean) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(BROWSER_NOTIFICATION_PREFERENCE_EVENT, {
    detail: { userId, dismissed },
  }))
}

export function dismissBrowserNotificationPrompt(userId?: string | null) {
  if (typeof window === "undefined" || !userId) return
  try {
    window.localStorage.setItem(storageKey(userId), "1")
  } catch {
    // O estado em memória do componente ainda impede a repetição na sessão atual.
  }
  emit(userId, true)
}

export function resetBrowserNotificationPrompt(userId?: string | null) {
  if (typeof window === "undefined" || !userId) return
  try {
    window.localStorage.removeItem(storageKey(userId))
  } catch {
    // Sem armazenamento persistente, a permissão do próprio navegador continua válida.
  }
  emit(userId, false)
}
