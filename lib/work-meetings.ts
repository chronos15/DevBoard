import type { ProjectLogEntry } from "@/lib/types"

const ACTIVITY_MARKER = /\[\[meeting-activity:([0-9a-f-]{36})\]\]/i

export function meetingLogActivityId(log: ProjectLogEntry) {
  if (log.type !== "meeting-started" && log.type !== "meeting-ended") return undefined
  return log.description?.match(ACTIVITY_MARKER)?.[1]
}

export function isActivityMeetingLog(log: ProjectLogEntry, activityId: string) {
  return meetingLogActivityId(log)?.toLowerCase() === activityId.toLowerCase()
}

export function visibleMeetingLogDescription(description?: string) {
  if (!description) return undefined
  const clean = description.replace(ACTIVITY_MARKER, "").trim()
  return clean || undefined
}
