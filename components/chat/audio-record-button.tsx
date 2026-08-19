"use client"

import * as React from "react"
import { Loader2, Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const HOLD_TO_RECORD_MS = 1000

function elapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

function bestMimeType() {
  if (typeof MediaRecorder === "undefined") return ""
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
}

export function AudioRecordButton({
  disabled,
  onRecorded,
}: {
  disabled?: boolean
  onRecorded: (audio: Blob, durationMs: number) => Promise<boolean>
}) {
  const [recording, setRecording] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [elapsedMs, setElapsedMs] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const holdTimerRef = React.useRef<number | null>(null)
  const tickRef = React.useRef<number | null>(null)
  const heldRef = React.useRef(false)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<BlobPart[]>([])
  const startedAtRef = React.useRef(0)
  const pointerIdRef = React.useRef<number | null>(null)
  const disposedRef = React.useRef(false)

  const clearHoldTimer = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const clearTick = React.useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const startRecording = React.useCallback(async () => {
    if (!heldRef.current || disabled || sending || recording) return
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Seu navegador não permite gravação de áudio.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      if (!heldRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      chunksRef.current = []
      const mimeType = bestMimeType()
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64000,
      })
      recorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setError("A gravação foi interrompida pelo navegador.")
      }
      recorder.onstop = async () => {
        clearTick()
        setRecording(false)
        stopTracks()
        const durationMs = Math.max(1, performance.now() - startedAtRef.current)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" })
        chunksRef.current = []
        recorderRef.current = null
        if (!blob.size || disposedRef.current) return
        setSending(true)
        try {
          const ok = await onRecorded(blob, durationMs)
          if (!ok) setError("Não foi possível enviar o áudio.")
        } finally {
          setSending(false)
          setElapsedMs(0)
        }
      }

      startedAtRef.current = performance.now()
      setElapsedMs(0)
      setRecording(true)
      recorder.start(250)
      tickRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAtRef.current)
      }, 200)
    } catch (cause) {
      stopTracks()
      const name = cause instanceof DOMException ? cause.name : ""
      setError(name === "NotAllowedError" ? "Permita o uso do microfone para gravar áudio." : "Não foi possível acessar o microfone.")
    }
  }, [clearTick, disabled, onRecorded, recording, sending, stopTracks])

  const finishHold = React.useCallback(() => {
    heldRef.current = false
    clearHoldTimer()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.requestData()
      recorder.stop()
    }
  }, [clearHoldTimer])

  React.useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      heldRef.current = false
    clearHoldTimer()
    clearTick()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") recorder.stop()
      stopTracks()
    }
  }, [clearHoldTimer, clearTick, stopTracks])

  return (
    <div className="relative shrink-0">
      {recording && (
        <div className="absolute right-0 bottom-full mb-2 flex items-center gap-2 rounded-xl border border-destructive/20 bg-card px-3 py-2 text-xs shadow-lg">
          <span className="size-2 animate-pulse rounded-full bg-destructive" />
          <span className="font-medium text-destructive">Gravando</span>
          <span className="font-mono text-muted-foreground">{elapsedLabel(elapsedMs)}</span>
        </div>
      )}
      {error && !recording && (
        <div className="absolute right-0 bottom-full mb-2 w-64 rounded-xl border border-destructive/20 bg-card px-3 py-2 text-[0.68rem] text-destructive shadow-lg">
          {error}
        </div>
      )}
      <Button
        type="button"
        size="icon-lg"
        variant={recording ? "destructive" : "outline"}
        disabled={disabled || sending}
        className={cn("touch-none select-none", recording && "animate-pulse")}
        title="Segure por 1 segundo para gravar"
        aria-label={recording ? "Gravando áudio. Solte para enviar" : "Segure por 1 segundo para gravar áudio"}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (disabled || sending || recording) return
          if (event.pointerType === "mouse" && event.button !== 0) return
          event.preventDefault()
          setError(null)
          heldRef.current = true
          pointerIdRef.current = event.pointerId
          event.currentTarget.setPointerCapture?.(event.pointerId)
          clearHoldTimer()
          holdTimerRef.current = window.setTimeout(() => {
            holdTimerRef.current = null
            void startRecording()
          }, HOLD_TO_RECORD_MS)
        }}
        onPointerUp={(event) => {
          event.preventDefault()
          if (pointerIdRef.current === event.pointerId) {
            try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* noop */ }
          }
          pointerIdRef.current = null
          finishHold()
        }}
        onPointerCancel={() => {
          pointerIdRef.current = null
          finishHold()
        }}
        onLostPointerCapture={() => {
          if (heldRef.current) finishHold()
        }}
        onClick={(event) => event.preventDefault()}
      >
        {sending ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
      </Button>
    </div>
  )
}
