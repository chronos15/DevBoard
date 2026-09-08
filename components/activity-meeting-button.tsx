"use client"

import * as React from "react"
import { LoaderCircle, Video } from "lucide-react"
import { useStore } from "@/lib/store"
import { primeCallAudio } from "@/lib/webrtc/audio-playback"
import { openMeetingRoom } from "@/lib/meeting-launcher"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ActivityMeetingButtonProps = {
  activityId?: string | null
  subactivityId?: string | null
  requestId?: string | null
  aqsReviewId?: string | null
  className?: string
  disabled?: boolean
  title?: string
}

export function ActivityMeetingButton({
  activityId,
  subactivityId,
  requestId,
  aqsReviewId,
  className,
  disabled = false,
  title,
}: ActivityMeetingButtonProps) {
  const { startActivityMeeting } = useStore()
  const [loading, setLoading] = React.useState(false)

  const unavailable = disabled || !activityId || loading
  const buttonTitle = title ?? (activityId
    ? "Iniciar reunião deste item"
    : "Reunião disponível após vincular uma atividade")

  async function start() {
    if (!activityId || unavailable) return
    void primeCallAudio()
    setLoading(true)
    try {
      const launch = await startActivityMeeting(activityId, "video", {
        subactivityId: subactivityId ?? undefined,
        requestId: requestId ?? undefined,
        aqsReviewId: aqsReviewId ?? undefined,
      })
      if (!launch) return
      // A sala passa a ser global/persistente. O usuário continua no contexto em
      // que iniciou a reunião e pode minimizá-la sem perder câmera/áudio.
      openMeetingRoom(launch.meetingId)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0", className)}
      onClick={() => void start()}
      disabled={unavailable}
      title={buttonTitle}
      aria-label={buttonTitle}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4" />}
    </Button>
  )
}
