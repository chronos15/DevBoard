"use client"

import * as React from "react"
import { Download, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const MIN_SCALE = 1
const MAX_SCALE = 5
const SCALE_STEP = 0.35

type Point = { x: number; y: number }

type ImageViewerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  src?: string | null
  alt?: string
  title?: string
  downloadName?: string
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

export function ImageViewerDialog({
  open,
  onOpenChange,
  src,
  alt = "Imagem",
  title,
  downloadName,
}: ImageViewerDialogProps) {
  const [scale, setScale] = React.useState(1)
  const [rotation, setRotation] = React.useState(0)
  const [offset, setOffset] = React.useState<Point>({ x: 0, y: 0 })
  const pointersRef = React.useRef(new Map<number, Point>())
  const dragOriginRef = React.useRef<{ pointer: Point; offset: Point } | null>(null)
  const pinchRef = React.useRef<{ distance: number; scale: number; midpoint: Point; offset: Point } | null>(null)

  const reset = React.useCallback(() => {
    setScale(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    pointersRef.current.clear()
    dragOriginRef.current = null
    pinchRef.current = null
  }, [])

  React.useEffect(() => {
    if (open) reset()
  }, [open, reset, src])

  const setZoom = React.useCallback((nextScale: number) => {
    const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    setScale(clamped)
    if (clamped === 1) setOffset({ x: 0, y: 0 })
  }, [])

  const zoomBy = React.useCallback((delta: number) => {
    setScale((current) => {
      const next = clamp(current + delta, MIN_SCALE, MAX_SCALE)
      if (next === 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!src) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = { x: event.clientX, y: event.clientY }
    pointersRef.current.set(event.pointerId, point)

    if (pointersRef.current.size === 1) {
      dragOriginRef.current = { pointer: point, offset }
      pinchRef.current = null
      return
    }

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        distance: Math.max(1, distance(a, b)),
        scale,
        midpoint: midpoint(a, b),
        offset,
      }
      dragOriginRef.current = null
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
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
      setScale(nextScale)
      setOffset(nextScale === 1 ? { x: 0, y: 0 } : {
        x: pinchRef.current.offset.x + (currentMidpoint.x - pinchRef.current.midpoint.x),
        y: pinchRef.current.offset.y + (currentMidpoint.y - pinchRef.current.midpoint.y),
      })
      return
    }

    if (scale <= 1 || !dragOriginRef.current) return
    setOffset({
      x: dragOriginRef.current.offset.x + (point.x - dragOriginRef.current.pointer.x),
      y: dragOriginRef.current.offset.y + (point.y - dragOriginRef.current.pointer.y),
    })
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values())
      dragOriginRef.current = { pointer: remaining, offset }
      pinchRef.current = null
    } else if (pointersRef.current.size === 0) {
      dragOriginRef.current = null
      pinchRef.current = null
    }
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
              <button type="button" onClick={() => setZoom(scale === 1 ? 2 : 1)} className="min-w-12 rounded-md px-1.5 py-1 font-mono text-[0.62rem] text-muted-foreground hover:bg-muted" title="Alternar zoom">
                {Math.round(scale * 100)}%
              </button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => zoomBy(SCALE_STEP)} disabled={scale >= MAX_SCALE} title="Aumentar zoom" aria-label="Aumentar zoom">
                <Plus className="size-3.5" />
              </Button>
              <span className="mx-0.5 h-5 w-px bg-border" />
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => setRotation((current) => current - 90)} title="Girar para a esquerda" aria-label="Girar para a esquerda">
                <RotateCcw className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => setRotation((current) => current + 90)} title="Girar para a direita" aria-label="Girar para a direita">
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
          className={cn(
            "relative min-h-0 flex-1 select-none overflow-hidden bg-black/[0.94] touch-none",
            scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
          )}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onDoubleClick={() => setZoom(scale === 1 ? 2 : 1)}
        >
          {src ? (
            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
              <img
                src={src}
                alt={alt}
                draggable={false}
                className="max-h-full max-w-full object-contain will-change-transform"
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  transition: pointersRef.current.size > 0 ? "none" : "transform 120ms ease-out",
                }}
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
