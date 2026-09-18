import type { MetadataRoute } from "next"

/**
 * V223
 *
 * O WebAPK do Android transforma `share_target.params.files` em metadados
 * nativos (`shareParamNames` / `shareParamAccepts`). Nas versões anteriores o
 * bucket continha dezenas de MIME types/extensões. O Chrome estava abrindo o
 * TaskBoard, mas gerando um multipart vazio (somente o boundary).
 *
 * Mantemos o registro propositalmente mínimo: um único campo aceitando qualquer MIME.
 * O servidor continua validando tamanho/tipo antes de persistir/enviar.
 *
 * O `id` muda de "/" para "/taskboard" uma única vez para forçar a criação de
 * um WebAPK novo, sem reutilizar metadados nativos de instalações anteriores.
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
            accept: ["*/*"],
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
