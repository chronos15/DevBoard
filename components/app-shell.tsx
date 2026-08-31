"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { StoreProvider } from "@/lib/store"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { AppLoadingSkeleton } from "@/components/app-loading-skeleton"
import { useStore } from "@/lib/store"
import { ShieldAlert } from "lucide-react"
import { ACCESS_ROLE_LABELS, type AccessRole } from "@/lib/types"
import { IncomingCallCenter } from "@/components/chat/incoming-call-center"
import { BrowserNotifications } from "@/components/notifications/browser-notifications"
import { MemberProfileProvider } from "@/components/member-profile-popover"
import { DeveloperShiftNotifier } from "@/components/developer/developer-shift-notifier"
import { DeveloperAutomationAgent } from "@/components/developer/developer-automation-agent"
import { FollowUpModal } from "@/components/project-detail/follow-up-modal"


function canAccessPath(role: AccessRole, pathname: string) {
  // O Painel Dev é pessoal e exclusivo da role developer. Nem admin herda acesso.
  if (pathname.startsWith("/dev")) return role === "developer"
  if (role === "admin") return true
  if (pathname.startsWith("/analise")) return role === "aqs" || role === "developer"
  if (pathname.startsWith("/projetos") || pathname.startsWith("/horas") || pathname.startsWith("/agenda") || pathname.startsWith("/relatorios")) {
    return role === "developer"
  }
  return true
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
  const { hydrated, currentUserRole } = useStore()
  const pathname = usePathname()
  const router = useRouter()

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

  return (
    <div className="flex min-h-screen max-w-full overflow-x-clip">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 max-w-full flex-1 flex-col">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="min-w-0 max-w-full flex-1 px-3 py-5 sm:px-4 sm:py-6 md:px-6 lg:px-8">
          {hydrated ? (canAccessPath(currentUserRole, pathname) ? children : <AccessDenied role={currentUserRole} />) : <AppLoadingSkeleton />}
        </main>
        <BackendErrorBanner />
        <BrowserNotifications />
        <DeveloperShiftNotifier />
        <DeveloperAutomationAgent />
        <IncomingCallCenter />
        <FollowUpModal />
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
        <AppShellContent menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
          {children}
        </AppShellContent>
      </MemberProfileProvider>
    </StoreProvider>
  )
}
