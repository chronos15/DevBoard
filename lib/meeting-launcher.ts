export const OPEN_MEETING_EVENT = "devboard:open-meeting"
export const MINIMIZE_MEETING_EVENT = "devboard:minimize-meeting"

export type MeetingOpenDetail = {
  meetingId: string
  minimized?: boolean
}

export function openMeetingRoom(meetingId: string, minimized = false) {
  if (typeof window === "undefined" || !meetingId) return
  window.dispatchEvent(new CustomEvent<MeetingOpenDetail>(OPEN_MEETING_EVENT, {
    detail: { meetingId, minimized },
  }))
}

export function minimizeMeetingRoom() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(MINIMIZE_MEETING_EVENT))
}
