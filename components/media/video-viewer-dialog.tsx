"use client"

import * as React from "react"
import { Minus, Plus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const MIN_SCALE = 1
const MAX_SCALE = 4
const SCALE_STEP = 0.35
const HISTORY_KEY = "__taskboardVideoOverlay"

type Point = { x: number; y: number }

type PinchState = {
  distance: number
  scale: number
  midpoint: Point
  offset: Point
}

type ZoomableVideoStageProps = {
  src: string
  className?: string
  videoClassName?: string
  showHint?: boolean
  autoPlay?: boolean
  onLoadedMetadata?: (video: HTMLVideoElement) => void
}

type VideoViewerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  src?: string | null
  title?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function touchPoint(touch: Touch): Point {
  return { x: touch.clientX, y: touch.clientY }
}

export function ZoomableVideoStage({
  src,
  className,
  videoClassName,
  showHint = true,
  autoPlay = false,
  onLoadedMetadata,
}: ZoomableVideoStageProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const scaleRef = React.useRef(1)
  const offsetRef = React.useRef<Point>({ x: 0, y: 0 })
  const pinchRef = React.useRef<PinchState | null>(null)
  const dragRef = React.useRef<{ pointerId: number; point: Point; offset: Point } | null>(null)

  const [scale, setScale] = React.useState(1)
  const [offset, setOffset] = React.useState<Point>({ x: 0, y: 0 })
  const [gestureActive, setGestureActive] = React.useState(false)

  const clampOffset = React.useCallback((nextOffset: Point, nextScale: number) => {
    if (nextScale <= MIN_SCALE) return { x: 0, y: 0 }

    const viewport = viewportRef.current
    const video = videoRef.current
    if (!viewport || !video) return nextOffset

    const viewportRect = viewport.getBoundingClientRect()
    const baseWidth = video.offsetWidth
    const baseHeight = video.offsetHeight
    if (!viewportRect.width || !viewportRect.height || !baseWidth || !baseHeight) return nextOffset

    const maxX = Math.max(0, (baseWidth * nextScale - viewportRect.width) / 2)
    const maxY = Math.max(0, (baseHeight * nextScale - viewportRect.height) / 2)

    return {
      x: clamp(nextOffset.x, -maxX, maxX),
      y: clamp(nextOffset.y, -maxY, maxY),
    }
  }, [])

  const applyTransform = React.useCallback((nextScale: number, nextOffset: Point) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    const clampedOffset = clampOffset(nextOffset, clampedScale)
    scaleRef.current = clampedScale
    offsetRef.current = clampedOffset
    setScale(clampedScale)
    setOffset(clampedOffset)
  }, [clampOffset])

  const reset = React.useCallback(() => {
    scaleRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    pinchRef.current = null
    dragRef.current = null
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setGestureActive(false)
  }, [])

  React.useEffect(() => {
    reset()
  }, [reset, src])

  const setZoomAroundPoint = React.useCallback((nextScale: number, focalPoint?: Point) => {
    const currentScale = scaleRef.current
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)

    if (clampedScale <= MIN_SCALE) {
      applyTransform(MIN_SCALE, { x: 0, y: 0 })
      return
    }

    const viewport = viewportRef.current
    if (!viewport || !focalPoint || currentScale <= 0) {
      applyTransform(clampedScale, offsetRef.current)
      return
    }

    const rect = viewport.getBoundingClientRect()
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const ratio = clampedScale / currentScale
    const currentOffset = offsetRef.current
    const nextOffset = {
      x: (focalPoint.x - center.x) - ratio * (focalPoint.x - center.x - currentOffset.x),
      y: (focalPoint.y - center.y) - ratio * (focalPoint.y - center.y - currentOffset.y),
    }

    applyTransform(clampedScale, nextOffset)
  }, [applyTransform])

  const zoomBy = React.useCallback((delta: number, focalPoint?: Point) => {
    setZoomAroundPoint(scaleRef.current + delta, focalPoint)
  }, [setZoomAroundPoint])

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      zoomBy(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP, { x: event.clientX, y: event.clientY })
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      event.preventDefault()
      event.stopPropagation()
      const a = touchPoint(event.touches[0]!)
      const b = touchPoint(event.touches[1]!)
      pinchRef.current = {
        distance: Math.max(1, distance(a, b)),
        scale: scaleRef.current,
        midpoint: midpoint(a, b),
        offset: offsetRef.current,
      }
      setGestureActive(true)
    }

    const handleTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current
      if (!pinch || event.touches.length < 2) return
      event.preventDefault()
      event.stopPropagation()

      const a = touchPoint(event.touches[0]!)
      const b = touchPoint(event.touches[1]!)
      const currentDistance = Math.max(1, distance(a, b))
      const currentMidpoint = midpoint(a, b)
      const nextScale = clamp(pinch.scale * (currentDistance / pinch.distance), MIN_SCALE, MAX_SCALE)

      if (nextScale <= MIN_SCALE) {
        applyTransform(MIN_SCALE, { x: 0, y: 0 })
        return
      }

      const viewportRect = viewport.getBoundingClientRect()
      const center = {
        x: viewportRect.left + viewportRect.width / 2,
        y: viewportRect.top + viewportRect.height / 2,
      }
      const ratio = nextScale / pinch.scale
      const nextOffset = {
        x: (currentMidpoint.x - center.x) - ratio * (pinch.midpoint.x - center.x - pinch.offset.x),
        y: (currentMidpoint.y - center.y) - ratio * (pinch.midpoint.y - center.y - pinch.offset.y),
      }
      applyTransform(nextScale, nextOffset)
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (!pinchRef.current) return
      if (event.touches.length >= 2) return
      event.stopPropagation()
      pinchRef.current = null
      setGestureActive(false)
      applyTransform(scaleRef.current, offsetRef.current)
    }

    const preventNativeGesture = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    viewport.addEventListener("wheel", handleWheel, { passive: false })
    viewport.addEventListener("touchstart", handleTouchStart, { passive: false })
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false })
    viewport.addEventListener("touchend", handleTouchEnd, { passive: true })
    viewport.addEventListener("touchcancel", handleTouchEnd, { passive: true })
    viewport.addEventListener("gesturestart", preventNativeGesture, { passive: false } as AddEventListenerOptions)
    viewport.addEventListener("gesturechange", preventNativeGesture, { passive: false } as AddEventListenerOptions)
    viewport.addEventListener("gestureend", preventNativeGesture, { passive: false } as AddEventListenerOptions)

    return () => {
      viewport.removeEventListener("wheel", handleWheel)
      viewport.removeEventListener("touchstart", handleTouchStart)
      viewport.removeEventListener("touchmove", handleTouchMove)
      viewport.removeEventListener("touchend", handleTouchEnd)
      viewport.removeEventListener("touchcancel", handleTouchEnd)
      viewport.removeEventListener("gesturestart", preventNativeGesture)
      viewport.removeEventListener("gesturechange", preventNativeGesture)
      viewport.removeEventListener("gestureend", preventNativeGesture)
    }
  }, [applyTransform, zoomBy])

  React.useEffect(() => {
    const handleResize = () => applyTransform(scaleRef.current, offsetRef.current)
    window.addEventListener("resize", handleResize)
    window.visualViewport?.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
      window.visualViewport?.removeEventListener("resize", handleResize)
    }
  }, [applyTransform])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // No desktop, o vídeo continua com todos os controles nativos. O deslocamento
    // do zoom só começa com Shift + arraste para não capturar play, volume ou seek.
    if (event.pointerType !== "mouse" || !event.shiftKey || scaleRef.current <= MIN_SCALE) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      pointerId: event.pointerId,
      point: { x: event.clientX, y: event.clientY },
      offset: offsetRef.current,
    }
    setGestureActive(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* noop */ }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    applyTransform(scaleRef.current, {
      x: drag.offset.x + (event.clientX - drag.point.x),
      y: drag.offset.y + (event.clientY - drag.point.y),
    })
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
    setGestureActive(false)
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch { /* noop */ }
    applyTransform(scaleRef.current, offsetRef.current)
  }

  return (
    <div
      ref={viewportRef}
      className={cn("relative min-h-0 overflow-hidden bg-black", className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/10 bg-black/65 p-1 shadow-lg backdrop-blur-md sm:left-auto sm:right-3 sm:translate-x-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
          onClick={() => zoomBy(-SCALE_STEP)}
          disabled={scale <= MIN_SCALE}
          title="Diminuir zoom"
          aria-label="Diminuir zoom"
        >
          <Minus className="size-3.5" />
        </Button>
        <button
          type="button"
          onClick={() => setZoomAroundPoint(scaleRef.current === MIN_SCALE ? 2 : MIN_SCALE)}
          className="h-8 min-w-12 rounded-lg px-2 font-mono text-[0.65rem] text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          title="Alternar zoom"
        >
          {Math.round(scale * 100)}%
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
          onClick={() => zoomBy(SCALE_STEP)}
          disabled={scale >= MAX_SCALE}
          title="Aumentar zoom"
          aria-label="Aumentar zoom"
        >
          <Plus className="size-3.5" />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-white/10" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-8 text-white/80 hover:bg-white/10 hover:text-white"
          onClick={reset}
          disabled={scale <= MIN_SCALE && offset.x === 0 && offset.y === 0}
          title="Ajustar vídeo à tela"
          aria-label="Ajustar vídeo à tela"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      {showHint && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-lg bg-black/55 px-2 py-1 text-[0.58rem] text-white/65 backdrop-blur sm:bottom-3 sm:left-3 sm:text-[0.62rem]">
          <span className="sm:hidden">Pinça para ampliar</span>
          <span className="hidden sm:inline">Roda do mouse: zoom · Shift + arraste: mover</span>
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center p-1.5 sm:p-3">
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          autoPlay={autoPlay}
          className={cn("max-h-full max-w-full object-contain will-change-transform", videoClassName)}
          onLoadedMetadata={(event) => {
            applyTransform(scaleRef.current, offsetRef.current)
            onLoadedMetadata?.(event.currentTarget)
          }}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: "center center",
            transition: gestureActive ? "none" : "transform 100ms ease-out",
          }}
        />
      </div>
    </div>
  )
}

