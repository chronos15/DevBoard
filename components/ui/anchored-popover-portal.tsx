"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

type PopoverSide = "bottom" | "right"

type DesktopPosition = {
  width: number
  left?: number
  right?: number
  top?: number
  bottom?: number
}

function getDesktopPosition(anchor: DOMRect, side: PopoverSide, preferredWidth: number, rightBoundary?: number): DesktopPosition | null {
  if (typeof window === "undefined" || window.innerWidth < 768) return null

  const margin = 12
  const gap = 8
  const width = Math.min(preferredWidth, Math.max(280, window.innerWidth - margin * 2))

  if (side === "right") {
    const originRight = Math.max(anchor.right, rightBoundary ?? anchor.right)
    let left = originRight + gap
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, anchor.left - width - gap)
    }

    return {
      width,
      left,
      bottom: Math.max(margin, window.innerHeight - anchor.bottom),
    }
  }

  return {
    width,
    right: Math.max(margin, window.innerWidth - anchor.right),
    top: Math.min(window.innerHeight - margin, anchor.bottom + gap),
  }
}

/**
 * Popover ancorado renderizado diretamente no document.body.
 *
 * O portal evita que barras laterais com overflow:hidden criem um recorte no popup
 * (caso do modo resumido/Discord). Em mobile o painel continua ocupando a viewport
 * com margem segura; no desktop ele fica preso ao botão que o abriu.
 */
export function AnchoredPopoverPortal({
  open,
  anchorRef,
  onClose,
  side = "bottom",
  desktopWidth = 380,
  ariaLabel,
  className,
  children,
}: {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  side?: PopoverSide
  desktopWidth?: number
  ariaLabel: string
  className?: string
  children: React.ReactNode
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [desktopPosition, setDesktopPosition] = React.useState<DesktopPosition | null>(null)

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor || typeof window === "undefined") {
      setDesktopPosition(null)
      return
    }
    const anchorRect = anchor.getBoundingClientRect()
    const boundary = side === "right"
      ? anchor.closest<HTMLElement>("[data-floating-popover-boundary]")?.getBoundingClientRect()
      : undefined
    setDesktopPosition(getDesktopPosition(anchorRect, side, desktopWidth, boundary?.right))
  }, [anchorRef, desktopWidth, side])

  React.useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  React.useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    function onViewportChange() {
      updatePosition()
    }

    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onViewportChange)
    window.addEventListener("scroll", onViewportChange, true)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onViewportChange)
      window.removeEventListener("scroll", onViewportChange, true)
    }
  }, [anchorRef, onClose, open, updatePosition])

  if (!open || typeof document === "undefined") return null

  const style: React.CSSProperties | undefined = desktopPosition
    ? {
        width: desktopPosition.width,
        left: desktopPosition.left,
        right: desktopPosition.right,
        top: desktopPosition.top,
        bottom: desktopPosition.bottom,
      }
    : undefined

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[9998] bg-black/35 backdrop-blur-[1px] md:hidden"
        onClick={onClose}
        aria-label={`Fechar ${ariaLabel.toLocaleLowerCase("pt-BR")}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={ariaLabel}
        style={style}
        className={cn(
          "fixed inset-3 z-[9999] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl md:inset-auto md:block md:shadow-xl",
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
