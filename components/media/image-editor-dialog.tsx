"use client"

import * as React from "react"
import {
  Check,
  Crop,
  LoaderCircle,
  Paintbrush,
  Redo2,
  RotateCcw,
  RotateCw,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type EditorMode = "crop" | "draw"
type CropHandle = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"

type ImageEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  src?: string | null
  name?: string
  onComplete: (file: File) => void
}

const MIN_CROP_PIXELS = 24
const MAX_HISTORY_STEPS = 10
const BRUSH_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff", "#111827"]
const BRUSH_SIZES = [3, 7, 14]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar a imagem editada.")), "image/png", 0.96)
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Não foi possível carregar esta imagem para edição."))
    image.src = source
  })
}

function editedFileName(name?: string) {
  const clean = (name || "imagem").replace(/\.[^.]+$/, "").trim() || "imagem"
  return `${clean}-editada.png`
}

function defaultCrop(width: number, height: number): Rect {
  const insetX = Math.round(width * 0.04)
  const insetY = Math.round(height * 0.04)
  return {
    x: insetX,
    y: insetY,
    width: Math.max(1, width - insetX * 2),
    height: Math.max(1, height - insetY * 2),
  }
}

export function ImageEditorDialog({
  open,
  onOpenChange,
  src,
  name,
  onComplete,
}: ImageEditorDialogProps) {
  const [mode, setMode] = React.useState<EditorMode>("crop")
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [brushColor, setBrushColor] = React.useState(BRUSH_COLORS[0])
  const [brushSize, setBrushSize] = React.useState(BRUSH_SIZES[1])
  const [displaySize, setDisplaySize] = React.useState({ width: 0, height: 0 })
  const [cropRect, setCropRect] = React.useState<Rect>({ x: 0, y: 0, width: 1, height: 1 })
  const [historyIndex, setHistoryIndex] = React.useState(-1)
  const [historyLength, setHistoryLength] = React.useState(0)

  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const previewRef = React.useRef<HTMLCanvasElement | null>(null)
  const workRef = React.useRef<HTMLCanvasElement | null>(null)
  const historyRef = React.useRef<Blob[]>([])
  const drawPointerRef = React.useRef<number | null>(null)
  const lastDrawPointRef = React.useRef<Point | null>(null)
  const cropGestureRef = React.useRef<{ handle: CropHandle; start: Point; rect: Rect; pointerId: number } | null>(null)

  const renderPreview = React.useCallback(() => {
    const preview = previewRef.current
    const work = workRef.current
    if (!preview || !work || !work.width || !work.height) return
    if (preview.width !== work.width) preview.width = work.width
    if (preview.height !== work.height) preview.height = work.height
    const context = preview.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, preview.width, preview.height)
    context.drawImage(work, 0, 0)
  }, [])

  const fitStage = React.useCallback(() => {
    const stage = stageRef.current
    const work = workRef.current
    if (!stage || !work || !work.width || !work.height) return
    const rect = stage.getBoundingClientRect()
    const maxWidth = Math.max(120, rect.width - 24)
    const maxHeight = Math.max(160, rect.height - 24)
    const ratio = Math.min(maxWidth / work.width, maxHeight / work.height)
    setDisplaySize({
      width: Math.max(1, Math.round(work.width * ratio)),
      height: Math.max(1, Math.round(work.height * ratio)),
    })
  }, [])

  const resetCrop = React.useCallback(() => {
    const work = workRef.current
    if (!work) return
    setCropRect(defaultCrop(work.width, work.height))
  }, [])

  const replaceWorkFromBlob = React.useCallback(async (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob)
    try {
      const image = await loadImage(objectUrl)
      const work = workRef.current ?? document.createElement("canvas")
      workRef.current = work
      work.width = image.naturalWidth || image.width
      work.height = image.naturalHeight || image.height
      const context = work.getContext("2d")
      if (!context) throw new Error("Canvas indisponível neste dispositivo.")
      context.clearRect(0, 0, work.width, work.height)
      context.drawImage(image, 0, 0)
      renderPreview()
      resetCrop()
      requestAnimationFrame(fitStage)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }, [fitStage, renderPreview, resetCrop])

  const commitHistory = React.useCallback(async () => {
    const work = workRef.current
    if (!work) return
    const blob = await canvasBlob(work)
    const currentIndex = historyIndex
    let next = historyRef.current.slice(0, Math.max(0, currentIndex + 1))
    next.push(blob)
    if (next.length > MAX_HISTORY_STEPS) next = next.slice(next.length - MAX_HISTORY_STEPS)
    historyRef.current = next
    const nextIndex = next.length - 1
    setHistoryIndex(nextIndex)
    setHistoryLength(next.length)
  }, [historyIndex])

  React.useEffect(() => {
    if (!open || !src) return
    let cancelled = false
    setLoading(true)
    setError("")
    setMode("crop")
    historyRef.current = []
    setHistoryIndex(-1)
    setHistoryLength(0)

    void (async () => {
      try {
        const response = await fetch(src)
        if (!response.ok) throw new Error("Não foi possível carregar esta imagem para edição.")
        const blob = await response.blob()
        if (cancelled) return
        await replaceWorkFromBlob(blob)
        if (cancelled) return
        const initial = await canvasBlob(workRef.current!)
        historyRef.current = [initial]
        setHistoryIndex(0)
        setHistoryLength(1)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Não foi possível abrir o editor de imagem.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [open, replaceWorkFromBlob, src])

  React.useEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(() => fitStage())
    observer.observe(stage)
    fitStage()
    return () => observer.disconnect()
  }, [fitStage, open])

  async function restoreHistory(nextIndex: number) {
    const blob = historyRef.current[nextIndex]
    if (!blob) return
    setLoading(true)
    try {
      await replaceWorkFromBlob(blob)
      setHistoryIndex(nextIndex)
    } finally {
      setLoading(false)
    }
  }

  async function applyCrop() {
    const work = workRef.current
    if (!work) return
    const x = Math.round(clamp(cropRect.x, 0, work.width - 1))
    const y = Math.round(clamp(cropRect.y, 0, work.height - 1))
    const width = Math.max(1, Math.round(Math.min(cropRect.width, work.width - x)))
    const height = Math.max(1, Math.round(Math.min(cropRect.height, work.height - y)))
    if (x === 0 && y === 0 && width === work.width && height === work.height) return

    const temporary = document.createElement("canvas")
    temporary.width = width
    temporary.height = height
    const temporaryContext = temporary.getContext("2d")
    if (!temporaryContext) return
    temporaryContext.drawImage(work, x, y, width, height, 0, 0, width, height)

    work.width = width
    work.height = height
    const workContext = work.getContext("2d")
    if (!workContext) return
    workContext.drawImage(temporary, 0, 0)
    renderPreview()
    resetCrop()
    fitStage()
    await commitHistory()
  }

  async function rotate(direction: 1 | -1) {
    const work = workRef.current
    if (!work) return
    const temporary = document.createElement("canvas")
    temporary.width = work.height
    temporary.height = work.width
    const context = temporary.getContext("2d")
    if (!context) return
    context.translate(temporary.width / 2, temporary.height / 2)
    context.rotate(direction * Math.PI / 2)
    context.drawImage(work, -work.width / 2, -work.height / 2)

    work.width = temporary.width
    work.height = temporary.height
    const workContext = work.getContext("2d")
    if (!workContext) return
    workContext.drawImage(temporary, 0, 0)
    renderPreview()
    resetCrop()
    fitStage()
    await commitHistory()
  }

  function clientToImage(clientX: number, clientY: number): Point | null {
    const preview = previewRef.current
    const work = workRef.current
    if (!preview || !work) return null
    const rect = preview.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: clamp((clientX - rect.left) * (work.width / rect.width), 0, work.width),
      y: clamp((clientY - rect.top) * (work.height / rect.height), 0, work.height),
    }
  }

  function handleDrawPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "draw" || loading) return
    event.preventDefault()
    const point = clientToImage(event.clientX, event.clientY)
    const work = workRef.current
    if (!point || !work) return
    drawPointerRef.current = event.pointerId
    lastDrawPointRef.current = point
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Safari */ }

    const context = work.getContext("2d")
    if (!context) return
    context.strokeStyle = brushColor
    context.lineWidth = brushSize * Math.max(1, work.width / Math.max(1, displaySize.width))
    context.lineCap = "round"
    context.lineJoin = "round"
    context.beginPath()
    context.moveTo(point.x, point.y)
    context.lineTo(point.x + 0.01, point.y + 0.01)
    context.stroke()
    renderPreview()
  }

  function handleDrawPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "draw" || drawPointerRef.current !== event.pointerId) return
    event.preventDefault()
    const point = clientToImage(event.clientX, event.clientY)
    const previous = lastDrawPointRef.current
    const work = workRef.current
    if (!point || !previous || !work) return
    const context = work.getContext("2d")
    if (!context) return
    context.strokeStyle = brushColor
    context.lineWidth = brushSize * Math.max(1, work.width / Math.max(1, displaySize.width))
    context.lineCap = "round"
    context.lineJoin = "round"
    context.beginPath()
    context.moveTo(previous.x, previous.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    lastDrawPointRef.current = point
    renderPreview()
  }

  function handleDrawPointerEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    if (drawPointerRef.current !== event.pointerId) return
    event.preventDefault()
    drawPointerRef.current = null
    lastDrawPointRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch { /* Safari */ }
    void commitHistory()
  }

  function beginCropGesture(handle: CropHandle, event: React.PointerEvent<HTMLElement>) {
    if (mode !== "crop" || loading) return
    const point = clientToImage(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    cropGestureRef.current = { handle, start: point, rect: cropRect, pointerId: event.pointerId }
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* Safari */ }
  }

  function moveCropGesture(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = cropGestureRef.current
    const work = workRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !work) return
    event.preventDefault()
    const point = clientToImage(event.clientX, event.clientY)
    if (!point) return
    const dx = point.x - gesture.start.x
    const dy = point.y - gesture.start.y
    const start = gesture.rect

    if (gesture.handle === "move") {
      setCropRect({
        ...start,
        x: clamp(start.x + dx, 0, work.width - start.width),
        y: clamp(start.y + dy, 0, work.height - start.height),
      })
      return
    }

    let left = start.x
    let top = start.y
    let right = start.x + start.width
    let bottom = start.y + start.height
    if (gesture.handle.includes("w")) left = clamp(start.x + dx, 0, right - MIN_CROP_PIXELS)
    if (gesture.handle.includes("e")) right = clamp(start.x + start.width + dx, left + MIN_CROP_PIXELS, work.width)
    if (gesture.handle.includes("n")) top = clamp(start.y + dy, 0, bottom - MIN_CROP_PIXELS)
    if (gesture.handle.includes("s")) bottom = clamp(start.y + start.height + dy, top + MIN_CROP_PIXELS, work.height)
    setCropRect({ x: left, y: top, width: right - left, height: bottom - top })
  }

  function endCropGesture(event: React.PointerEvent<HTMLDivElement>) {
    if (cropGestureRef.current?.pointerId !== event.pointerId) return
    cropGestureRef.current = null
  }

  async function complete() {
    const work = workRef.current
    if (!work || saving) return
    setSaving(true)
    setError("")
    try {
      const blob = await canvasBlob(work)
      const file = new File([blob], editedFileName(name), { type: "image/png", lastModified: Date.now() })
      onComplete(file)
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir a edição.")
    } finally {
      setSaving(false)
    }
  }

  const work = workRef.current
  const cropStyle = work && displaySize.width > 0 ? {
    left: `${(cropRect.x / work.width) * displaySize.width}px`,
    top: `${(cropRect.y / work.height) * displaySize.height}px`,
    width: `${(cropRect.width / work.width) * displaySize.width}px`,
    height: `${(cropRect.height / work.height) * displaySize.height}px`,
  } : undefined

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent
        className="flex h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(94dvh,980px)] sm:w-[min(96vw,1500px)] sm:max-w-none"
        data-no-swipe-reply="true"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogHeader className="shrink-0 border-b border-border px-3 py-3 pr-12 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm sm:text-base">Editar imagem</DialogTitle>
              <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">{name || "Imagem"} · recorte livre e desenho</p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/25 p-1">
              <Button type="button" variant={mode === "crop" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => setMode("crop")}>
                <Crop className="size-3.5" /> <span className="hidden sm:inline">Recortar</span>
              </Button>
              <Button type="button" variant={mode === "draw" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => setMode("draw")}>
                <Paintbrush className="size-3.5" /> <span className="hidden sm:inline">Desenhar</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" disabled={historyIndex <= 0 || loading} onClick={() => void restoreHistory(historyIndex - 1)} title="Desfazer"><Undo2 className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={historyIndex < 0 || historyIndex >= historyLength - 1 || loading} onClick={() => void restoreHistory(historyIndex + 1)} title="Refazer"><Redo2 className="size-4" /></Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button type="button" variant="ghost" size="icon-sm" disabled={loading} onClick={() => void rotate(-1)} title="Girar para a esquerda"><RotateCcw className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={loading} onClick={() => void rotate(1)} title="Girar para a direita"><RotateCw className="size-4" /></Button>
          </div>

          {mode === "crop" ? (
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={resetCrop} disabled={loading}>Redefinir</Button>
              <Button type="button" size="sm" className="h-8" onClick={() => void applyCrop()} disabled={loading}><Crop className="size-3.5" /> Aplicar recorte</Button>
            </div>
          ) : (
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/20 p-1">
                {BRUSH_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setBrushColor(color)}
                    className={cn("size-6 rounded-full border-2 transition-transform", brushColor === color ? "scale-110 border-primary" : "border-background/80")}
                    style={{ backgroundColor: color }}
                    aria-label={`Cor ${color}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/20 p-1">
                {BRUSH_SIZES.map((size) => (
                  <button key={size} type="button" onClick={() => setBrushSize(size)} className={cn("flex size-7 items-center justify-center rounded-md", brushSize === size && "bg-primary/10 text-primary")} title={`Traço ${size}px`}>
                    <span className="rounded-full bg-current" style={{ width: Math.max(3, size), height: Math.max(3, size) }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-black/[0.94] p-3 sm:p-4">
          {loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center gap-2 bg-black/35 text-sm text-white/75"><LoaderCircle className="size-5 animate-spin" /> Carregando editor...</div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-6 text-center text-sm text-white/75">{error}</div>
          )}

          {!error && (
            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4">
              <div
                className="relative shrink-0 overflow-visible"
                style={{ width: displaySize.width || 1, height: displaySize.height || 1, touchAction: "none" }}
                onPointerMove={moveCropGesture}
                onPointerUp={endCropGesture}
                onPointerCancel={endCropGesture}
              >
                <canvas
                  ref={previewRef}
                  className={cn("block bg-black shadow-2xl", mode === "draw" ? "cursor-crosshair" : "cursor-default")}
                  style={{ width: displaySize.width || 1, height: displaySize.height || 1, touchAction: "none" }}
                  onPointerDown={handleDrawPointerDown}
                  onPointerMove={handleDrawPointerMove}
                  onPointerUp={handleDrawPointerEnd}
                  onPointerCancel={handleDrawPointerEnd}
                />

                {mode === "crop" && cropStyle && (
                  <div
                    className="absolute border-2 border-white/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                    style={{ ...cropStyle, touchAction: "none" }}
                    onPointerDown={(event) => beginCropGesture("move", event)}
                  >
                    <span className="pointer-events-none absolute left-1/3 top-0 h-full w-px bg-white/35" />
                    <span className="pointer-events-none absolute left-2/3 top-0 h-full w-px bg-white/35" />
                    <span className="pointer-events-none absolute left-0 top-1/3 h-px w-full bg-white/35" />
                    <span className="pointer-events-none absolute left-0 top-2/3 h-px w-full bg-white/35" />
                    {(["nw", "ne", "se", "sw"] as CropHandle[]).map((handle) => {
                      const position = handle === "nw" ? "-left-2 -top-2" : handle === "ne" ? "-right-2 -top-2" : handle === "se" ? "-bottom-2 -right-2" : "-bottom-2 -left-2"
                      return <button key={handle} type="button" aria-label={`Recorte ${handle}`} className={cn("absolute z-10 size-5 rounded-full border-2 border-black/40 bg-white shadow", position)} onPointerDown={(event) => beginCropGesture(handle, event)} />
                    })}
                    {(["n", "e", "s", "w"] as CropHandle[]).map((handle) => {
                      const position = handle === "n" ? "left-1/2 -top-2 -translate-x-1/2" : handle === "e" ? "-right-2 top-1/2 -translate-y-1/2" : handle === "s" ? "-bottom-2 left-1/2 -translate-x-1/2" : "-left-2 top-1/2 -translate-y-1/2"
                      return <button key={handle} type="button" aria-label={`Recorte ${handle}`} className={cn("absolute z-10 size-4 rounded-full border-2 border-black/40 bg-white shadow", position)} onPointerDown={(event) => beginCropGesture(handle, event)} />
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-3 py-3 sm:px-5">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[0.65rem] text-muted-foreground">A imagem original não é alterada. A edição gera uma nova imagem PNG.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button type="button" onClick={() => void complete()} disabled={loading || Boolean(error) || saving}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                Concluir edição
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
