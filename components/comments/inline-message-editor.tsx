"use client"

import * as React from "react"
import { Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function InlineMessageEditor({
  initialValue,
  onSave,
  onCancel,
  className,
  maxLength = 8000,
}: {
  initialValue: string
  onSave: (value: string) => Promise<boolean>
  onCancel: () => void
  className?: string
  maxLength?: number
}) {
  const [value, setValue] = React.useState(initialValue)
  const [saving, setSaving] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  function resize(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(220, Math.max(56, textarea.scrollHeight))}px`
  }

  React.useLayoutEffect(() => {
    if (textareaRef.current) resize(textareaRef.current)
  }, [])

  async function save() {
    const next = value.trim()
    if (!next || next === initialValue.trim() || saving) {
      if (next === initialValue.trim()) onCancel()
      return
    }
    setSaving(true)
    try {
      const ok = await onSave(next)
      if (ok) onCancel()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn("mt-1.5 min-w-0", className)}>
      <textarea
        ref={textareaRef}
        value={value}
        maxLength={maxLength}
        disabled={saving}
        onChange={(event) => {
          setValue(event.target.value)
          resize(event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onCancel()
            return
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            void save()
          }
        }}
        className="min-h-14 w-full resize-none rounded-xl border border-primary/30 bg-background px-3 py-2 text-sm leading-relaxed outline-none ring-2 ring-primary/8 transition-colors focus:border-primary/55 disabled:opacity-70"
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.58rem] text-muted-foreground">Esc cancela · Enter salva · Shift+Enter quebra linha</span>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[0.65rem]" onClick={onCancel} disabled={saving}>
            <X className="size-3" /> Cancelar
          </Button>
          <Button type="button" size="sm" className="h-7 px-2 text-[0.65rem]" onClick={() => void save()} disabled={saving || !value.trim()}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Salvar
          </Button>
        </div>
      </div>
    </div>
  )
}
