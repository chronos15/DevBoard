import type { NotificationEntry, NotificationType } from "@/lib/types"

export type FollowUpUnreadLevel = "unread" | "mention" | null

export const FOLLOW_UP_UNREAD_NOTIFICATION_TYPES: NotificationType[] = [
  "followup-update",
  "followup-mention",
  "followup-subactivity-opened",
  "subactivity-comment",
  "subactivity-assigned",
]

const FOLLOW_UP_UNREAD_TYPE_SET = new Set<NotificationType>(FOLLOW_UP_UNREAD_NOTIFICATION_TYPES)

export function isFollowUpUnreadNotification(notification: NotificationEntry, userId?: string) {
  if (userId && notification.recipientId !== userId) return false
  return !notification.readAt && FOLLOW_UP_UNREAD_TYPE_SET.has(notification.type)
}

export function followUpUnreadLevel(notifications: NotificationEntry[]): FollowUpUnreadLevel {
  if (notifications.some((notification) => !notification.readAt && notification.type === "followup-mention")) return "mention"
  if (notifications.some((notification) => !notification.readAt && FOLLOW_UP_UNREAD_TYPE_SET.has(notification.type))) return "unread"
  return null
}

export function followUpUnreadCount(notifications: NotificationEntry[], userId?: string) {
  const contexts = new Set<string>()
  for (const notification of notifications) {
    if (!isFollowUpUnreadNotification(notification, userId)) continue
    contexts.add(
      notification.subactivityId
        ? `sub:${notification.subactivityId}`
        : notification.activityId
          ? `activity:${notification.activityId}`
          : notification.projectId
            ? `project:${notification.projectId}`
            : `notification:${notification.id}`,
    )
  }
  return contexts.size
}
