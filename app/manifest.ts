import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Devboard",
    short_name: "Devboard",
    description: "Gestão de projetos, atividades, subatividades, horas e colaboração em equipe.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#202833",
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
  }
}
