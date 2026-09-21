"use client"

import * as React from "react"
import { Check, Ellipsis, Gauge, Square, Volume2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type MessageNarratorRate = 0.5 | 1 | 1.5 | 2

type NarrationRequest = {
  id: string
  text: string
  label?: string
}

type MessageNarratorContextValue = {
  supported: boolean
  speakingId: string | null
  rate: MessageNarratorRate
  speak: (request: NarrationRequest) => void
  stop: () => void
  setRate: (rate: MessageNarratorRate) => void
}

const RATE_OPTIONS: MessageNarratorRate[] = [0.5, 1, 1.5, 2]
const RATE_STORAGE_KEY = "taskboard:message-narrator-rate"
const MAX_SPEECH_CHUNK = 220

const MessageNarratorContext = React.createContext<MessageNarratorContextValue | null>(null)

function rateLabel(rate: MessageNarratorRate) {
  if (rate === 0.5) return "0,5x"
  if (rate === 1) return "1x"
  if (rate === 1.5) return "1,5x"
  return "2x"
}

function normalizeMessageForSpeech(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " bloco de código. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " link ")
    .replace(/@([^\s.,;:!?]+)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\|\|([^|]+)\|\|/g, "$1")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function splitLongPart(part: string, maxLength: number) {
  const result: string[] = []
  let remaining = part.trim()

  while (remaining.length > maxLength) {
    const preferred = Math.max(
      remaining.lastIndexOf(". ", maxLength),
      remaining.lastIndexOf("; ", maxLength),
      remaining.lastIndexOf(", ", maxLength),
      remaining.lastIndexOf(" ", maxLength),
    )
    const cut = preferred >= Math.floor(maxLength * 0.55) ? preferred + 1 : maxLength
    result.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }

  if (remaining) result.push(remaining)
  return result
}

function splitMessageForSpeech(value: string) {
  const normalized = normalizeMessageForSpeech(value)
  if (!normalized) return []

  const sentenceParts = normalized.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [normalized]
  const chunks: string[] = []
  let current = ""

  for (const rawPart of sentenceParts) {
    const parts = rawPart.length > MAX_SPEECH_CHUNK
      ? splitLongPart(rawPart, MAX_SPEECH_CHUNK)
      : [rawPart.trim()]

    for (const part of parts) {
      if (!part) continue
      const candidate = current ? `${current} ${part}` : part
      if (candidate.length <= MAX_SPEECH_CHUNK) {
        current = candidate
      } else {
        if (current) chunks.push(current)
        current = part
      }
    }
  }

  if (current) chunks.push(current)
  return chunks
}

function preferredPortugueseVoice(voices: SpeechSynthesisVoice[]) {
  if (!voices.length) return null
  const ptBr = voices.filter((voice) => voice.lang.toLocaleLowerCase().replace("_", "-") === "pt-br")
  if (ptBr.length) return ptBr.find((voice) => voice.default) ?? ptBr[0]
  const portuguese = voices.filter((voice) => voice.lang.toLocaleLowerCase().startsWith("pt"))
  if (portuguese.length) return portuguese.find((voice) => voice.default) ?? portuguese[0]
  return voices.find((voice) => voice.default) ?? voices[0] ?? null
}

export function MessageNarratorProvider({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = React.useState(false)
  const [rate, setRateState] = React.useState<MessageNarratorRate>(1)
  const [current, setCurrent] = React.useState<(NarrationRequest & { chunks: string[] }) | null>(null)
  const [speakingId, setSpeakingId] = React.useState<string | null>(null)
  const runIdRef = React.useRef(0)
  const chunkIndexRef = React.useRef(0)
  const currentRef = React.useRef<(NarrationRequest & { chunks: string[] }) | null>(null)
  const rateRef = React.useRef<MessageNarratorRate>(1)
  const speakingRef = React.useRef(false)
  const voicesRef = React.useRef<SpeechSynthesisVoice[]>([])

  React.useEffect(() => {
    const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
    setSupported(canSpeak)
    if (!canSpeak) return

    const stored = Number(window.localStorage.getItem(RATE_STORAGE_KEY))
    if (RATE_OPTIONS.includes(stored as MessageNarratorRate)) {
      const next = stored as MessageNarratorRate
      rateRef.current = next
      setRateState(next)
    }

    const refreshVoices = () => {
      const next = window.speechSynthesis.getVoices()
      voicesRef.current = next
    }

    refreshVoices()
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices)
    return () => {
      runIdRef.current += 1
      speakingRef.current = false
      window.speechSynthesis.cancel()
      window.speechSynthesis.removeEventListener?.("voiceschanged", refreshVoices)
    }
  }, [])


  React.useEffect(() => {
    function resumeWhenVisible() {
      if (document.visibilityState !== "visible" || !speakingRef.current || !window.speechSynthesis.paused) return
      window.speechSynthesis.resume()
    }
    document.addEventListener("visibilitychange", resumeWhenVisible)
    return () => document.removeEventListener("visibilitychange", resumeWhenVisible)
  }, [])

  const finishNarration = React.useCallback((runId: number) => {
    if (runId !== runIdRef.current) return
    speakingRef.current = false
    currentRef.current = null
    setSpeakingId(null)
    setCurrent(null)
  }, [])

  const playFromChunk = React.useCallback((request: NarrationRequest & { chunks: string[] }, startIndex: number, runId: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return

    const playChunk = (index: number) => {
      if (runId !== runIdRef.current) return
      if (index >= request.chunks.length) {
        finishNarration(runId)
        return
      }

      chunkIndexRef.current = index
      const utterance = new SpeechSynthesisUtterance(request.chunks[index])
      const voice = preferredPortugueseVoice(voicesRef.current)
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang || "pt-BR"
      utterance.rate = rateRef.current
      utterance.pitch = 1
      utterance.volume = 1
      utterance.onend = () => playChunk(index + 1)
      utterance.onerror = (event) => {
        if (runId !== runIdRef.current) return
        if (event.error === "canceled" || event.error === "interrupted") return
        finishNarration(runId)
      }
      window.speechSynthesis.speak(utterance)
    }

    playChunk(Math.max(0, Math.min(startIndex, request.chunks.length - 1)))
  }, [finishNarration])

  const stop = React.useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    runIdRef.current += 1
    speakingRef.current = false
    currentRef.current = null
    window.speechSynthesis.cancel()
    setSpeakingId(null)
    setCurrent(null)
  }, [])

  const speak = React.useCallback((request: NarrationRequest) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    const chunks = splitMessageForSpeech(request.text)
    if (!chunks.length) return

    if (speakingRef.current && currentRef.current?.id === request.id) {
      stop()
      return
    }

    runIdRef.current += 1
    const runId = runIdRef.current
    window.speechSynthesis.cancel()
    const next = { ...request, chunks }
    currentRef.current = next
    chunkIndexRef.current = 0
    speakingRef.current = true
    setCurrent(next)
    setSpeakingId(request.id)

    // Um pequeno defer evita que o cancel() anterior invalide o primeiro utterance
    // em Chrome/Android quando o usuário troca rapidamente de mensagem.
    window.setTimeout(() => {
      if (runId !== runIdRef.current) return
      playFromChunk(next, 0, runId)
    }, 30)
  }, [playFromChunk, stop])

  const setRate = React.useCallback((nextRate: MessageNarratorRate) => {
    if (!RATE_OPTIONS.includes(nextRate)) return
    rateRef.current = nextRate
    setRateState(nextRate)
    if (typeof window !== "undefined") window.localStorage.setItem(RATE_STORAGE_KEY, String(nextRate))

    const active = currentRef.current
    if (!active || !speakingRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return

    const restartIndex = chunkIndexRef.current
    runIdRef.current += 1
    const runId = runIdRef.current
    window.speechSynthesis.cancel()
    window.setTimeout(() => {
      if (runId !== runIdRef.current) return
      playFromChunk(active, restartIndex, runId)
    }, 30)
  }, [playFromChunk])

  const context = React.useMemo<MessageNarratorContextValue>(() => ({
    supported,
    speakingId,
    rate,
    speak,
    stop,
    setRate,
  }), [rate, setRate, speak, speakingId, stop, supported])

  return (
    <MessageNarratorContext.Provider value={context}>
      {children}
      {supported && current && speakingId && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[140] flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border border-border bg-popover/95 px-2.5 py-2 text-popover-foreground shadow-2xl backdrop-blur-md">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Volume2 className="size-4 animate-pulse" />
            </span>
            <div className="hidden min-w-0 sm:block">
              <p className="max-w-48 truncate text-[0.68rem] font-semibold">{current.label || "Narrando mensagem"}</p>
              <p className="text-[0.56rem] text-muted-foreground">Narrador do dispositivo</p>
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted/70 p-1" aria-label="Velocidade da narração">
              {RATE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRate(option)}
                  className={cn(
                    "h-7 min-w-9 rounded-lg px-1.5 text-[0.62rem] font-semibold tabular-nums transition-colors",
                    option === rate ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  title={`Velocidade ${rateLabel(option)}`}
                  aria-pressed={option === rate}
                >
                  {option === 0.5 ? "0,5x" : option === 1 ? "1x" : option === 1.5 ? "1,5x" : "2x"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={stop}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Parar narração"
              aria-label="Parar narração"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          </div>
        </div>
      )}
    </MessageNarratorContext.Provider>
  )
}

export function useMessageNarrator() {
  const context = React.useContext(MessageNarratorContext)
  if (!context) throw new Error("useMessageNarrator precisa estar dentro de MessageNarratorProvider")
  return context
}

export function MessageNarratorButton({
  messageId,
  text,
  label,
  className,
  iconClassName = "size-3.5",
  stopPropagation = true,
}: {
  messageId: string
  text: string
  label?: string
  className?: string
  iconClassName?: string
  stopPropagation?: boolean
}) {
  const { supported, speakingId, rate, speak } = useMessageNarrator()
  const active = speakingId === messageId
  if (!text.trim()) return null

  return (
    <button
      type="button"
      disabled={!supported}
      onPointerDown={stopPropagation ? (event) => event.stopPropagation() : undefined}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation()
        speak({ id: messageId, text, label })
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-primary/10 text-primary",
        className,
      )}
      title={!supported ? "Narrador indisponível neste navegador" : active ? "Parar leitura" : `Ouvir mensagem · ${rateLabel(rate)}`}
      aria-label={active ? "Parar leitura da mensagem" : `Ouvir mensagem em ${rateLabel(rate)}`}
      aria-pressed={active}
    >
      <Volume2 className={cn(iconClassName, active && "animate-pulse")} />
    </button>
  )
}

