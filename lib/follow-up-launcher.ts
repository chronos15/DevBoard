export const OPEN_FOLLOW_UP_EVENT = "devboard:open-follow-up"

export type FollowUpOpenDetail = {
  projectId?: string
  subactivityId?: string | null
}

export function followUpHref(detail: FollowUpOpenDetail = {}) {
  const params = new URLSearchParams()
  if (detail.projectId) params.set("project", detail.projectId)
  if (detail.subactivityId) params.set("sub", detail.subactivityId)
  const query = params.toString()
  return `/acompanhamento${query ? `?${query}` : ""}`
}

export function openProjectFollowUp(detail: FollowUpOpenDetail = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<FollowUpOpenDetail>(OPEN_FOLLOW_UP_EVENT, { detail }))
}
