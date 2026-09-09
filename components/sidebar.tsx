"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  Inbox,
  LifeBuoy,
  LogOut,
  MessageSquareText,
  MessagesSquare,
  Settings,
  Sparkles,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useStore } from "@/lib/store"
import { DevboardLogo } from "@/components/devboard-logo"
import { ProjectIcon } from "@/components/projects/project-icon"
import { scopeFollowUpProjects } from "@/lib/follow-up-access"

const SIDEBAR_COLLAPSED_KEY = "devboard-sidebar-collapsed-v1"
const LEGACY_SIDEBAR_COLLAPSED_KEY = "cadence-sidebar-collapsed-v1"

const nav = [
  { href: "/", label: "Painel", icon: LayoutDashboard, roles: ["admin","developer","aqs","support","member"] },
  { href: "/dev", label: "Painel Dev", icon: Code2, roles: ["developer"] },
  { href: "/projetos", label: "Projetos", icon: FolderKanban, roles: ["admin","developer"] },
  { href: "/acompanhamento", label: "Acompanhamento", icon: MessageSquareText, roles: ["admin","developer","aqs","support","member"] },
  {
    href: "/solicitacoes",
    label: "Solicitações",
    icon: Inbox,
    roles: ["admin","developer","aqs","support","member"],
    children: [
      { href: "/solicitacoes", label: "Caixa de entrada", roles: ["admin","developer","aqs","support","member"] },
      { href: "/solicitacoes/minhas", label: "Minhas solicitações", roles: ["admin","developer","aqs","support","member"] },
      { href: "/solicitacoes/aqs", label: "AQS", roles: ["admin","aqs"] },
      { href: "/solicitacoes/dev", label: "DEV", roles: ["admin","developer"] },
      { href: "/solicitacoes/concluidas", label: "Concluídas", roles: ["admin","developer","aqs","support","member"] },
    ],
  },
  { href: "/analise", label: "Análise AQS", icon: ClipboardCheck, roles: ["admin","developer","aqs"] },
  { href: "/horas", label: "Controle de horas", icon: Clock3, roles: ["admin","developer"] },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, roles: ["admin","developer"] },
  { href: "/chat", label: "Chat", icon: MessagesSquare, roles: ["admin","developer","aqs","support","member"] },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, roles: ["admin"] },
] as const

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
  const {
    signOut,
    currentUserRole,
    currentUserId,
    preferences,
    projects,
  } = useStore()
  const [collapsed, setCollapsed] = React.useState(false)
  const [requestsOpen, setRequestsOpen] = React.useState(true)
  const focused = preferences.interfaceMode === "focused"
  const mineOnly = pathname.startsWith("/minhas-tarefas")

  const focusedProjects = React.useMemo(
    () => scopeFollowUpProjects(projects, currentUserId, currentUserRole).slice(0, 8),
    [currentUserId, currentUserRole, projects],
  )

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

  if (focused) {
    const focusedItemClass = (active: boolean) => cn(
      "group relative flex size-11 items-center justify-center rounded-[18px] transition-all",
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-sidebar-foreground/70 hover:rounded-[14px] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    )

    return (
      <>
        <aside className="sticky top-0 z-50 flex h-dvh w-[72px] shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground">
          <Link href="/" onClick={onClose} title="Início" className="mb-4 flex size-12 items-center justify-center rounded-2xl">
            <DevboardLogo className="size-10" priority />
          </Link>
          <Link href="/" onClick={onClose} title="Início" aria-label="Início" className={focusedItemClass(pathname === "/")}>
            <LayoutDashboard className="size-5" />
            {pathname === "/" && <span className="absolute -left-[13px] h-8 w-1 rounded-r-full bg-primary" />}
          </Link>
          <div className="mt-auto flex flex-col items-center gap-2">
            <Link href="/config" onClick={onClose} title="Configurações" aria-label="Configurações" className={focusedItemClass(pathname.startsWith("/config"))}>
              <Settings className="size-5" />
              {pathname.startsWith("/config") && <span className="absolute -left-[13px] h-8 w-1 rounded-r-full bg-primary" />}
            </Link>
          </div>
        </aside>
      </>
    )
  }

  const focusedNav = [
    { href: "/", label: "Início", icon: LayoutDashboard, active: pathname === "/" },
    { href: "/acompanhamento", label: "Acompanhamento", icon: MessageSquareText, active: pathname.startsWith("/acompanhamento") && !mineOnly },
    { href: "/minhas-tarefas", label: "Minhas tarefas", icon: ClipboardCheck, active: mineOnly },
    { href: "/solicitacoes", label: "Solicitações", icon: Inbox, active: pathname.startsWith("/solicitacoes") },
    { href: "/chat", label: "Chat", icon: MessagesSquare, active: pathname.startsWith("/chat") },
    ...(currentUserRole === "aqs"
      ? [{ href: "/analise", label: "Análise AQS", icon: ClipboardCheck, active: pathname.startsWith("/analise") }]
      : []),
  ]

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

        <nav
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            collapsed && "lg:px-2",
          )}
        >
          <p
            className={cn(
              "px-3 pt-2 pb-1 font-mono text-[0.65rem] tracking-widest text-sidebar-foreground/50 uppercase",
              collapsed && "lg:hidden",
            )}
          >
            {focused ? "Trabalho" : "Workspace"}
          </p>

          {focused ? (
            focusedNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={navLinkClass(item.active)}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                <item.icon className="size-[1.15rem] shrink-0" />
                <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
              </Link>
            ))
          ) : (
            nav.filter((item) => (item.roles as readonly string[]).includes(currentUserRole)).map((item) => {
              const active = isActive(item.href)
              const hasChildren = "children" in item && Array.isArray(item.children)
              if (!hasChildren) {
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
              }

              const visibleChildren = item.children.filter((child) => (child.roles as readonly string[]).includes(currentUserRole))
              const expanded = requestsOpen || active
              return (
                <div key={item.href} className="min-w-0">
                  <div className="relative">
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(navLinkClass(active), !collapsed && "pr-9")}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                    >
                      <item.icon className="size-[1.15rem] shrink-0" />
                      <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
                    </Link>
                    {!collapsed && (
                      <button
                        type="button"
                        onClick={(event) => { event.preventDefault(); setRequestsOpen((value) => !value) }}
                        className="absolute right-1.5 top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex"
                        aria-label={expanded ? "Recolher Solicitações" : "Expandir Solicitações"}
                      >
                        <ChevronDown className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")} />
                      </button>
                    )}
                  </div>
                  {!collapsed && expanded && (
                    <div className="ml-5 mt-1 hidden border-l border-sidebar-border pl-2 lg:block">
                      {visibleChildren.map((child) => {
                        const childActive = pathname === child.href
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onClose}
                            className={cn(
                              "flex min-h-8 items-center rounded-lg px-2.5 text-[0.72rem] font-medium transition-colors",
                              childActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/68 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                            )}
                          >
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {focused && (
            <>
              <p className={cn("px-3 pt-5 pb-1 font-mono text-[0.65rem] tracking-widest text-sidebar-foreground/50 uppercase", collapsed && "lg:hidden")}>
                Projetos
              </p>
              {!collapsed && focusedProjects.length === 0 && (
                <div className="mx-2 rounded-xl border border-dashed border-sidebar-border px-3 py-3 text-[0.68rem] leading-relaxed text-sidebar-foreground/55">
                  Seus projetos acompanhados aparecerão aqui.
                </div>
              )}
              {focusedProjects.map((project) => {
                const selected = false
                return (
                  <Link
                    key={project.id}
                    href={`/acompanhamento?project=${encodeURIComponent(project.id)}`}
                    onClick={onClose}
                    className={cn(
                      "flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      collapsed && "lg:justify-center lg:px-0",
                      selected
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/78 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                    title={collapsed ? project.name : undefined}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
                      <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-3.5" imageClassName="size-full rounded-none object-cover" />
                    </span>
                    <span className={cn("min-w-0 truncate", collapsed && "lg:hidden")}>{project.name}</span>
                  </Link>
                )
              })}
              {!collapsed && focusedProjects.length >= 8 && (
                <Link href="/acompanhamento" onClick={onClose} className="px-3 py-2 text-[0.68rem] font-medium text-sidebar-foreground/55 hover:text-sidebar-accent-foreground">
                  Ver todos no acompanhamento
                </Link>
              )}
            </>
          )}

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
          {focused && !collapsed && (
            <Link
              href="/config?section=aparencia"
              onClick={onClose}
              className="mb-2 flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/8 px-3 py-2.5 text-sidebar-accent-foreground transition-colors hover:bg-primary/12"
            >
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">Modo Focado</span>
                <span className="mt-0.5 block text-[0.62rem] leading-relaxed text-sidebar-foreground/55">Menos ruído, mesma estrutura.</span>
              </span>
            </Link>
          )}
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
