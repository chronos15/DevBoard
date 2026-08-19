"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { StoreProvider } from "@/lib/store"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { BackendErrorBanner } from "@/components/backend-error-banner"
import { AppLoadingSkeleton } from "@/components/app-loading-skeleton"
import { useStore } from "@/lib/store"
import { IncomingCallCenter } from "@/components/chat/incoming-call-center"
import { BrowserNotifications } from "@/components/notifications/browser-notifications"

// Routes that render standalone, without the dashboard chrome.
const BARE_ROUTES = ["/login"]

function AppShellContent({ children, menuOpen, setMenuOpen }: { children: React.ReactNode; menuOpen: boolean; setMenuOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const { hydrated } = useStore()

  return (
    <div className="flex min-h-screen max-w-full overflow-x-clip">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 max-w-full flex-1 flex-col">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="min-w-0 max-w-full flex-1 px-3 py-5 sm:px-4 sm:py-6 md:px-6 lg:px-8">
          {hydrated ? children : <AppLoadingSkeleton />}
        </main>
        <BackendErrorBanner />
        <BrowserNotifications />
        <IncomingCallCenter />
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
      <AppShellContent menuOpen={menuOpen} setMenuOpen={setMenuOpen}>
        {children}
      </AppShellContent>
    </StoreProvider>
  )
}
