import type { ProjectLogEntry } from "@/lib/types"

const ACTIVITY_MARKER = /\[\[meeting-activity:([0-9a-f-]{36})\]\]/i
const SUBACTIVITY_MARKER = /\[\[meeting-subactivity:([0-9a-f-]{36})\]\]/i
const MEETING_MARKER = /\[\[meeting-id:([0-9a-f-]{36})\]\]/i

function isMeetingLog(log: ProjectLogEntry) {
  return log.type === "meeting-started" || log.type === "meeting-ended"
}

export function meetingLogActivityId(log: ProjectLogEntry) {
  if (!isMeetingLog(log)) return undefined
  return log.description?.match(ACTIVITY_MARKER)?.[1]
}

export function meetingLogSubactivityId(log: ProjectLogEntry) {
  if (!isMeetingLog(log)) return undefined
  return log.description?.match(SUBACTIVITY_MARKER)?.[1]
}

export function meetingLogMeetingId(log: ProjectLogEntry) {
  if (!isMeetingLog(log)) return undefined
  return log.description?.match(MEETING_MARKER)?.[1]
}

export function isActivityMeetingLog(log: ProjectLogEntry, activityId: string) {
  return meetingLogActivityId(log)?.toLowerCase() === activityId.toLowerCase()
}

export function isSubactivityMeetingLog(log: ProjectLogEntry, subactivityId: string) {
  return meetingLogSubactivityId(log)?.toLowerCase() === subactivityId.toLowerCase()
}

export function visibleMeetingLogDescription(description?: string) {
  if (!description) return undefined
  const clean = description
    .replace(ACTIVITY_MARKER, "")
    .replace(SUBACTIVITY_MARKER, "")
    .replace(MEETING_MARKER, "")
    .trim()
  return clean || undefined
}
