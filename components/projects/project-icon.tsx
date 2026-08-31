"use client"

import type { LucideIcon } from "lucide-react"
import {
  Boxes,
  Bug,
  Code2,
  CreditCard,
  Database,
  FolderKanban,
  Globe2,
  Monitor,
  Package,
  Rocket,
  Server,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Store,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"

export const PROJECT_ICON_OPTIONS = [
  { key: "folder-kanban", label: "Projeto", icon: FolderKanban },
  { key: "code", label: "Código", icon: Code2 },
  { key: "smartphone", label: "Mobile", icon: Smartphone },
  { key: "monitor", label: "Desktop / Web", icon: Monitor },
  { key: "server", label: "Servidor", icon: Server },
  { key: "database", label: "Banco de dados", icon: Database },
  { key: "globe", label: "Web", icon: Globe2 },
  { key: "shopping-cart", label: "E-commerce", icon: ShoppingCart },
  { key: "credit-card", label: "Pagamentos", icon: CreditCard },
  { key: "store", label: "Loja / PDV", icon: Store },
  { key: "package", label: "Produto", icon: Package },
  { key: "boxes", label: "Módulos", icon: Boxes },
  { key: "wrench", label: "Manutenção", icon: Wrench },
  { key: "rocket", label: "Entrega / Release", icon: Rocket },
  { key: "bug", label: "Correções", icon: Bug },
  { key: "shield", label: "Segurança / AQS", icon: ShieldCheck },
] as const

export type ProjectIconKey = (typeof PROJECT_ICON_OPTIONS)[number]["key"]

const iconMap = Object.fromEntries(
  PROJECT_ICON_OPTIONS.map((option) => [option.key, option.icon]),
) as Record<string, LucideIcon>

export function normalizeProjectIcon(value?: string | null): ProjectIconKey {
  return PROJECT_ICON_OPTIONS.some((option) => option.key === value)
    ? (value as ProjectIconKey)
    : "folder-kanban"
}

export function ProjectIcon({
  icon,
  className,
}: {
  icon?: string | null
  className?: string
}) {
  const Icon = iconMap[normalizeProjectIcon(icon)] ?? FolderKanban
  return <Icon aria-hidden className={cn("size-4", className)} />
}

export function ProjectIconPicker({
  value,
  onChange,
}: {
  value?: string | null
  onChange: (value: ProjectIconKey) => void
}) {
  const selected = normalizeProjectIcon(value)

  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-4" role="radiogroup" aria-label="Ícone do projeto">
      {PROJECT_ICON_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = option.key === selected
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.key)}
            className={cn(
              "group flex aspect-square min-h-11 items-center justify-center rounded-xl border transition-all",
              active
                ? "border-primary/40 bg-primary/10 text-primary shadow-sm ring-2 ring-primary/10"
                : "border-border bg-background text-muted-foreground hover:border-primary/25 hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 transition-transform group-hover:scale-105" />
          </button>
        )
      })}
    </div>
  )
}
