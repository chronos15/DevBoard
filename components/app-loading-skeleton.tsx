"use client"

import { usePathname } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"

function HeadingSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-52 max-w-[70vw]" />
      <Skeleton className="h-4 w-[420px] max-w-full" />
    </div>
  )
}

function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="size-8 rounded-xl" />
          </div>
          <Skeleton className="mt-5 h-8 w-20" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-label="Carregando painel">
      <HeadingSkeleton />
      <CardGridSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8 lg:col-span-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-6 h-64 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mx-auto mt-6 size-44 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <Skeleton className="h-4 w-32" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 4 }).map((__, row) => (
                <div key={row} className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-2.5 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectsSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-label="Carregando projetos">
      <HeadingSkeleton />
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/8 sm:flex-row">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="mt-5 h-2 w-full rounded-full" />
            <div className="mt-5 flex justify-between">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectDetailSkeleton() {
  return (
    <div className="w-full min-w-0 max-w-full space-y-4" aria-label="Carregando projeto">
      <Skeleton className="h-4 w-24" />
      <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-7 w-64 max-w-[70vw]" />
              <Skeleton className="h-4 w-[520px] max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-9 w-full sm:w-24" />)}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-8 w-24 rounded-full" />)}
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8">
              <div className="flex items-center gap-3">
                <Skeleton className="size-4" />
                <Skeleton className="h-5 w-52" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                {Array.from({ length: 2 }).map((__, row) => <Skeleton key={row} className="h-12 w-full rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-5 h-8 w-20" />
            <Skeleton className="mt-3 h-2 w-full rounded-full" />
            <div className="mt-5 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          </div>
          <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-5 h-8 w-20" />
            <Skeleton className="mt-3 h-2 w-full rounded-full" />
            <div className="mt-5 grid grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-5" aria-label="Carregando formulário">
      <Skeleton className="h-4 w-28" />
      <HeadingSkeleton />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, section) => (
            <div key={section} className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8 md:p-6">
              <Skeleton className="h-5 w-44" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: section === 0 ? 6 : 2 }).map((__, index) => <Skeleton key={index} className="h-10 w-full" />)}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-5">
          <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <Skeleton className="h-5 w-28" />
            <div className="mt-4 space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
          </div>
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

function GenericSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-label="Carregando conteúdo">
      <HeadingSkeleton />
      <CardGridSkeleton count={3} />
      <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
        <div className="space-y-3">
          {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}
        </div>
      </div>
    </div>
  )
}

function WorkflowKanbanSkeleton({ label = "Carregando fluxo" }: { label?: string }) {
  return (
    <div className="min-w-0 space-y-6" aria-label={label}>
      <HeadingSkeleton />
      <CardGridSkeleton count={4} />
      <div className="w-full min-w-0 overflow-hidden">
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, column) => (
            <div key={column} className="min-h-[500px] min-w-0 flex-1 rounded-2xl border border-border bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-7 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-3 w-36 max-w-full" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: column === 0 ? 4 : 2 }).map((__, row) => (
                  <Skeleton key={row} className="h-32 w-full rounded-xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-4" aria-label="Carregando chat">
      <HeadingSkeleton />
      <div className="grid min-h-[620px] overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/8 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_260px]">
        <div className="border-r border-border p-3">
          <Skeleton className="h-10 w-full" />
          <div className="mt-4 space-y-2">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}</div>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-3 border-b border-border pb-4"><Skeleton className="size-10 rounded-full" /><Skeleton className="h-5 w-44" /></div>
          <div className="mt-6 space-y-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className={`h-12 ${index % 2 ? 'ml-auto w-2/3' : 'w-3/4'} rounded-2xl`} />)}</div>
          <Skeleton className="mt-8 h-12 w-full rounded-xl" />
        </div>
        <div className="hidden border-l border-border p-4 xl:block"><Skeleton className="h-5 w-28" /><div className="mt-5 space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div></div>
      </div>
    </div>
  )
}

export function AppLoadingSkeleton() {
  const pathname = usePathname()

  if (pathname === "/") return <DashboardSkeleton />
  if (pathname === "/projetos") return <ProjectsSkeleton />
  if (pathname === "/projetos/novo" || /\/projetos\/[^/]+\/editar$/.test(pathname)) return <FormSkeleton />
  if (/^\/projetos\/[^/]+$/.test(pathname)) return <ProjectDetailSkeleton />
  if (pathname.startsWith("/chat")) return <ChatSkeleton />
  if (pathname.startsWith("/analise")) return <WorkflowKanbanSkeleton label="Carregando análise AQS" />
  if (pathname.startsWith("/topicos")) return <WorkflowKanbanSkeleton label="Carregando tópicos" />
  return <GenericSkeleton />
}