export function MessageNarratorMobileMenu({
  messageId,
  text,
  label,
  className,
  triggerClassName,
  children,
}: {
  messageId: string
  text: string
  label?: string
  className?: string
  triggerClassName?: string
  children?: React.ReactNode
}) {
  const { supported, speakingId, rate, speak, setRate } = useMessageNarrator()
  const active = speakingId === messageId
  if (!text.trim()) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          triggerClassName,
        )}
        aria-label="Ações da mensagem"
        title="Ações da mensagem"
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("w-48", className)}>
        <DropdownMenuItem
          disabled={!supported}
          onClick={() => speak({ id: messageId, text, label })}
          className={cn(active && "text-primary")}
        >
          <Volume2 className={cn("size-4", active && "animate-pulse")} />
          <span>{active ? "Parar leitura" : "Ouvir mensagem"}</span>
          <span className="ml-auto text-[0.65rem] text-muted-foreground">{rate === 0.5 ? "0,5x" : rate === 1 ? "1x" : rate === 1.5 ? "1,5x" : "2x"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <Gauge className="size-3.5" /> Velocidade
        </DropdownMenuLabel>
        {RATE_OPTIONS.map((option) => (
          <DropdownMenuItem key={option} onClick={() => setRate(option)}>
            <span className="flex size-4 items-center justify-center">{option === rate ? <Check className="size-3.5 text-primary" /> : null}</span>
            <span>{option === 0.5 ? "0,5x" : option === 1 ? "1,0x" : option === 1.5 ? "1,5x" : "2,0x"}</span>
          </DropdownMenuItem>
        ))}
        {children ? <DropdownMenuSeparator /> : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
