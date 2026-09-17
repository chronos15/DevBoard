"use client"

import * as React from "react"
import type { Project } from "@/lib/types"
import { ProjectIcon } from "@/components/projects/project-icon"
import { ImageViewerDialog } from "@/components/media/image-viewer-dialog"
import { cn } from "@/lib/utils"

type ProjectImagePreviewProps = {
  project: Pick<Project, "name" | "icon" | "iconImagePath" | "iconImageUrl">
  className?: string
  iconClassName?: string
  imageClassName?: string
}

function projectImageFileName(project: ProjectImagePreviewProps["project"]) {
  const sourceName = project.iconImagePath?.split("/").filter(Boolean).pop()
  if (sourceName) return sourceName

  const safeName = project.name
    .trim()
    .replace(/[^a-zA-Z0-9À-ÿ._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${safeName || "projeto"}.png`
}

export function ProjectImagePreview({
  project,
  className,
  iconClassName,
  imageClassName,
}: ProjectImagePreviewProps) {
  const [open, setOpen] = React.useState(false)
  const canPreview = Boolean(project.iconImageUrl)

  const icon = (
    <ProjectIcon
      icon={project.icon}
      imageUrl={project.iconImageUrl}
      className={iconClassName}
      imageClassName={imageClassName}
    />
  )

  if (!canPreview) {
    return (
      <span className={className} aria-hidden>
        {icon}
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "group/project-image cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          className,
        )}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
        title={`Ampliar imagem de ${project.name}`}
        aria-label={`Ampliar imagem do projeto ${project.name}`}
      >
        {icon}
      </button>

      <ImageViewerDialog
        open={open}
        onOpenChange={setOpen}
        src={project.iconImageUrl}
        alt={`Imagem do projeto ${project.name}`}
        title={project.name}
        downloadName={projectImageFileName(project)}
      />
    </>
  )
}