export function VideoViewerDialog({ open, onOpenChange, src, title }: VideoViewerDialogProps) {
  const historyTokenRef = React.useRef<string | null>(null)

  const currentOverlayHistory = React.useCallback(() => {
    if (typeof window === "undefined") return null
    return window.history.state?.[HISTORY_KEY] as { token?: string } | undefined ?? null
  }, [])

  React.useEffect(() => {
    if (!open || typeof window === "undefined") return
    if (!historyTokenRef.current) {
      const token = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
      historyTokenRef.current = token
      const currentState = window.history.state && typeof window.history.state === "object" ? window.history.state : {}
      window.history.pushState({ ...currentState, [HISTORY_KEY]: { token } }, "", window.location.href)
    }

    const handlePopState = () => {
      const token = historyTokenRef.current
      const current = currentOverlayHistory()
      if (token && current?.token !== token) {
        historyTokenRef.current = null
        onOpenChange(false)
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [currentOverlayHistory, onOpenChange, open])

  React.useEffect(() => {
    if (open) return
    historyTokenRef.current = null
  }, [open])

  React.useEffect(() => {
    if (!open || typeof document === "undefined") return
    const body = document.body
    const previousMediaFlag = body.dataset.taskboardMediaViewerOpen
    const previousImageFlag = body.dataset.taskboardImageViewerOpen
    body.dataset.taskboardMediaViewerOpen = "true"
    // Mantém compatibilidade com proteções já existentes no fluxo de reunião/back.
    body.dataset.taskboardImageViewerOpen = "true"
    return () => {
      if (previousMediaFlag === undefined) delete body.dataset.taskboardMediaViewerOpen
      else body.dataset.taskboardMediaViewerOpen = previousMediaFlag
      if (previousImageFlag === undefined) delete body.dataset.taskboardImageViewerOpen
      else body.dataset.taskboardImageViewerOpen = previousImageFlag
    }
  }, [open])

  const requestClose = React.useCallback(() => {
    if (typeof window === "undefined") {
      onOpenChange(false)
      return
    }
    const token = historyTokenRef.current
    const current = currentOverlayHistory()
    if (token && current?.token === token) {
      window.history.back()
      return
    }
    historyTokenRef.current = null
    onOpenChange(false)
  }, [currentOverlayHistory, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}>
      <DialogContent
        className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden bg-background/98 p-0 sm:h-[min(92dvh,920px)] sm:w-[min(96vw,1500px)] sm:max-w-none"
        showCloseButton
        data-no-swipe-reply="true"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <DialogHeader className="shrink-0 border-b border-border px-3 py-2.5 pr-12 sm:px-5 sm:py-3 sm:pr-14">
          <DialogTitle className="truncate text-sm sm:text-base">{title || "Visualizar vídeo"}</DialogTitle>
          <p className="mt-0.5 text-[0.62rem] text-muted-foreground sm:text-[0.65rem]">
            <span className="sm:hidden">Use pinça com dois dedos para ampliar o vídeo.</span>
            <span className="hidden sm:inline">Use a roda do mouse ou os botões de zoom. Para mover quando ampliado, segure Shift e arraste.</span>
          </p>
        </DialogHeader>

        {src ? (
          <ZoomableVideoStage src={src} className="min-h-0 flex-1" showHint />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black px-6 text-center text-sm text-white/60">Vídeo indisponível.</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
