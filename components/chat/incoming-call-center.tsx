"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Phone, PhoneOff, Video } from "lucide-react"
import { useStore } from "@/lib/store"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { primeCallAudio } from "@/lib/webrtc/audio-playback"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function IncomingCallCenter() {
  const router = useRouter()
  const {
    chatMeetings,
    members,
    currentUserId,
    answerMeetingInvite,
    notifications,
    markNotificationRead,
  } = useStore()
  const [answering, setAnswering] = React.useState<"accept" | "decline" | null>(null)

  const incoming = React.useMemo(() => {
    return chatMeetings
      .filter((meeting) => {
        if (meeting.endedAt) return false
        return meeting.memberStates.some(
          (member) => member.userId === currentUserId && member.status === "pending",
        )
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  }, [chatMeetings, currentUserId])

  if (!incoming) return null

  const caller = members.find((member) => member.id === incoming.createdBy)
  const inviteNotification = notifications.find(
    (item) => item.type === "meeting-invite" && item.meetingId === incoming.id,
  )

  async function answer(accept: boolean) {
    if (answering) return
    if (accept) void primeCallAudio()
    setAnswering(accept ? "accept" : "decline")
    try {
      const ok = await answerMeetingInvite(incoming.id, accept)
      if (!ok) return
      if (inviteNotification && !inviteNotification.readAt) {
        await markNotificationRead(inviteNotification.id)
      }
      if (accept) {
        router.push(`/chat?meeting=${encodeURIComponent(incoming.id)}&join=1`)
      }
    } finally {
      setAnswering(null)
    }
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100vw-1rem)] max-w-md overflow-hidden rounded-2xl p-0 sm:w-full"
      >
        <div className="bg-primary/[0.055] px-5 pb-5 pt-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/8">
            <MemberAvatar member={caller} className="size-14 rounded-xl ring-0" />
          </div>
          <DialogHeader className="mt-4 items-center text-center">
            <DialogTitle className="text-base">
              {incoming.mode === "video" ? "Chamada de vídeo" : "Chamada de áudio"}
            </DialogTitle>
            <DialogDescription className="max-w-sm text-center">
              <strong className="font-medium text-foreground">{caller?.name ?? "Usuário"}</strong> está chamando você para
              {incoming.title ? ` “${incoming.title}”` : " uma reunião"}. Você só entra na sala depois de atender.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-5">
          <Button
            type="button"
            variant="outline"
            className="h-12 gap-2 border-destructive/25 text-destructive hover:bg-destructive/8 hover:text-destructive"
            loading={answering === "decline"}
            loadingText="Recusando..."
            disabled={answering === "accept"}
            onClick={() => void answer(false)}
          >
            <PhoneOff className="size-4" />
            Recusar
          </Button>
          <Button
            type="button"
            className="h-12 gap-2"
            loading={answering === "accept"}
            loadingText="Entrando..."
            disabled={answering === "decline"}
            onClick={() => void answer(true)}
          >
            {incoming.mode === "video" ? <Video className="size-4" /> : <Phone className="size-4" />}
            Atender
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
