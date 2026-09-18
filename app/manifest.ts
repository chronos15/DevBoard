import type { MetadataRoute } from "next"

/**
 * V224
 *
 * O recebimento de arquivos pelo Web Share Target do WebAPK foi removido.
 * Nos testes reais com Chrome 153/Android, o WebAPK abria o TaskBoard mas
 * enviava somente o boundary multipart (75 bytes, sem File/EXTRA_STREAM).
 *
 * O compartilhamento de arquivos é feito pelo receptor Android nativo em
 * android-share-bridge/, que envia o multipart diretamente para /share-target.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TaskBoard",
    short_name: "TaskBoard",
    description: "Gestão de projetos, atividades, subatividades, horas e colaboração em equipe.",
    id: "/taskboard",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0c0c0d",
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
  } as MetadataRoute.Manifest
}
