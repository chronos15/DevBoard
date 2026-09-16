"use client"

import * as React from "react"
import { Check, Clock3, Minus, Plus, X } from "lucide-react"
import { AnchoredPopoverPortal } from "@/components/ui/anchored-popover-portal"
import { cn } from "@/lib/utils"
import { normalizeHHMMOnBlur, parseHHMMToDecimalHours, sanitizeHHMMTyping } from "@/lib/duration-input"

const QUICK_VALUES = ["00:30", "01:00", "02:00", "04:00", "08:00"]

function splitDuration(value: string) {
  const normalized = normalizeHHMMOnBlur(value)
  const parsed = parseHHMMToDecimalHours(normalized)
  if (!parsed) return { hours: 0, minutes: 0 }
  return {
    hours: Math.floor(parsed.totalMinutes / 60),
    minutes: parsed.totalMinutes % 60,
  }
}

function formatDuration(hours: number, minutes: number) {
  const safeHours = Math.max(0, Math.min(999, Math.trunc(Number.isFinite(hours) ? hours : 0)))
  const safeMinutes = Math.max(0, Math.min(59, Math.trunc(Number.isFinite(minutes) ? minutes : 0)))
  return `${String(safeHours).padStart(2, "0")}:${String(safeMinutes).padStart(2, "0")}`
}

export function DurationField({
  value,
  onChange,
  invalid = false,
  errorMessage,
  placeholder = "HH:mm",
  ariaLabel = "Estimativa em horas e minutos",
  className,
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  errorMessage?: string | null
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const initial = React.useMemo(() => splitDuration(value), [value])
  const [pickerHours, setPickerHours] = React.useState(initial.hours)
  const [pickerMinutes, setPickerMinutes] = React.useState(initial.minutes)

  React.useEffect(() => {
    if (!pickerOpen) return
    const parsed = splitDuration(value)
    setPickerHours(parsed.hours)
    setPickerMinutes(parsed.minutes)
  }, [pickerOpen, value])

  const pickerValid = pickerHours > 0 || pickerMinutes > 0

  function applyPicker() {
    if (!pickerValid) return
    onChange(formatDuration(pickerHours, pickerMinutes))
    setPickerOpen(false)
  }

  function selectQuick(next: string) {
    const parsed = splitDuration(next)
    setPickerHours(parsed.hours)
    setPickerMinutes(parsed.minutes)
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "flex h-10 items-center rounded-xl border bg-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15",
          invalid ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/10" : "border-border",
        )}
      >
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(sanitizeHHMMTyping(event.target.value))}
          onBlur={() => {
            const normalized = normalizeHHMMOnBlur(value)
            if (parseHHMMToDecimalHours(normalized)) onChange(normalized)
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground/65"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="mr-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Limpar estimativa"
            aria-label="Limpar estimativa"
          >
            <X className="size-3.5" />
          </button>
        )}
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setPickerOpen((current) => !current)}
          className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Abrir seletor de duração"
          aria-label="Abrir seletor de duração"
          aria-expanded={pickerOpen}
        >
          <Clock3 className="size-4" />
        </button>
      </div>

      {errorMessage ? (
        <p className="text-[0.68rem] leading-snug text-destructive">{errorMessage}</p>
      ) : (
        <p className="text-[0.66rem] leading-snug text-muted-foreground">Digite HH:mm ou use o seletor. Ex.: 01:30, 04:00 ou 12:45.</p>
      )}

      <AnchoredPopoverPortal
        open={pickerOpen}
        anchorRef={anchorRef}
        onClose={() => setPickerOpen(false)}
        desktopWidth={360}
        ariaLabel="Selecionar estimativa"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Definir estimativa</p>
            <p className="text-xs text-muted-foreground">Escolha horas e minutos.</p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Fechar seletor"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="rounded-2xl border border-border bg-muted/35 p-4 text-center">
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
              {formatDuration(pickerHours, pickerMinutes)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">horas : minutos</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Horas</label>
              <div className="flex h-11 items-center rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setPickerHours((current) => Math.max(0, current - 1))}
                  className="flex size-10 shrink-0 items-center justify-center rounded-l-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Diminuir uma hora"
                >
                  <Minus className="size-4" />
                </button>
                <input
                  type="number"
                  min={0}
                  max={999}
                  inputMode="numeric"
                  value={pickerHours}
                  onChange={(event) => setPickerHours(Math.max(0, Math.min(999, Number(event.target.value) || 0)))}
                  className="h-full min-w-0 flex-1 bg-transparent text-center font-mono text-base tabular-nums outline-none"
                  aria-label="Horas da estimativa"
                />
                <button
                  type="button"
                  onClick={() => setPickerHours((current) => Math.min(999, current + 1))}
                  className="flex size-10 shrink-0 items-center justify-center rounded-r-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Aumentar uma hora"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Minutos</label>
              <div className="flex h-11 items-center rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setPickerMinutes((current) => Math.max(0, current - 5))}
                  className="flex size-10 shrink-0 items-center justify-center rounded-l-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Diminuir cinco minutos"
                >
                  <Minus className="size-4" />
                </button>
                <input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={pickerMinutes}
                  onChange={(event) => setPickerMinutes(Math.max(0, Math.min(59, Number(event.target.value) || 0)))}
                  className="h-full min-w-0 flex-1 bg-transparent text-center font-mono text-base tabular-nums outline-none"
                  aria-label="Minutos da estimativa"
                />
                <button
                  type="button"
                  onClick={() => setPickerMinutes((current) => Math.min(59, current + 5))}
                  className="flex size-10 shrink-0 items-center justify-center rounded-r-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Aumentar cinco minutos"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Atalhos</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_VALUES.map((quick) => {
                const active = formatDuration(pickerHours, pickerMinutes) === quick
                return (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => selectQuick(quick)}
                    className={cn(
                      "rounded-xl border px-3 py-2 font-mono text-xs tabular-nums transition-colors",
                      active
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {quick}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border p-3 md:mt-0">
          <button
            type="button"
            onClick={() => {
              onChange("")
              setPickerHours(0)
              setPickerMinutes(0)
              setPickerOpen(false)
            }}
            className="h-10 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={applyPicker}
            disabled={!pickerValid}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="size-4" />
            Aplicar
          </button>
        </div>
      </AnchoredPopoverPortal>
    </div>
  )
}
