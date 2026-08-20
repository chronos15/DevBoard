import { PageHeading } from "@/components/page-heading"
import { DeveloperPanel } from "@/components/developer/developer-panel"

export default function DeveloperPage() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <PageHeading
        eyebrow="Developer workspace"
        title="Painel do desenvolvedor"
        subtitle="Seu espaço pessoal para foco, expediente, hidratação, anotações e atalhos de trabalho — sem depender de nenhum projeto."
      />
      <DeveloperPanel />
    </div>
  )
}
