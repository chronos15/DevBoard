export const TASKBOARD_VERSION = process.env.NEXT_PUBLIC_TASKBOARD_VERSION?.trim() || "V213"
export const TASKBOARD_BUILD_DATE = process.env.NEXT_PUBLIC_TASKBOARD_BUILD_DATE?.trim() || "--/-- --:--"

// Compatibilidade com a primeira implementação da V139.
// Mantemos este alias para que nenhum componente/cache antigo que ainda importe
// TASKBOARD_BUILD cause falha de compilação no Turbopack.
export const TASKBOARD_BUILD = TASKBOARD_BUILD_DATE

export const TASKBOARD_VERSION_LABEL = `${TASKBOARD_VERSION} - ${TASKBOARD_BUILD_DATE}`
