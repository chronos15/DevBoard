export const OPEN_FOLLOW_UP_EVENT = "devboard:open-follow-up"

export type FollowUpOpenDetail = {
  projectId?: string
  subactivityId?: string | null
}

export function openProjectFollowUp(detail: FollowUpOpenDetail = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<FollowUpOpenDetail>(OPEN_FOLLOW_UP_EVENT, { detail }))
}
