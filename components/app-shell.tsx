"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { StoreProvider } from "@/lib/store"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { AppLoadingSkeleton } from "@/components/app-loading-skeleton"
import { useStore } from "@/lib/store"
import { ArrowLeft, ShieldAlert } from "lucide-react"
import { ACCESS_ROLE_LABELS, type AccessRole } from "@/lib/types"
import { IncomingCallCenter } from "@/components/chat/incoming-call-center"
import { MeetingSessionHost } from "@/components/chat/meeting-session-host"
import { BrowserNotifications } from "@/components/notifications/browser-notifications"
import { FollowUpAppBadge } from "@/components/notifications/follow-up-app-badge"
import { MemberProfileProvider } from "@/components/member-profile-popover"
import { DeveloperShiftNotifier } from "@/components/developer/developer-shift-notifier"
import { DeveloperAutomationAgent } from "@/components/developer/developer-automation-agent"
import { OPEN_FOLLOW_UP_EVENT, followUpHref, type FollowUpOpenDetail } from "@/lib/follow-up-launcher"
import { cn } from "@/lib/utils"
import { PrimaryColorSync } from "@/components/primary-color-sync"
import { TimerIdleGuard } from "@/components/timer-idle-guard"
import { DevboardLogo } from "@/components/devboard-logo"
import { FocusedRunningTimer } from "@/components/focused-running-timer"


function canAccessPath(role: AccessRole, pathname: string) {
  // O Painel Dev é pessoal e exclusivo da role developer. Nem admin herda acesso.
  if (pathname.startsWith("/dev")) return role === "developer"
  // Relatórios gerenciais são uma área administrativa: não basta esconder o item do menu.
  // A rota também precisa ser bloqueada para acesso direto por URL.
  if (pathname.startsWith("/relatorios")) return role === "admin"
  if (role === "admin") return true
  if (pathname.startsWith("/solicitacoes/aqs")) return role === "aqs"
  if (pathname.startsWith("/solicitacoes/dev")) return role === "developer"
  if (pathname.startsWith("/analise")) return role === "aqs" || role === "developer"
  if (pathname.startsWith("/projetos") || pathname.startsWith("/horas") || pathname.startsWith("/agenda")) {
    return role === "developer"
  }
  return true
}

function AppBootstrapScreen({ label = "Carregando Devboard" }: { label?: string }) {
  return (
    <div className="flex h-dvh min-h-dvh w-full items-center justify-center overflow-hidden bg-background px-6" aria-label={label}>
      <div className="flex flex-col items-center text-center">
        <DevboardLogo className="size-14" priority />
        <div className="mt-5 h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
        <p className="mt-3 text-xs font-medium text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function AccessDenied({ role }: { role: AccessRole }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <ShieldAlert className="size-5" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Acesso restrito para esta função</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Seu perfil está como <strong className="font-medium text-foreground">{ACCESS_ROLE_LABELS[role]}</strong>. O Devboard mantém esta área protegida conforme as permissões do workspace.
      </p>
    </div>
  )
}

// Routes that render standalone, without the dashboard chrome.
const BARE_ROUTES = ["/login"]

