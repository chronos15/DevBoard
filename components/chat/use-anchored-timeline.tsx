"use client"

import * as React from "react"
import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

type AnchoredTimelineOptions = {
  scopeKey?: string | null
  changeKey?: string | number | null
  threshold?: number
  enabled?: boolean
  initialScroll?: boolean
}

export function useAnchoredTimelineScroll({
  scopeKey,
  changeKey,
  threshold = 96,
  enabled = true,
  initialScroll = true,
}: AnchoredTimelineOptions = {}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)
  const previousChangeKeyRef = React.useRef<string | number | null | undefined>(undefined)
  const previousScopeKeyRef = React.useRef<string | null | undefined>(undefined)
  const [hasNewBelow, setHasNewBelow] = React.useState(false)

  const isNearBottom = React.useCallback((viewport: HTMLDivElement) => (
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold
  ), [threshold])

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current
    if (!viewport) return
    const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    if (behavior === "smooth" && typeof viewport.scrollTo === "function") viewport.scrollTo({ top, behavior })
    else viewport.scrollTop = top
    stickToBottomRef.current = true
    setHasNewBelow(false)
  }, [])

  const syncIfAnchored = React.useCallback(() => {
    if (!enabled || !stickToBottomRef.current) return
    window.requestAnimationFrame(() => scrollToBottom("auto"))
  }, [enabled, scrollToBottom])

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    const nearBottom = isNearBottom(viewport)
    stickToBottomRef.current = nearBottom
    if (nearBottom) setHasNewBelow(false)
  }, [isNearBottom])

  const markDetached = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (!isNearBottom(viewport)) stickToBottomRef.current = false
  }, [isNearBottom])

  React.useLayoutEffect(() => {
    if (!enabled) return
    if (previousScopeKeyRef.current === scopeKey) return
    previousScopeKeyRef.current = scopeKey
    previousChangeKeyRef.current = changeKey
    stickToBottomRef.current = true
    setHasNewBelow(false)
    if (!initialScroll) return
    const first = window.requestAnimationFrame(() => {
      scrollToBottom("auto")
      window.requestAnimationFrame(() => scrollToBottom("auto"))
    })
    return () => window.cancelAnimationFrame(first)
  }, [changeKey, enabled, initialScroll, scopeKey, scrollToBottom])

  React.useEffect(() => {
    if (!enabled) return
    const previous = previousChangeKeyRef.current
    if (previous === changeKey) return
    previousChangeKeyRef.current = changeKey
    if (stickToBottomRef.current) {
      window.requestAnimationFrame(() => scrollToBottom("auto"))
    } else if (previous !== undefined && previous !== null) {
      setHasNewBelow(true)
    }
  }, [changeKey, enabled, scrollToBottom])

  return {
    viewportRef,
    stickToBottomRef,
    hasNewBelow,
    handleScroll,
    markDetached,
    scrollToBottom,
    syncIfAnchored,
    clearNewBelow: () => setHasNewBelow(false),
  }
}

export function TimelineJumpToLatest({
  visible,
  onClick,
  className,
  label = "Novas mensagens",
}: {
  visible: boolean
  onClick: () => void
  className?: string
  label?: string
}) {
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute bottom-3 right-3 z-30 inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg shadow-black/10 transition hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        className,
      )}
      title={`${label} · ir para a última mensagem`}
      aria-label={`${label}. Ir para a última mensagem`}
    >
      <ArrowDown className="size-4 text-primary" />
      <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-card" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </button>
  )
}

export function AnchoredTimelineViewport({
  scopeKey,
  changeKey,
  children,
  className,
  contentClassName,
  threshold = 96,
  initialScroll = true,
  onScroll,
  newItemsLabel = "Novas mensagens",
}: {
  scopeKey?: string | null
  changeKey?: string | number | null
  children: React.ReactNode
  className?: string
  contentClassName?: string
  threshold?: number
  initialScroll?: boolean
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void
  newItemsLabel?: string
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const {
    viewportRef,
    stickToBottomRef,
    hasNewBelow,
    handleScroll,
    scrollToBottom,
  } = useAnchoredTimelineScroll({ scopeKey, changeKey, threshold, initialScroll })

  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return
      window.requestAnimationFrame(() => scrollToBottom("auto"))
    })
    observer.observe(content)
    if (viewportRef.current) observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [scopeKey, scrollToBottom, stickToBottomRef])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={(event) => {
          handleScroll(event)
          onScroll?.(event)
        }}
        className={cn("h-full min-h-0 overflow-y-auto", className)}
      >
        <div ref={contentRef} className={contentClassName}>{children}</div>
      </div>
      <TimelineJumpToLatest visible={hasNewBelow} onClick={() => scrollToBottom("smooth")} label={newItemsLabel} />
    </div>
  )
}
