"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MessagesSquare,
  Settings,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useStore } from "@/lib/store"
import { DevboardLogo } from "@/components/devboard-logo"

const SIDEBAR_COLLAPSED_KEY = "devboard-sidebar-collapsed-v1"
const LEGACY_SIDEBAR_COLLAPSED_KEY = "cadence-sidebar-collapsed-v1"

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projetos", label: "Projetos", icon: FolderKanban },
  { href: "/horas", label: "Controle de horas", icon: Clock3 },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
]

const secondary = [
  { href: "/config", label: "Configurações", icon: Settings },
  { href: "/ajuda", label: "Ajuda", icon: LifeBuoy },
]

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const { signOut } = useStore()
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    try {
      setCollapsed((window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) ?? window.localStorage.getItem(LEGACY_SIDEBAR_COLLAPSED_KEY)) === "1")
    } catch {
      // Mantém o sidebar expandido quando o storage estiver indisponível.
    }
  }, [])

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
      } catch {
        // O estado visual continua funcionando mesmo sem persistência.
      }
      return next
    })
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  const navLinkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:min-h-10",
      collapsed && "lg:justify-center lg:gap-0 lg:px-0",
      active
        ? "bg-primary text-primary-foreground"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    )

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-64 flex-col overflow-visible bg-sidebar text-sidebar-foreground transition-[transform,width] duration-300 lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:translate-x-0",
          collapsed ? "lg:w-[76px]" : "lg:w-64",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute top-[4.65rem] -right-3 z-10 hidden size-7 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex"
          aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
          title={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>

        <div className={cn("flex shrink-0 items-center justify-between px-5 py-5", collapsed && "lg:justify-center lg:px-3")}>
          <Link
            href="/"
            className={cn("flex min-w-0 items-center gap-2.5", collapsed && "lg:justify-center")}
            onClick={onClose}
            title={collapsed ? "Devboard" : undefined}
          >
            <DevboardLogo className="size-9" priority />
            <span
              className={cn(
                "text-lg font-bold tracking-tight text-sidebar-accent-foreground transition-opacity",
                collapsed && "lg:hidden",
              )}
            >
              Devboard
            </span>
          </Link>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-sidebar-foreground hover:bg-sidebar-accent lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3 pb-3", collapsed && "lg:px-2")}>
          <p
            className={cn(
              "px-3 pt-2 pb-1 font-mono text-[0.65rem] tracking-widest text-sidebar-foreground/50 uppercase",
              collapsed && "lg:hidden",
            )}
          >
            Workspace
          </p>
          {nav.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={navLinkClass(active)}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                <item.icon className="size-[1.15rem] shrink-0" />
                <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
              </Link>
            )
          })}

          <div className={cn("hidden", collapsed && "lg:mx-2 lg:my-2 lg:block lg:border-t lg:border-sidebar-border")} />
          <p
            className={cn(
              "px-3 pt-5 pb-1 font-mono text-[0.65rem] tracking-widest text-sidebar-foreground/50 uppercase",
              collapsed && "lg:hidden",
            )}
          >
            Geral
          </p>
          {secondary.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={navLinkClass(active)}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                <item.icon className="size-[1.15rem] shrink-0" />
                <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className={cn("shrink-0 border-t border-sidebar-border px-3 py-3", collapsed && "lg:px-2")}>
          <button
            type="button"
            onClick={() => { onClose(); void signOut() }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "lg:justify-center lg:gap-0 lg:px-0",
            )}
            title={collapsed ? "Sair" : undefined}
            aria-label={collapsed ? "Sair" : undefined}
          >
            <LogOut className="size-[1.15rem] shrink-0" />
            <span className={cn(collapsed && "lg:hidden")}>Sair</span>
          </button>
        </div>
      </aside>
    </>
  )
}
