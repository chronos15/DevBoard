import { ProjectDetail } from "@/components/project-detail/project-detail"

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="w-full max-w-none lg:-mx-3 lg:w-auto">
      <ProjectDetail projectId={id} />
    </div>
  )
}
