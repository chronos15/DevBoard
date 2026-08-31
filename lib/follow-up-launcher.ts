export const OPEN_FOLLOW_UP_EVENT = "devboard:open-follow-up"

export type FollowUpOpenDetail = {
  projectId?: string
  activityId?: string | null
  subactivityId?: string | null
  timelineId?: string | null
}

export function followUpHref(detail: FollowUpOpenDetail = {}) {
  const params = new URLSearchParams()
  if (detail.projectId) params.set("project", detail.projectId)
  if (detail.activityId) params.set("activity", detail.activityId)
  if (detail.subactivityId) params.set("sub", detail.subactivityId)
  if (detail.timelineId) params.set("focus", detail.timelineId)
  const query = params.toString()
  return `/acompanhamento${query ? `?${query}` : ""}`
}

export function openProjectFollowUp(detail: FollowUpOpenDetail = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<FollowUpOpenDetail>(OPEN_FOLLOW_UP_EVENT, { detail }))
}
