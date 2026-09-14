"use client"

import * as React from "react"
import { Download, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const MIN_SCALE = 1
const MAX_SCALE = 5
const SCALE_STEP = 0.35
const DOUBLE_TAP_DELAY = 280
const TAP_MOVE_TOLERANCE = 18

type Point = { x: number; y: number }

type ImageViewerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  src?: string | null
  alt?: string
  title?: string
  downloadName?: string
}

type PinchState = {
  distance: number
  scale: number
  midpoint: Point
  offset: Point
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

function normalizedRotation(value: number) {
  return ((value % 360) + 360) % 360
}

export function ImageViewerDialog({
  open,
  onOpenChange,
  src,
  alt = "Imagem",
  title,
  downloadName,
}: ImageViewerDialogProps) {
  const [scale, setScaleState] = React.useState(1)
  const [rotation, setRotationState] = React.useState(0)
  const [offset, setOffsetState] = React.useState<Point>({ x: 0, y: 0 })
  const [isGestureActive, setIsGestureActive] = React.useState(false)

  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const pointersRef = React.useRef(new Map<number, Point>())
  const pointerStartsRef = React.useRef(new Map<number, Point>())
  const dragOriginRef = React.useRef<{ pointer: Point; offset: Point } | null>(null)
  const pinchRef = React.useRef<PinchState | null>(null)
  const lastTapRef = React.useRef<{ at: number; point: Point } | null>(null)
  const scaleRef = React.useRef(1)
  const rotationRef = React.useRef(0)
  const offsetRef = React.useRef<Point>({ x: 0, y: 0 })
  const rafRef = React.useRef<number | null>(null)
  const pendingTransformRef = React.useRef<{ scale: number; offset: Point } | null>(null)

  const clampOffset = React.useCallback((nextOffset: Point, nextScale: number, nextRotation = rotationRef.current) => {
    if (nextScale <= MIN_SCALE) return { x: 0, y: 0 }

    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return nextOffset

    const viewportRect = viewport.getBoundingClientRect()
    const baseWidth = image.offsetWidth
    const baseHeight = image.offsetHeight
    if (!baseWidth || !baseHeight || !viewportRect.width || !viewportRect.height) return nextOffset

    const rotationValue = normalizedRotation(nextRotation)
    const swapsAxes = rotationValue === 90 || rotationValue === 270
    const scaledWidth = (swapsAxes ? baseHeight : baseWidth) * nextScale
    const scaledHeight = (swapsAxes ? baseWidth : baseHeight) * nextScale

    // Mantém pelo menos as bordas da imagem alcançáveis e impede que ela "suma"
    // completamente da área visível durante o arraste em touch.
    const maxX = Math.max(0, (scaledWidth - viewportRect.width) / 2)
    const maxY = Math.max(0, (scaledHeight - viewportRect.height) / 2)

    return {
      x: clamp(nextOffset.x, -maxX, maxX),
      y: clamp(nextOffset.y, -maxY, maxY),
    }
  }, [])

  const flushTransform = React.useCallback(() => {
    rafRef.current = null
    const pending = pendingTransformRef.current
    if (!pending) return
    pendingTransformRef.current = null
    setScaleState(pending.scale)
    setOffsetState(pending.offset)
  }, [])

  const applyTransform = React.useCallback((nextScale: number, nextOffset: Point, options?: { immediate?: boolean }) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    const clampedOffset = clampOffset(nextOffset, clampedScale)
    scaleRef.current = clampedScale
    offsetRef.current = clampedOffset

    if (options?.immediate) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      pendingTransformRef.current = null
      setScaleState(clampedScale)
      setOffsetState(clampedOffset)
      return
    }

    pendingTransformRef.current = { scale: clampedScale, offset: clampedOffset }
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushTransform)
  }, [clampOffset, flushTransform])

  const reset = React.useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    pendingTransformRef.current = null
    scaleRef.current = 1
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    setScaleState(1)
    setRotationState(0)
    setOffsetState({ x: 0, y: 0 })
    setIsGestureActive(false)
    pointersRef.current.clear()
    pointerStartsRef.current.clear()
    dragOriginRef.current = null
    pinchRef.current = null
    lastTapRef.current = null
  }, [])

  React.useEffect(() => {
    if (open) reset()
  }, [open, reset, src])

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // iOS/Safari ainda pode tentar aplicar o zoom nativo da página mesmo com
  // touch-action:none em alguns WebViews/PWAs. Estes listeners bloqueiam apenas
  // o gesto dentro do visualizador, sem interferir no restante da aplicação.
  React.useEffect(() => {
    if (!open) return
    const viewport = viewportRef.current
    if (!viewport) return

    const preventNativeGesture = (event: Event) => event.preventDefault()
    const preventTouchScroll = (event: TouchEvent) => {
      if (event.touches.length >= 2 || scaleRef.current > MIN_SCALE) event.preventDefault()
    }

    viewport.addEventListener("gesturestart", preventNativeGesture, { passive: false } as AddEventListenerOptions)
    viewport.addEventListener("gesturechange", preventNativeGesture, { passive: false } as AddEventListenerOptions)
    viewport.addEventListener("gestureend", preventNativeGesture, { passive: false } as AddEventListenerOptions)
    viewport.addEventListener("touchmove", preventTouchScroll, { passive: false })

    return () => {
      viewport.removeEventListener("gesturestart", preventNativeGesture)
      viewport.removeEventListener("gesturechange", preventNativeGesture)
      viewport.removeEventListener("gestureend", preventNativeGesture)
      viewport.removeEventListener("touchmove", preventTouchScroll)
    }
  }, [open])

  React.useEffect(() => {
    if (!open || scaleRef.current <= MIN_SCALE) return
    const handleResize = () => applyTransform(scaleRef.current, offsetRef.current, { immediate: true })
    window.addEventListener("resize", handleResize)
    window.visualViewport?.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
      window.visualViewport?.removeEventListener("resize", handleResize)
    }
  }, [open, applyTransform])

  const setZoomAroundPoint = React.useCallback((nextScale: number, focalPoint?: Point) => {
    const currentScale = scaleRef.current
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    if (clampedScale === MIN_SCALE) {
      applyTransform(MIN_SCALE, { x: 0, y: 0 }, { immediate: true })
      return
    }

    const viewport = viewportRef.current
    if (!viewport || !focalPoint || currentScale <= 0) {
      applyTransform(clampedScale, offsetRef.current, { immediate: true })
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
    applyTransform(clampedScale, nextOffset, { immediate: true })
  }, [applyTransform])

  const zoomBy = React.useCallback((delta: number, focalPoint?: Point) => {
    setZoomAroundPoint(scaleRef.current + delta, focalPoint)
  }, [setZoomAroundPoint])

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP, { x: event.clientX, y: event.clientY })
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!src) return
    if (event.pointerType === "touch") event.preventDefault()

    const point = { x: event.clientX, y: event.clientY }
    pointersRef.current.set(event.pointerId, point)
    pointerStartsRef.current.set(event.pointerId, point)
    setIsGestureActive(true)

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Safari/PWA pode rejeitar pointer capture durante transições de gesto.
    }

    if (pointersRef.current.size === 1) {
      dragOriginRef.current = { pointer: point, offset: offsetRef.current }
      pinchRef.current = null
      return
    }

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        distance: Math.max(1, distance(a, b)),
        scale: scaleRef.current,
        midpoint: midpoint(a, b),
        offset: offsetRef.current,
      }
      dragOriginRef.current = null
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
    if (event.pointerType === "touch") event.preventDefault()

    const point = { x: event.clientX, y: event.clientY }
    pointersRef.current.set(event.pointerId, point)

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = Array.from(pointersRef.current.values())
      const currentDistance = Math.max(1, distance(a, b))
      const currentMidpoint = midpoint(a, b)
      const nextScale = clamp(
        pinchRef.current.scale * (currentDistance / pinchRef.current.distance),
        MIN_SCALE,
        MAX_SCALE,
      )

      if (nextScale <= MIN_SCALE) {
        applyTransform(MIN_SCALE, { x: 0, y: 0 })
        return
      }

      const viewport = viewportRef.current
      if (!viewport) {
        applyTransform(nextScale, pinchRef.current.offset)
        return
      }

      const rect = viewport.getBoundingClientRect()
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const ratio = nextScale / pinchRef.current.scale

      // Mantém o ponto que estava entre os dedos preso sob a pinça enquanto
      // o usuário amplia/reduz e também permite mover a pinça ao mesmo tempo.
      const nextOffset = {
        x: (currentMidpoint.x - center.x) - ratio * (pinchRef.current.midpoint.x - center.x - pinchRef.current.offset.x),
        y: (currentMidpoint.y - center.y) - ratio * (pinchRef.current.midpoint.y - center.y - pinchRef.current.offset.y),
      }
      applyTransform(nextScale, nextOffset)
      return
    }

    if (scaleRef.current <= MIN_SCALE || !dragOriginRef.current) return
    applyTransform(scaleRef.current, {
      x: dragOriginRef.current.offset.x + (point.x - dragOriginRef.current.pointer.x),
      y: dragOriginRef.current.offset.y + (point.y - dragOriginRef.current.pointer.y),
    })
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const endPoint = { x: event.clientX, y: event.clientY }
    const startPoint = pointerStartsRef.current.get(event.pointerId)
    const wasTap = Boolean(startPoint && distance(startPoint, endPoint) <= TAP_MOVE_TOLERANCE)

    pointersRef.current.delete(event.pointerId)
    pointerStartsRef.current.delete(event.pointerId)

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Ignore falhas de release em Safari/WebView.
    }

    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values())
      dragOriginRef.current = { pointer: remaining, offset: offsetRef.current }
      pinchRef.current = null
    } else if (pointersRef.current.size === 0) {
      dragOriginRef.current = null
      pinchRef.current = null
      setIsGestureActive(false)
      applyTransform(scaleRef.current, offsetRef.current, { immediate: true })

      // Double tap confiável em iOS/Android. O onDoubleClick continua útil no
      // desktop, mas não é consistente em telas touch.
      if (event.pointerType === "touch" && wasTap) {
        const now = Date.now()
        const previousTap = lastTapRef.current
        if (previousTap && now - previousTap.at <= DOUBLE_TAP_DELAY && distance(previousTap.point, endPoint) <= 40) {
          lastTapRef.current = null
          setZoomAroundPoint(scaleRef.current > MIN_SCALE ? MIN_SCALE : 2, endPoint)
        } else {
          lastTapRef.current = { at: now, point: endPoint }
        }
      }
    }
  }

  function rotateBy(delta: number) {
    const nextRotation = rotationRef.current + delta
    rotationRef.current = nextRotation
    setRotationState(nextRotation)
    const nextOffset = clampOffset(offsetRef.current, scaleRef.current, nextRotation)
    offsetRef.current = nextOffset
    setOffsetState(nextOffset)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden bg-background/98 p-0 sm:h-[min(92dvh,920px)] sm:w-[min(96vw,1500px)] sm:max-w-none"
        showCloseButton
      >
        <DialogHeader className="shrink-0 border-b border-border px-3 py-2.5 pr-12 sm:px-5 sm:py-3 sm:pr-14">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm sm:text-base">{title || alt || "Visualizar imagem"}</DialogTitle>
              <p className="mt-0.5 hidden text-[0.65rem] text-muted-foreground sm:block">Role para ampliar, arraste quando houver zoom ou use pinça em telas touch.</p>
            </div>
            <div className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => zoomBy(-SCALE_STEP)} disabled={scale <= MIN_SCALE} title="Diminuir zoom" aria-label="Diminuir zoom">
                <Minus className="size-3.5" />
              </Button>
              <button type="button" onClick={() => setZoomAroundPoint(scaleRef.current === MIN_SCALE ? 2 : MIN_SCALE)} className="min-w-12 rounded-md px-1.5 py-1 font-mono text-[0.62rem] text-muted-foreground hover:bg-muted" title="Alternar zoom">
                {Math.round(scale * 100)}%
              </button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => zoomBy(SCALE_STEP)} disabled={scale >= MAX_SCALE} title="Aumentar zoom" aria-label="Aumentar zoom">
                <Plus className="size-3.5" />
              </Button>
              <span className="mx-0.5 h-5 w-px bg-border" />
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => rotateBy(-90)} title="Girar para a esquerda" aria-label="Girar para a esquerda">
                <RotateCcw className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => rotateBy(90)} title="Girar para a direita" aria-label="Girar para a direita">
                <RotateCw className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={reset} title="Ajustar imagem à tela" aria-label="Ajustar imagem à tela">
                <Maximize2 className="size-3.5" />
              </Button>
              {src && (
                <a
                  href={src}
                  download={downloadName || undefined}
                  className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
                  title="Baixar imagem"
                  aria-label="Baixar imagem"
                >
                  <Download className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </DialogHeader>

        <div
          ref={viewportRef}
          className={cn(
            "relative min-h-0 flex-1 select-none overflow-hidden bg-black/[0.94] overscroll-contain touch-none",
            scale > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
          )}
          style={{ touchAction: "none", WebkitUserSelect: "none" }}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={(event) => {
            if (pointersRef.current.has(event.pointerId)) handlePointerEnd(event)
          }}
          onDoubleClick={(event) => {
            setZoomAroundPoint(scaleRef.current === MIN_SCALE ? 2 : MIN_SCALE, { x: event.clientX, y: event.clientY })
          }}
        >
          {src ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3 sm:p-6">
              <img
                ref={imageRef}
                src={src}
                alt={alt}
                draggable={false}
                className="max-h-full max-w-full object-contain will-change-transform"
                onLoad={() => applyTransform(scaleRef.current, offsetRef.current, { immediate: true })}
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  transition: isGestureActive ? "none" : "transform 110ms ease-out",
                  WebkitUserDrag: "none",
                } as React.CSSProperties}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/60">Imagem indisponível.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
