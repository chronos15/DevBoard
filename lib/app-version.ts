/**
 * Versão embutida do TaskBoard.
 *
 * A versão não depende de variável de ambiente para existir no cliente.
 * A data/hora da build continua sendo injetada pelo next.config.mjs em
 * NEXT_PUBLIC_TASKBOARD_BUILD_DATE.
 */
export const TASKBOARD_VERSION = "V226"

export const TASKBOARD_BUILD_DATE =
  process.env.NEXT_PUBLIC_TASKBOARD_BUILD_DATE?.trim()
  || process.env.NEXT_PUBLIC_TASKBOARD_BUILD?.trim()
  || ""

// Alias legado mantido para arquivos de versões anteriores.
export const TASKBOARD_BUILD = TASKBOARD_BUILD_DATE

export const TASKBOARD_VERSION_LABEL = TASKBOARD_BUILD_DATE
  ? `${TASKBOARD_VERSION} - ${TASKBOARD_BUILD_DATE}`
  : TASKBOARD_VERSION
