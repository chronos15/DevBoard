import { Suspense } from "react"
import { FollowUpPage } from "@/components/project-detail/follow-up-page"

export default function AcompanhamentoPage() {
  return (
    <Suspense fallback={<div className="h-full min-h-0 animate-pulse bg-muted/20" />}>
      <FollowUpPage />
    </Suspense>
  )
}
