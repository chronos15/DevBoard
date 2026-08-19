"use client"

import * as React from "react"
import { Loader2, Mic2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { CHAT_MEDIA_BUCKET } from "@/lib/supabase/helpers"
import { cn } from "@/lib/utils"

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

  React.useEffect(() => {
    let cancelled = false
    if (!storagePath) {
      setFailed(true)
      return
    }
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
  }, [storagePath, supabase])

  if (failed) {
    return (
      <div className="flex min-w-48 items-center gap-2 py-1 text-xs opacity-80">
        <Mic2 className="size-4" />
        <span>Áudio indisponível</span>
      </div>
    )
  }

  if (!url) {
    return (
      <div className="flex min-w-48 items-center gap-2 py-1 text-xs opacity-80">
        <Loader2 className="size-4 animate-spin" />
        <span>Carregando áudio...</span>
      </div>
    )
  }

  return (
    <div className="min-w-56 max-w-full">
      <div className="mb-1 flex items-center gap-1.5 text-[0.62rem] opacity-75">
        <Mic2 className="size-3" />
        <span>Áudio · {durationLabel(durationMs)}</span>
      </div>
      <audio
        controls
        preload="metadata"
        src={url}
        className={cn("h-9 w-[250px] max-w-full", own && "[color-scheme:dark]")}
      />
    </div>
  )
}
