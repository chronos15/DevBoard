"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LoaderCircle, Video } from "lucide-react"
import { useStore } from "@/lib/store"
import { primeCallAudio } from "@/lib/webrtc/audio-playback"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ActivityMeetingButtonProps = {
  activityId?: string | null
  className?: string
  disabled?: boolean
  title?: string
}

export function ActivityMeetingButton({
  activityId,
  className,
  disabled = false,
  title,
}: ActivityMeetingButtonProps) {
  const router = useRouter()
  const { startActivityMeeting } = useStore()
  const [loading, setLoading] = React.useState(false)

  const unavailable = disabled || !activityId || loading
  const buttonTitle = title ?? (activityId
    ? "Iniciar reunião desta atividade"
    : "Reunião disponível após vincular uma atividade")

  async function start() {
    if (!activityId || unavailable) return
    void primeCallAudio()
    setLoading(true)
    try {
      const launch = await startActivityMeeting(activityId, "video")
      if (!launch) return
      const params = new URLSearchParams({
        conversation: launch.conversationId,
        meeting: launch.meetingId,
      })
      router.push(`/chat?${params.toString()}`)
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
