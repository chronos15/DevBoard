export const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024
export const VIDEO_TARGET_PART_BYTES = 30 * 1024 * 1024

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "mpeg", "mpg"])
const OUTPUT_SIZE_HEADROOM = 0.92

let aacFallbackRegistered = false
let videoProcessingQueue: Promise<void> = Promise.resolve()

export type VideoProcessingStage = "loading" | "analyzing" | "compressing" | "splitting" | "done"

export type VideoProcessingProgress = {
  stage: VideoProcessingStage
  progress: number
  message: string
}

type ProgressHandler = (progress: VideoProcessingProgress) => void

function extensionOf(name: string) {
  const index = name.lastIndexOf(".")
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ""
}

function safeBaseName(name: string) {
  const withoutExtension = name.replace(/\.[^.]+$/, "").trim() || "video"
  return withoutExtension
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 90)
}

function report(onProgress: ProgressHandler | undefined, stage: VideoProcessingStage, progress: number, message: string) {
  onProgress?.({
    stage,
    progress: Math.max(0, Math.min(1, progress)),
    message,
  })
}

export function isVideoFile(file: File) {
  const type = (file.type || "").toLowerCase()
  return type.startsWith("video/") || VIDEO_EXTENSIONS.has(extensionOf(file.name))
}

export function isSingleVideoSelection(files: File[]) {
  return files.length === 1 && isVideoFile(files[0])
}

function formatCodecFailure(kind: "vídeo" | "áudio") {
  return `Este aparelho não disponibilizou um codificador compatível de ${kind} para a otimização no Chrome.`
}

function outputName(original: File, index: number, total: number) {
  const base = safeBaseName(original.name)
  return total === 1
    ? `${base}-otimizado.mp4`
    : `${base} - parte ${String(index + 1).padStart(2, "0")} de ${String(total).padStart(2, "0")}.mp4`
}

/**
 * Regra:
 * - até 50 MB: preserva o arquivo original, sem recompressão;
 * - acima de 50 MB e sendo um único vídeo: divide por duração em partes
 *   aproximadamente iguais, mirando 30 MB por parte;
 * - cada parte é transcodificada para MP4/AVC + AAC com qualidade conservadora;
 * - nenhuma parte é aceita se ultrapassar 50 MB.
 *
 * O processamento usa WebCodecs via Mediabunny e acontece localmente no navegador.
 */
