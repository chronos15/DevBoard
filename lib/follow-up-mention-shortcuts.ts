import type { NotificationEntry, Project } from "@/lib/types"
import { isUserMentioned } from "@/lib/mention-groups"

export type FollowUpMentionShortcutTarget = {
  notificationId: string
  projectId: string
  activityId?: string
  subactivityId?: string
  timelineId?: string
}

type Scope = {
  projectId: string
  activityId?: string
  subactivityId?: string
}

function asTime(value?: string) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Resolve a menção NÃO LIDA mais recente dentro do escopo informado.
 *
 * Importante: esta função é somente de navegação. Ela não marca notificações
 * como lidas e não altera a regra de leitura existente do Acompanhamento.
 */
export function resolveFollowUpMentionShortcut(
  project: Project,
  notifications: NotificationEntry[],
  currentUserId: string,
  scope: Scope,
): FollowUpMentionShortcutTarget | null {
  const notification = notifications
    .filter((item) =>
      !item.readAt
      && item.recipientId === currentUserId
      && item.type === "followup-mention"
      && item.projectId === scope.projectId
      && (!scope.activityId || item.activityId === scope.activityId)
      && (!scope.subactivityId || item.subactivityId === scope.subactivityId),
    )
    .sort((a, b) => asTime(b.createdAt) - asTime(a.createdAt))[0]

  if (!notification) return null

  const activity = notification.activityId
    ? project.activities.find((item) => item.id === notification.activityId)
    : notification.subactivityId
      ? project.activities.find((item) => item.subactivities.some((sub) => sub.id === notification.subactivityId))
      : scope.activityId
        ? project.activities.find((item) => item.id === scope.activityId)
        : undefined

  const subactivity = notification.subactivityId
    ? activity?.subactivities.find((item) => item.id === notification.subactivityId)
      ?? project.activities.flatMap((item) => item.subactivities).find((item) => item.id === notification.subactivityId)
    : scope.subactivityId
      ? activity?.subactivities.find((item) => item.id === scope.subactivityId)
      : undefined

  let timelineId: string | undefined
  if (subactivity) {
    const notificationTime = asTime(notification.createdAt)
    const candidates = (subactivity.comments ?? [])
      .filter((comment) => comment.authorId !== currentUserId && isUserMentioned(comment.mentions, currentUserId))
      .map((comment) => ({ comment, distance: Math.abs(asTime(comment.createdAt) - notificationTime) }))
      .sort((a, b) => a.distance - b.distance || asTime(b.comment.createdAt) - asTime(a.comment.createdAt))

    // A notificação é criada na mesma transação da mensagem. O limite evita
    // focar uma menção antiga caso o histórico ainda não tenha carregado a
    // mensagem correspondente.
    if (candidates[0] && candidates[0].distance <= 60_000) {
      timelineId = `comment-${candidates[0].comment.id}`
    }
  }

  return {
    notificationId: notification.id,
    projectId: notification.projectId ?? scope.projectId,
    activityId: notification.activityId ?? activity?.id ?? scope.activityId,
    subactivityId: notification.subactivityId ?? subactivity?.id ?? scope.subactivityId,
    timelineId,
  }
}
