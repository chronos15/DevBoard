"use client"

import * as React from "react"
import { Loader2, Mic, Pause, Play, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

const WAVEFORM = [5, 9, 13, 8, 16, 11, 7, 15, 10, 18, 9, 14, 6, 12, 17, 8, 13, 6, 11, 15]

export function AudioRecordButton({
  disabled,
  onRecorded,
  onRecordingChange,
}: {
  disabled?: boolean
  onRecorded: (audio: Blob, durationMs: number) => Promise<boolean>
  onRecordingChange?: (recording: boolean) => void
}) {
  const [phase, setPhase] = React.useState<"idle" | "starting" | "recording" | "paused" | "sending">("idle")
  const [elapsedMs, setElapsedMs] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<BlobPart[]>([])
  const startedAtRef = React.useRef(0)
  const accumulatedRef = React.useRef(0)
  const tickRef = React.useRef<number | null>(null)
  const sendAfterStopRef = React.useRef(false)
  const disposedRef = React.useRef(false)

  const active = phase !== "idle"

  React.useEffect(() => {
    onRecordingChange?.(active)
  }, [active, onRecordingChange])

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

  const reset = React.useCallback(() => {
    clearTick()
    stopTracks()
    recorderRef.current = null
    chunksRef.current = []
    startedAtRef.current = 0
    accumulatedRef.current = 0
    sendAfterStopRef.current = false
    setElapsedMs(0)
    setPhase("idle")
  }, [clearTick, stopTracks])

  const startTick = React.useCallback(() => {
    clearTick()
    tickRef.current = window.setInterval(() => {
      setElapsedMs(accumulatedRef.current + Math.max(0, performance.now() - startedAtRef.current))
    }, 150)
  }, [clearTick])

  const startRecording = React.useCallback(async () => {
    if (disabled || phase !== "idle") return
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Seu navegador não permite gravação de áudio.")
      return
    }

    setPhase("starting")

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      chunksRef.current = []
      accumulatedRef.current = 0
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
        stopTracks()
        const totalDuration = Math.max(1, accumulatedRef.current || elapsedMs)
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        })
        const shouldSend = sendAfterStopRef.current
        recorderRef.current = null
        chunksRef.current = []

        if (!shouldSend || !blob.size || disposedRef.current) {
          reset()
          return
        }

        setPhase("sending")
        try {
          const ok = await onRecorded(blob, totalDuration)
          if (!ok) setError("Não foi possível enviar o áudio.")
        } finally {
          reset()
        }
      }

      recorder.onpause = () => {
        accumulatedRef.current += Math.max(0, performance.now() - startedAtRef.current)
        setElapsedMs(accumulatedRef.current)
        clearTick()
        setPhase("paused")
      }

      recorder.onresume = () => {
        startedAtRef.current = performance.now()
        setPhase("recording")
        startTick()
      }

      recorder.start(250)
      startedAtRef.current = performance.now()
      setElapsedMs(0)
      setPhase("recording")
      startTick()
    } catch (cause) {
      stopTracks()
      setPhase("idle")
      const name = cause instanceof DOMException ? cause.name : ""
      setError(name === "NotAllowedError" ? "Permita o uso do microfone para gravar áudio." : "Não foi possível acessar o microfone.")
    }
  }, [clearTick, disabled, elapsedMs, onRecorded, phase, reset, startTick, stopTracks])

  const deleteRecording = React.useCallback(() => {
    sendAfterStopRef.current = false
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      try { recorder.requestData() } catch { /* noop */ }
      recorder.stop()
      return
    }
    reset()
  }, [reset])

  const togglePause = React.useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === "recording") recorder.pause()
    else if (recorder.state === "paused") recorder.resume()
  }, [])

  const sendRecording = React.useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || phase === "sending" || phase === "starting") return
    if (recorder.state === "recording") {
      accumulatedRef.current += Math.max(0, performance.now() - startedAtRef.current)
    }
    sendAfterStopRef.current = true
    setPhase("sending")
    try { recorder.requestData() } catch { /* noop */ }
    recorder.stop()
  }, [phase])

  React.useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      sendAfterStopRef.current = false
      clearTick()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop() } catch { /* noop */ }
      }
      stopTracks()
    }
  }, [clearTick, stopTracks])

  if (!active) {
    return (
      <div className="relative shrink-0">
        {error && (
          <div className="absolute right-0 bottom-full mb-2 w-64 rounded-xl border border-destructive/20 bg-card px-3 py-2 text-[0.68rem] text-destructive shadow-lg">
            {error}
          </div>
        )}
        <Button
          type="button"
          size="icon-lg"
          variant="outline"
          disabled={disabled}
          onClick={() => void startRecording()}
          title="Gravar áudio"
          aria-label="Iniciar gravação de áudio"
        >
          <Mic className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border bg-muted/30 p-1.5 sm:gap-3 sm:px-2">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={deleteRecording}
        disabled={phase === "sending" || phase === "starting"}
        className="shrink-0 text-destructive hover:text-destructive"
        title="Excluir gravação"
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Excluir gravação</span>
      </Button>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={togglePause}
        disabled={phase === "sending" || phase === "starting"}
        className="shrink-0"
        title={phase === "paused" ? "Continuar gravação" : "Pausar gravação"}
      >
        {phase === "paused" ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
        <span className="sr-only">{phase === "paused" ? "Continuar gravação" : "Pausar gravação"}</span>
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", phase === "recording" ? "animate-pulse bg-destructive" : "bg-muted-foreground/45")} />
        <div className="flex h-7 min-w-0 flex-1 items-center gap-[3px] overflow-hidden rounded-full px-1" aria-hidden="true">
          {WAVEFORM.map((height, index) => (
            <span
              key={index}
              className={cn(
                "w-[3px] shrink-0 rounded-full bg-primary/65 transition-opacity",
                phase === "recording" && "animate-pulse",
                phase === "paused" && "opacity-45",
              )}
              style={{ height: `${height}px`, animationDelay: `${index * 45}ms` }}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-foreground">
          {phase === "starting" ? "..." : elapsedLabel(elapsedMs)}
        </span>
        <Mic className={cn("size-4 shrink-0", phase === "recording" ? "text-destructive" : "text-muted-foreground")} />
      </div>

      <Button
        type="button"
        size="icon-lg"
        onClick={sendRecording}
        disabled={phase === "sending" || phase === "starting" || elapsedMs < 250}
        className="shrink-0 rounded-full"
        title="Enviar áudio"
      >
        {phase === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 fill-current" />}
        <span className="sr-only">Enviar áudio</span>
      </Button>
    </div>
  )
}
