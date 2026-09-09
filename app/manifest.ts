import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TaskBoard",
    short_name: "TaskBoard",
    description: "Gestão de projetos, atividades, subatividades, horas e colaboração em equipe.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0c0d",
    theme_color: "#202833",
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "files",
            accept: [
              "image/*",
              "video/*",
              "audio/*",
              "text/*",
              "application/pdf",
              "application/zip",
              "application/x-zip-compressed",
              "application/octet-stream",
              "application/msword",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/vnd.ms-excel",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "application/vnd.ms-powerpoint",
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              ".jpg",
              ".jpeg",
              ".png",
              ".webp",
              ".gif",
              ".mp4",
              ".mov",
              ".mkv",
              ".pdf",
              ".txt",
              ".sql",
              ".zip",
              ".doc",
              ".docx",
              ".xls",
              ".xlsx",
              ".ppt",
              ".pptx",
            ],
          },
        ],
      },
    },
    icons: [
      {
        src: "/devboard-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/devboard-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  } as MetadataRoute.Manifest
}
