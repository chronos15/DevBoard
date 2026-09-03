import { RequestsWorkspace } from "@/components/requests/requests-view"
import type { ServiceRequestScope } from "@/lib/service-requests"

const VALID_SCOPES = new Set<ServiceRequestScope>(["inbox", "mine", "aqs", "dev", "completed"])

export default async function ServiceRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ scope?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const scope = VALID_SCOPES.has(query.scope as ServiceRequestScope) ? query.scope as ServiceRequestScope : "inbox"
  return <RequestsWorkspace scope={scope} requestId={id} />
}
