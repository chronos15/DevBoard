"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { FileImage, FileText, Files, Upload } from "lucide-react"
import { cn } from "@/lib/utils"

let activeOwnerId: string | null = null

function hasFilePayload(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files")
}

export function FileDropOverlay({
  enabled = true,
  title,
  description = "Solte para adicionar aos anexos. O arquivo ficará no preview antes do envio.",
  onFiles,
  scopeRef,
  className,
}: {
  enabled?: boolean
  title: string
  description?: string
  onFiles: (files: File[]) => void
  scopeRef?: React.RefObject<HTMLElement | null>
  className?: string
}) {
  const ownerIdRef = React.useRef(`taskboard-file-drop-${Math.random().toString(36).slice(2)}`)
  const [dragging, setDragging] = React.useState(false)
  const dragDepthRef = React.useRef(0)
  const draggingRef = React.useRef(false)
  const onFilesRef = React.useRef(onFiles)
  onFilesRef.current = onFiles

  const release = React.useCallback(() => {
    dragDepthRef.current = 0
    draggingRef.current = false
    setDragging(false)
    if (activeOwnerId === ownerIdRef.current) activeOwnerId = null
  }, [])

  React.useEffect(() => {
    if (!enabled) {
      release()
      return
    }

    const ownsEventTarget = (event: DragEvent) => {
      if (!scopeRef?.current) return true
      const target = event.target
      return target instanceof Node && scopeRef.current.contains(target)
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) return

      if (!draggingRef.current) {
        if (activeOwnerId && activeOwnerId !== ownerIdRef.current) return
        if (!ownsEventTarget(event)) return
        activeOwnerId = ownerIdRef.current
        draggingRef.current = true
        setDragging(true)
      }

      if (activeOwnerId !== ownerIdRef.current) return
      event.preventDefault()
      dragDepthRef.current += 1
    }

    const handleDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event) || activeOwnerId !== ownerIdRef.current) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }

    const handleDragLeave = (event: DragEvent) => {
      if (activeOwnerId !== ownerIdRef.current) return
      event.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) release()
    }

    const handleDrop = (event: DragEvent) => {
      if (!hasFilePayload(event) || activeOwnerId !== ownerIdRef.current) return
      event.preventDefault()
      event.stopPropagation()
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.size > 0)
      release()
      if (files.length) onFilesRef.current(files)
    }

    const handleBlur = () => {
      if (activeOwnerId === ownerIdRef.current) release()
    }

    window.addEventListener("dragenter", handleDragEnter, true)
    window.addEventListener("dragover", handleDragOver, true)
    window.addEventListener("dragleave", handleDragLeave, true)
    window.addEventListener("drop", handleDrop, true)
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("dragenter", handleDragEnter, true)
      window.removeEventListener("dragover", handleDragOver, true)
      window.removeEventListener("dragleave", handleDragLeave, true)
      window.removeEventListener("drop", handleDrop, true)
      window.removeEventListener("blur", handleBlur)
      release()
    }
  }, [enabled, release, scopeRef])

  if (!dragging || typeof document === "undefined") return null

  return createPortal(
    <div className={cn("pointer-events-none fixed inset-0 z-[500] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[1px]", className)} aria-hidden="true">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/35 bg-primary px-6 py-8 text-center text-primary-foreground shadow-2xl sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute inset-3 rounded-xl border border-dashed border-primary-foreground/55" />
        <div className="relative mx-auto flex h-20 w-28 items-center justify-center">
          <span className="absolute left-2 top-4 flex size-12 -rotate-12 items-center justify-center rounded-xl bg-primary-foreground/90 text-primary shadow-lg"><FileText className="size-6" /></span>
          <span className="absolute right-2 top-4 flex size-12 rotate-12 items-center justify-center rounded-xl bg-primary-foreground/90 text-primary shadow-lg"><FileImage className="size-6" /></span>
          <span className="relative z-10 flex size-14 items-center justify-center rounded-xl bg-primary-foreground text-primary shadow-xl"><Files className="size-7" /></span>
        </div>
        <div className="relative mt-2 flex items-center justify-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Upload className="size-5 shrink-0" />
          <span className="min-w-0 truncate">{title}</span>
        </div>
        <p className="relative mx-auto mt-2 max-w-sm text-xs leading-relaxed text-primary-foreground/85 sm:text-sm">{description}</p>
      </div>
    </div>,
    document.body,
  )
}