async function processVideoAttachmentNow(
  file: File,
  onProgress?: ProgressHandler,
): Promise<File[]> {
  if (!isVideoFile(file) || file.size <= MAX_ATTACHMENT_FILE_BYTES) {
    return [file]
  }

  report(onProgress, "loading", 0.02, "Carregando o processador de vídeo…")

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
  } = await import("mediabunny")

  report(onProgress, "analyzing", 0.08, "Analisando duração e compatibilidade do vídeo…")

  const metadataInput = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  })

  const duration = await metadataInput.computeDuration()
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Não foi possível identificar a duração deste vídeo.")
  }

  const primaryVideo = await metadataInput.getPrimaryVideoTrack()
  if (!primaryVideo) {
    throw new Error("O arquivo recebido não possui uma faixa de vídeo válida.")
  }

  const outputFormat = new Mp4OutputFormat()

  // AVC/H.264 é a primeira escolha por compatibilidade com Chrome/Android.
  // Se o aparelho não disponibilizar AVC para encode, usamos o primeiro codec
  // MP4 que o próprio navegador disser que consegue codificar.
  const supportedVideoCodecs = outputFormat.getSupportedVideoCodecs()
  const preferredVideoCodecs = [
    ...supportedVideoCodecs.filter((codec) => codec === "avc"),
    ...supportedVideoCodecs.filter((codec) => codec !== "avc"),
  ]
  const [videoWidth, videoHeight] = await Promise.all([
    primaryVideo.getDisplayWidth(),
    primaryVideo.getDisplayHeight(),
  ])
  const videoCodec = await getFirstEncodableVideoCodec(preferredVideoCodecs, {
    width: videoWidth,
    height: videoHeight,
  })
  if (!videoCodec) throw new Error(formatCodecFailure("vídeo"))

  const primaryAudio = await metadataInput.getPrimaryAudioTrack()
  const supportedAacCodecs = outputFormat.getSupportedAudioCodecs().filter((codec) => codec === "aac")
  let audioCodec = primaryAudio
    ? await getFirstEncodableAudioCodec(supportedAacCodecs)
    : null

  // Alguns navegadores/combinações Android não expõem AAC pelo WebCodecs.
  // Nesse caso carregamos um fallback pequeno somente sob demanda.
  if (primaryAudio && !audioCodec) {
    report(onProgress, "loading", 0.1, "Ativando compatibilidade de áudio…")
    if (!aacFallbackRegistered) {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder")
      registerAacEncoder()
      aacFallbackRegistered = true
    }
    audioCodec = await getFirstEncodableAudioCodec(supportedAacCodecs)
  }

  if (primaryAudio && !audioCodec) throw new Error(formatCodecFailure("áudio"))

  const sourceAverageBitrate = (file.size * 8) / duration
  let partCount = Math.max(2, Math.ceil(file.size / VIDEO_TARGET_PART_BYTES))
  const maxAttempts = 4

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const segmentDuration = duration / partCount
    // O bitrate é limitado pelo menor dos dois valores:
    // 1) ~92% do bitrate médio original (compressão conservadora);
    // 2) o necessário para manter cada parte perto de 30 MB.
    // Não usamos um piso alto: isso evita inflar vídeos longos de bitrate baixo.
    const totalTargetBitrate = Math.max(
      128_000,
      Math.min(
        sourceAverageBitrate * OUTPUT_SIZE_HEADROOM,
        ((VIDEO_TARGET_PART_BYTES * 8) / segmentDuration) * OUTPUT_SIZE_HEADROOM,
      ),
    )
    const audioTargetBitrate = primaryAudio
      ? Math.min(128_000, Math.max(48_000, Math.floor(totalTargetBitrate * 0.16)))
      : 0
    const videoTargetBitrate = Math.max(
      80_000,
      Math.floor(totalTargetBitrate - audioTargetBitrate),
    )

    report(
      onProgress,
      "compressing",
      0.12,
      `Otimizando em ${partCount} ${partCount === 1 ? "parte" : "partes"} com qualidade preservada…`,
    )

    const generated: File[] = []
    let oversized = false
    let largestPart = 0

    for (let index = 0; index < partCount; index += 1) {
      const start = (duration * index) / partCount
      const end = index === partCount - 1
        ? duration
        : (duration * (index + 1)) / partCount

      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
      })
      const target = new BufferTarget()
      const output = new Output({
        format: new Mp4OutputFormat(),
        target,
      })

      const conversion = await Conversion.init({
        input,
        output,
        tracks: "primary",
        trim: { start, end },
        video: {
          codec: videoCodec,
          quality: new Quality({
            bitrate: videoTargetBitrate,
            bitrateMode: "variable",
          }),
          keyFrameInterval: Math.min(3, Math.max(1, (end - start) / 8)),
          hardwareAcceleration: "prefer-hardware",
          forceTranscode: true,
        },
        audio: primaryAudio && audioCodec
          ? {
              codec: audioCodec,
              quality: new Quality({
                bitrate: audioTargetBitrate,
                bitrateMode: "variable",
              }),
              forceTranscode: true,
            }
          : undefined,
        tags: {},
        showWarnings: false,
      })

      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks
          .map((item) => item.reason)
          .filter(Boolean)
          .join(" ")
        throw new Error(reasons || "Este vídeo não pôde ser convertido neste aparelho.")
      }

      conversion.onProgress = (partProgress) => {
        const normalized = Number.isFinite(partProgress) ? Math.max(0, Math.min(1, partProgress)) : 0
        const overall = 0.14 + ((index + normalized) / partCount) * 0.72
        report(
          onProgress,
          "compressing",
          overall,
          `Comprimindo parte ${index + 1} de ${partCount}…`,
        )
      }

      await conversion.execute()

      const buffer = target.buffer
      if (!buffer || buffer.byteLength === 0) {
        throw new Error(`A parte ${index + 1} do vídeo não pôde ser gerada.`)
      }

      largestPart = Math.max(largestPart, buffer.byteLength)
      if (buffer.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
        oversized = true
        break
      }

      generated.push(new File(
        [buffer],
        outputName(file, index, partCount),
        {
          type: "video/mp4",
          lastModified: Date.now() + index,
        },
      ))
    }

    if (!oversized && generated.length === partCount) {
      report(onProgress, "splitting", 0.92, "Validando tamanho e integridade das partes…")

      const invalidPart = generated.find((part) => part.size > MAX_ATTACHMENT_FILE_BYTES)
      if (!invalidPart) {
        report(
          onProgress,
          "done",
          1,
          `Vídeo pronto em ${generated.length} ${generated.length === 1 ? "parte" : "partes"}.`,
        )
        return generated
      }
    }

    // Mantém todas as divisões proporcionais. Se VBR/hardware encoder gerar uma
    // parte acima de 50 MB, aumenta a quantidade global e refaz a divisão a
    // partir do original, sem perda acumulada entre tentativas.
    const factor = largestPart > 0
      ? Math.max(1.15, largestPart / MAX_ATTACHMENT_FILE_BYTES)
      : 1.2
    partCount = Math.max(partCount + 1, Math.ceil(partCount * factor))
    report(
      onProgress,
      "splitting",
      0.1,
      "Ajustando a divisão para manter todas as partes abaixo de 50 MB…",
    )
  }

  throw new Error("Não foi possível manter todas as partes do vídeo abaixo de 50 MB neste dispositivo.")
}

/**
 * Serializa transcodificações para não sobrecarregar CPU/GPU/memória do Android
 * quando dois envios forem disparados quase ao mesmo tempo.
 */
export function prepareVideoAttachment(
  file: File,
  onProgress?: ProgressHandler,
): Promise<File[]> {
  if (!isVideoFile(file) || file.size <= MAX_ATTACHMENT_FILE_BYTES) {
    return Promise.resolve([file])
  }

  const task = videoProcessingQueue.then(() => processVideoAttachmentNow(file, onProgress))
  videoProcessingQueue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

