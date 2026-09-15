"use client"

export const ACTIVE_FOLLOW_UP_CONTEXT_EVENT = "taskboard:active-followup-context"

const STORAGE_PREFIX = "taskboard-active-followup-v1:"
const HEARTBEAT_MAX_AGE_MS = 15_000

export type ActiveFollowUpContext = {
  userId: string
  projectId: string
  activityId?: string
  subactivityId?: string
  updatedAt: number
  visible: boolean
}

let memoryContext: ActiveFollowUpContext | null = null
let memorySessionId = ""

function sessionId() {
  if (typeof window === "undefined") return "server"
  if (memorySessionId) return memorySessionId

  // Deliberadamente não persistimos o id em sessionStorage. Alguns navegadores
  // clonam sessionStorage ao abrir uma nova janela; um id apenas em memória
  // garante uma chave independente por aba/PWA e evita que uma janela remova o
  // heartbeat de outra durante o cleanup.
  memorySessionId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return memorySessionId
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}:${sessionId()}`
}

function validContext(value: unknown): value is ActiveFollowUpContext {
  if (!value || typeof value !== "object") return false
  const context = value as Partial<ActiveFollowUpContext>
  return typeof context.userId === "string"
    && typeof context.projectId === "string"
    && typeof context.updatedAt === "number"
    && typeof context.visible === "boolean"
}

function matchesContext(
  context: ActiveFollowUpContext,
  scope: { projectId?: string; activityId?: string; subactivityId?: string },
  userId: string,
  now = Date.now(),
) {
  if (!context.visible || context.userId !== userId) return false
  if (now - context.updatedAt > HEARTBEAT_MAX_AGE_MS) return false
  if (!scope.projectId || context.projectId !== scope.projectId) return false

  // Subatividade é o contexto mais específico. Quando a notificação pertence a
  // uma subatividade, só suprimimos se exatamente aquela conversa estiver aberta.
  if (scope.subactivityId) return context.subactivityId === scope.subactivityId
  if (scope.activityId) return context.activityId === scope.activityId
  return true
}

export function publishActiveFollowUpContext(
  context: Omit<ActiveFollowUpContext, "updatedAt" | "visible"> | null,
) {
  if (typeof window === "undefined") return

  const previous = memoryContext
  if (!context) {
    memoryContext = null
    if (previous?.userId) {
      try { window.localStorage.removeItem(storageKey(previous.userId)) } catch {}
    }
    window.dispatchEvent(new CustomEvent(ACTIVE_FOLLOW_UP_CONTEXT_EVENT, { detail: null }))
    return
  }

  const next: ActiveFollowUpContext = {
    ...context,
    updatedAt: Date.now(),
    visible: document.visibilityState === "visible",
  }
  memoryContext = next

  try {
    window.localStorage.setItem(storageKey(next.userId), JSON.stringify(next))
  } catch {
    // O contexto em memória continua atendendo a janela atual mesmo quando o
    // navegador bloqueia localStorage (modo privado/restrito).
  }

  window.dispatchEvent(new CustomEvent(ACTIVE_FOLLOW_UP_CONTEXT_EVENT, { detail: next }))
}

export function clearActiveFollowUpContext(userId?: string) {
  if (typeof window === "undefined") return
  const targetUserId = userId || memoryContext?.userId
  memoryContext = null
  if (targetUserId) {
    try { window.localStorage.removeItem(storageKey(targetUserId)) } catch {}
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_FOLLOW_UP_CONTEXT_EVENT, { detail: null }))
}

export function isFollowUpContextActive(
  scope: { projectId?: string; activityId?: string; subactivityId?: string },
  userId: string,
) {
  if (typeof window === "undefined" || !userId || !scope.projectId) return false
  const now = Date.now()
  if (memoryContext && matchesContext(memoryContext, scope, userId, now)) return true

  // Cada aba/PWA mantém sua própria chave. Assim uma aba em background não
  // impede a aba realmente visível de informar às demais que a conversa já está
  // sendo acompanhada, evitando notificações duplicadas entre janelas.
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key || !key.startsWith(`${STORAGE_PREFIX}${userId}:`)) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as unknown
        if (!validContext(parsed)) continue
        if (now - parsed.updatedAt > HEARTBEAT_MAX_AGE_MS) {
          window.localStorage.removeItem(key)
          index -= 1
          continue
        }
        if (matchesContext(parsed, scope, userId, now)) return true
      } catch {
        window.localStorage.removeItem(key)
        index -= 1
      }
    }
  } catch {
    // Sem armazenamento compartilhado entre abas, usamos apenas a janela atual.
  }

  return false
}
