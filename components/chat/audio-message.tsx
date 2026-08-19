"use client"

import * as React from "react"
import { Loader2, Mic2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { CHAT_MEDIA_BUCKET } from "@/lib/supabase/helpers"
import { cn } from "@/lib/utils"
import { useChatMediaActivation } from "@/components/chat/use-chat-media-activation"

function durationLabel(ms?: number) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function AudioMessage({
  storagePath,
  durationMs,
  own,
}: {
  storagePath?: string
  durationMs?: number
  own?: boolean
}) {
  const supabase = React.useMemo(() => createClient(), [])
  const [url, setUrl] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const { targetRef, activated } = useChatMediaActivation<HTMLDivElement>()

  React.useEffect(() => {
    if (!activated) return

    let cancelled = false
    if (!storagePath) {
      setFailed(true)
      return
    }

    setFailed(false)
    void (async () => {
      const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(storagePath, 60 * 60)
      if (cancelled) return
      if (error || !data?.signedUrl) {
        setFailed(true)
        return
      }
      setUrl(data.signedUrl)
    })()

    return () => {
      cancelled = true
    }
  }, [activated, storagePath, supabase])

  React.useEffect(() => {
    setUrl(null)
    setFailed(false)
  }, [storagePath])

  return (
    <div ref={targetRef} className="min-w-56 max-w-full">
      <div className="mb-1 flex items-center gap-1.5 text-[0.62rem] opacity-75">
        <Mic2 className="size-3" />
        <span>Áudio · {durationLabel(durationMs)}</span>
      </div>

      <div className="flex h-9 w-[250px] max-w-full items-center overflow-hidden rounded-full bg-background/15">
        {failed ? (
          <div className="flex h-full w-full items-center gap-2 px-3 text-xs opacity-80">
            <Mic2 className="size-4 shrink-0" />
            <span>Áudio indisponível</span>
          </div>
        ) : url ? (
          <audio
            controls
            preload="metadata"
            src={url}
            className={cn("h-9 w-full", own && "[color-scheme:dark]")}
          />
        ) : (
          <div className="flex h-full w-full items-center gap-2 px-3 text-xs opacity-80">
            {activated ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Mic2 className="size-4 shrink-0" />}
            <span>{activated ? "Carregando áudio..." : "Áudio"}</span>
          </div>
        )}
      </div>
    </div>
  )
}
