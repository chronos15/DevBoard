import { RequestDetail } from "@/components/requests/request-detail"
export default async function ServiceRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RequestDetail requestId={id} />
}
