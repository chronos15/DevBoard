"use client"

import * as React from "react"
import { Check, Link2 } from "lucide-react"
import { cn } from "@/lib/utils"

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const area = document.createElement("textarea")
  area.value = value
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  document.execCommand("copy")
  area.remove()
}

export function CopyEntityLinkButton({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    try {
      const absolute = new URL(href, window.location.origin).toString()
      await copyText(absolute)
      setCopied(true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      draggable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
      onClick={copy}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        copied && "bg-success/10 text-success",
        className,
      )}
      title={copied ? "Link copiado" : label}
      aria-label={copied ? "Link copiado" : label}
    >
      {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
    </button>
  )
}
