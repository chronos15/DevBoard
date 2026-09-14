"use client"

import { Skeleton } from "@/components/ui/skeleton"

function DestinationSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl px-2 py-2.5">
      <Skeleton className="size-11 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className={wide ? "h-3.5 w-[78%]" : "h-3.5 w-[62%]"} />
        <Skeleton className="h-2.5 w-[48%]" />
      </div>
      <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
      <Skeleton className="size-7 shrink-0 rounded-full" />
    </div>
  )
}

export function SharePageSkeleton() {
  return (
    <main className="min-h-dvh bg-background" aria-label="Preparando compartilhamento">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col overflow-hidden">
        <header className="border-b border-border/70 bg-background px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-2.5 w-56 max-w-[72vw]" />
            </div>
            <Skeleton className="size-8 shrink-0 rounded-xl" />
          </div>
          <Skeleton className="mt-3 h-11 w-full rounded-2xl" />
        </header>

        <div className="flex-1 px-3 pb-28 pt-3 sm:px-5">
          <div className="rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-44 max-w-[62vw]" />
                <Skeleton className="h-2.5 w-56 max-w-[68vw]" />
              </div>
              <Skeleton className="h-7 w-24 shrink-0 rounded-full" />
            </div>
          </div>

          <Skeleton className="mt-4 h-2.5 w-64 max-w-[76vw]" />

          <section className="mt-6">
            <div className="mb-2 flex items-center gap-2 px-1">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="space-y-0.5">
              <DestinationSkeleton wide />
              <DestinationSkeleton />
              <DestinationSkeleton wide />
              <DestinationSkeleton />
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-center justify-between gap-3 px-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            <div className="mt-3 flex gap-2 overflow-hidden px-1">
              {[56, 112, 86, 62].map((width, index) => (
                <Skeleton key={index} className="h-9 shrink-0 rounded-full" style={{ width }} />
              ))}
            </div>
            <div className="mt-3 space-y-0.5">
              <DestinationSkeleton wide />
              <DestinationSkeleton />
              <DestinationSkeleton wide />
            </div>
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
            <div className="min-w-0 flex-1 space-y-2 px-2 py-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-36" />
            </div>
            <Skeleton className="h-12 w-28 shrink-0 rounded-full" />
          </div>
        </div>
      </div>
    </main>
  )
}
