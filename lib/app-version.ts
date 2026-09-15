export const TASKBOARD_VERSION = process.env.NEXT_PUBLIC_TASKBOARD_VERSION?.trim() || "V139"
export const TASKBOARD_BUILD = process.env.NEXT_PUBLIC_TASKBOARD_BUILD?.trim() || "dev"

export const TASKBOARD_VERSION_LABEL = `${TASKBOARD_VERSION} · build ${TASKBOARD_BUILD}`
