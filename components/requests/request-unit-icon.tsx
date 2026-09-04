"use client"

import * as React from "react"
import {
  Boxes,
  BriefcaseBusiness,
  Building2,
  Factory,
  Headphones,
  Landmark,
  MapPin,
  Store,
  Warehouse,
} from "lucide-react"
import { cn } from "@/lib/utils"

const icons = {
  building: Building2,
  store: Store,
  warehouse: Warehouse,
  factory: Factory,
  office: BriefcaseBusiness,
  support: Headphones,
  landmark: Landmark,
  location: MapPin,
  boxes: Boxes,
} as const

export type RequestUnitIconName = keyof typeof icons

export const REQUEST_UNIT_ICON_OPTIONS: Array<{ value: RequestUnitIconName; label: string }> = [
  { value: "building", label: "Unidade" },
  { value: "store", label: "Loja" },
  { value: "warehouse", label: "Depósito" },
  { value: "factory", label: "Fábrica" },
  { value: "office", label: "Escritório" },
  { value: "support", label: "Suporte" },
  { value: "landmark", label: "Matriz" },
  { value: "location", label: "Local" },
  { value: "boxes", label: "Operação" },
]

export function normalizeRequestUnitIcon(value?: string | null): RequestUnitIconName {
  return value && value in icons ? value as RequestUnitIconName : "building"
}

export function RequestUnitIcon({
  icon,
  imageUrl,
  className,
  imageClassName,
}: {
  icon?: string | null
  imageUrl?: string | null
  className?: string
  imageClassName?: string
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={cn("size-full object-contain p-1", imageClassName)}
      />
    )
  }
  const Icon = icons[normalizeRequestUnitIcon(icon)]
  return <Icon className={cn("size-4", className)} />
}

export function RequestUnitIconPicker({ value, onChange }: { value: string; onChange: (value: RequestUnitIconName) => void }) {
  const selected = normalizeRequestUnitIcon(value)
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-9" role="radiogroup" aria-label="Ícone da unidade">
      {REQUEST_UNIT_ICON_OPTIONS.map((option) => {
        const Icon = icons[option.value]
        const active = option.value === selected
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex size-9 items-center justify-center rounded-xl border transition-colors",
              active
                ? "border-primary/35 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
          </button>
        )
      })}
    </div>
  )
}