function AppShellContent({ children, menuOpen, setMenuOpen }: { children: React.ReactNode; menuOpen: boolean; setMenuOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const { hydrated, currentUserRole, preferences, aqsReviews } = useStore()
  const pathname = usePathname()
  const router = useRouter()

  React.useEffect(() => {
    function navigateToFollowUp(detail: FollowUpOpenDetail = {}) {
      if (preferences.interfaceMode === "focused") {
        const params = new URLSearchParams()
        params.set("space", "project")
        if (detail.projectId) params.set("project", detail.projectId)
        if (detail.activityId) params.set("activity", detail.activityId)
        if (detail.subactivityId) params.set("sub", detail.subactivityId)
        if (detail.timelineId) params.set("focus", detail.timelineId)
        router.push(`/?${params.toString()}`)
        return
      }
      router.push(followUpHref(detail))
    }

    function onOpenFollowUp(event: Event) {
      navigateToFollowUp((event as CustomEvent<FollowUpOpenDetail>).detail ?? {})
    }

    function onFollowUpShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || event.code !== "KeyP") return
      event.preventDefault()
      if (window.location.pathname.startsWith("/acompanhamento")) return

      const projectMatch = window.location.pathname.match(/^\/projetos\/([^/]+)/)
      const subactivityId = window.location.hash.startsWith("#sub-")
        ? window.location.hash.slice("#sub-".length)
        : null
      navigateToFollowUp({
        projectId: projectMatch?.[1],
        subactivityId,
      })
    }

    window.addEventListener(OPEN_FOLLOW_UP_EVENT, onOpenFollowUp)
    window.addEventListener("keydown", onFollowUpShortcut)
    return () => {
      window.removeEventListener(OPEN_FOLLOW_UP_EVENT, onOpenFollowUp)
      window.removeEventListener("keydown", onFollowUpShortcut)
    }
  }, [preferences.interfaceMode, router])

  React.useEffect(() => {
    if (!hydrated || preferences.interfaceMode !== "focused") return
    const currentPath = window.location.pathname
    if (currentPath === "/" || currentPath.startsWith("/config") || currentPath.startsWith("/compartilhar")) return

    const currentSearch = new URLSearchParams(window.location.search)
    let target = "/"

    if (currentPath.startsWith("/acompanhamento")) {
      const params = new URLSearchParams(currentSearch)
      params.set("space", "project")
      params.delete("mine")
      target = `/?${params.toString()}`
    } else if (currentPath.startsWith("/minhas-tarefas")) {
      target = "/?space=project"
    } else if (currentPath.startsWith("/chat")) {
      target = "/?space=chat"
    } else if (currentPath.startsWith("/solicitacoes/")) {
      const requestId = currentPath.split("/").filter(Boolean)[1]
      target = requestId ? `/?space=requests&request=${encodeURIComponent(requestId)}` : "/?space=requests"
    } else if (currentPath.startsWith("/solicitacoes")) {
      target = "/?space=requests"
    } else if (currentPath.startsWith("/analise")) {
      const subId = currentSearch.get("sub")
      const review = subId ? aqsReviews.find((item) => item.subactivityId === subId) : null
      target = review
        ? `/?space=aqs&review=${encodeURIComponent(review.id)}&project=${encodeURIComponent(review.projectId)}&activity=${encodeURIComponent(review.activityId)}&sub=${encodeURIComponent(review.subactivityId)}`
        : "/?space=aqs"
    } else {
      const projectMatch = currentPath.match(/^\/projetos\/([^/]+)/)
      if (projectMatch) {
        const hash = window.location.hash
        const subId = hash.startsWith("#sub-") ? hash.slice(5) : null
        target = `/?space=project&project=${encodeURIComponent(projectMatch[1])}${subId ? `&sub=${encodeURIComponent(subId)}` : ""}`
      }
    }

    router.replace(target)
  }, [aqsReviews, hydrated, pathname, preferences.interfaceMode, router])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer") return

    function focusDeveloperPanel() {
      if (window.location.pathname.startsWith("/dev")) {
        if (window.location.hash !== "#dev-session") window.history.replaceState(null, "", "/dev#dev-session")
        window.requestAnimationFrame(() => document.getElementById("dev-session")?.focus({ preventScroll: false }))
        return
      }
      router.push("/dev#dev-session")
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.code !== "Digit7") return
      event.preventDefault()
      focusDeveloperPanel()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [currentUserRole, hydrated, router])

  const sharePage = pathname.startsWith("/compartilhar")
  const followUpPage = pathname.startsWith("/acompanhamento")
  const myTasksPage = pathname.startsWith("/minhas-tarefas")
  const requestsPage = pathname.startsWith("/solicitacoes")
  const analysisPage = pathname.startsWith("/analise")
  const focusedMode = preferences.interfaceMode === "focused"
  const focusedHome = focusedMode && pathname === "/"
  const focusedLegacyRoute = focusedMode
    && pathname !== "/"
    && !pathname.startsWith("/config")
    && !pathname.startsWith("/compartilhar")
  const fullHeightWorkspace = focusedHome || followUpPage || myTasksPage || requestsPage || analysisPage

  // A preferência de interface vem do banco. Enquanto o snapshot inicial ainda
  // não terminou, não renderizamos o chrome do modo Completo usando o valor
  // default. Isso elimina o flash de sidebar/topbar ao atualizar uma conta que
  // já usa o Modo Resumido e também evita o layout recalcular duas vezes.
  if (!hydrated && !sharePage) {
    return <AppBootstrapScreen />
  }

  // Deep links antigos são convertidos para o workspace Resumido pelo effect
  // acima. Enquanto o router.replace acontece, seguramos a tela para que /chat,
  // /acompanhamento ou /projetos nunca apareçam por um frame no layout antigo.
  if (hydrated && focusedLegacyRoute) {
    return <AppBootstrapScreen label="Abrindo Modo Resumido" />
  }

  if (sharePage) {
    return (
      <div className="min-h-dvh bg-background">
        {hydrated ? children : <AppLoadingSkeleton />}
        {hydrated && <FocusedRunningTimer />}
        <BackendErrorBanner />
      </div>
    )
  }

  return (
    <div className={cn(
      "flex max-w-full overflow-x-clip",
      fullHeightWorkspace ? "h-dvh overflow-hidden" : "min-h-screen",
    )}>
      {!focusedMode && <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />}
      <div className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
        {focusedMode && pathname.startsWith("/config") && (
          <button
            type="button"
            onClick={() => router.push("/")}
            className="fixed left-3 top-3 z-[90] inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card/95 px-3 text-xs font-semibold text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted"
            title="Voltar ao Modo Resumido"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Voltar ao Resumido</span>
          </button>
        )}
        {preferences.interfaceMode === "complete" && <Topbar onMenu={() => setMenuOpen(true)} />}
        <main className={cn(
          "min-w-0 max-w-full flex-1",
          fullHeightWorkspace
            ? "min-h-0 overflow-hidden p-0"
            : "px-3 py-5 sm:px-4 sm:py-6 md:px-6 lg:px-8",
          focusedMode && pathname.startsWith("/config") && "pt-16 sm:pt-16",
        )}>
          {hydrated ? (canAccessPath(currentUserRole, pathname) ? children : <AccessDenied role={currentUserRole} />) : <AppLoadingSkeleton />}
        </main>
        <BackendErrorBanner />
        <BrowserNotifications />
        <FollowUpAppBadge />
        <TimerIdleGuard />
        <FocusedRunningTimer />
        <DeveloperShiftNotifier />
        <DeveloperAutomationAgent />
        <IncomingCallCenter />
        <MeetingSessionHost />
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const pathname = usePathname()

  if (BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return <>{children}</>
  }

  return (
    <StoreProvider>
      <MemberProfileProvider>
        <PrimaryColorSync />
        <AppShellContent menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
          {children}
        </AppShellContent>
      </MemberProfileProvider>
    </StoreProvider>
  )
}
