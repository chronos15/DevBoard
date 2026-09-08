"use client"

export type MeetingRecordingSource = {
  id: string
  name: string
  stream?: MediaStream | null
  videoEnabled?: boolean
  screenSharing?: boolean
}

type StoredSegment = {
  key: string
  meetingId: string
  index: number
  blob: Blob
  mimeType: string
  createdAt: number
}

const DB_NAME = "devboard-meeting-recordings"
const DB_VERSION = 1
const SEGMENT_STORE = "segments"
const SEGMENT_MS = 120_000
const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720
const FPS = 15

function openRecordingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("O armazenamento local de gravações não está disponível neste navegador."))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento local da gravação."))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SEGMENT_STORE)) {
        const store = db.createObjectStore(SEGMENT_STORE, { keyPath: "key" })
        store.createIndex("meetingId", "meetingId", { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  const db = await openRecordingDb()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(SEGMENT_STORE, mode)
    const store = transaction.objectStore(SEGMENT_STORE)
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const fail = (reason?: unknown) => {
      if (settled) return
      settled = true
      reject(reason)
    }
    transaction.onabort = () => fail(transaction.error ?? new Error("A gravação local foi interrompida."))
    transaction.onerror = () => fail(transaction.error ?? new Error("Falha ao salvar a gravação local."))
    try {
      run(store, finish, fail)
    } catch (error) {
      fail(error)
    }
  }).finally(() => db.close())
}

export async function saveMeetingRecordingSegment(meetingId: string, index: number, blob: Blob) {
  const row: StoredSegment = {
    key: `${meetingId}:${String(index).padStart(6, "0")}`,
    meetingId,
    index,
    blob,
    mimeType: blob.type || "video/webm",
    createdAt: Date.now(),
  }
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(row)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function countMeetingRecordingSegments(meetingId: string): Promise<number> {
  return withStore<number>("readonly", (store, resolve, reject) => {
    const request = store.index("meetingId").count(IDBKeyRange.only(meetingId))
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

export async function readMeetingRecordingSegment(meetingId: string, index: number): Promise<StoredSegment | null> {
  return withStore<StoredSegment | null>("readonly", (store, resolve, reject) => {
    const request = store.get(`${meetingId}:${String(index).padStart(6, "0")}`)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve((request.result as StoredSegment | undefined) ?? null)
  })
}

export async function clearMeetingRecordingSegments(meetingId: string) {
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const index = store.index("meetingId")
    const cursor = index.openKeyCursor(IDBKeyRange.only(meetingId))
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      const result = cursor.result
      if (!result) {
        resolve()
        return
      }
      store.delete(result.primaryKey)
      result.continue()
    }
  })
}

function chooseMimeType() {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ]
  return candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || ""
}

function initials(name: string) {
  const pieces = name.trim().split(/\s+/).filter(Boolean)
  return `${pieces[0]?.[0] ?? ""}${pieces[1]?.[0] ?? ""}`.toUpperCase() || "US"
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawVideoContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight
  if (!sourceWidth || !sourceHeight) return false
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const targetWidth = sourceWidth * scale
  const targetHeight = sourceHeight * scale
  const targetX = x + (width - targetWidth) / 2
  const targetY = y + (height - targetHeight) / 2
  ctx.drawImage(video, targetX, targetY, targetWidth, targetHeight)
  return true
}

type VideoNode = {
  trackId: string
  element: HTMLVideoElement
}

type AudioNode = {
  trackId: string
  source: MediaStreamAudioSourceNode
  gain: GainNode
}

export class BrowserMeetingRecorder {
  private readonly meetingId: string
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvasStream: MediaStream
  private readonly audioContext: AudioContext
  private readonly audioDestination: MediaStreamAudioDestinationNode
  private readonly mixedStream: MediaStream
  private readonly videoNodes = new Map<string, VideoNode>()
  private readonly audioNodes = new Map<string, AudioNode>()
  private sources: MeetingRecordingSource[] = []
  private recorder: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private rotateTimer: number | null = null
  private renderTimer: number | null = null
  private segmentIndex = 0
  private running = false
  private stopping: Promise<number> | null = null

  constructor(meetingId: string, initialSegmentIndex = 0) {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      throw new Error("Este Chrome não disponibilizou o gravador de mídia necessário para a reunião.")
    }
    const canvas = document.createElement("canvas")
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const ctx = canvas.getContext("2d", { alpha: false })
    if (!ctx || typeof canvas.captureStream !== "function") {
      throw new Error("Este Chrome não disponibilizou a captura de vídeo necessária para gravar a reunião.")
    }

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error("Este Chrome não disponibilizou a mixagem de áudio necessária para gravar a reunião.")

    this.meetingId = meetingId
    this.segmentIndex = Math.max(0, Math.floor(initialSegmentIndex))
    this.canvas = canvas
    this.ctx = ctx
    this.canvasStream = canvas.captureStream(FPS)
    this.audioContext = new AudioContextCtor()
    this.audioDestination = this.audioContext.createMediaStreamDestination()
    this.mixedStream = new MediaStream()
    this.canvasStream.getVideoTracks().forEach((track) => this.mixedStream.addTrack(track))
    this.audioDestination.stream.getAudioTracks().forEach((track) => this.mixedStream.addTrack(track))
  }

  get segments() {
    return this.segmentIndex
  }

  async start() {
    if (this.running) return
    this.running = true
    try { await this.audioContext.resume() } catch {}
    this.startRenderLoop()
    this.startSegment()
  }

  updateSources(sources: MeetingRecordingSource[]) {
    this.sources = sources
    if (this.audioContext.state === "suspended") void this.audioContext.resume().catch(() => undefined)
    const liveIds = new Set(sources.map((source) => source.id))

    for (const [id, node] of this.videoNodes) {
      if (liveIds.has(id)) continue
      node.element.pause()
      node.element.srcObject = null
      this.videoNodes.delete(id)
    }
    for (const [id, node] of this.audioNodes) {
      if (liveIds.has(id)) continue
      try { node.source.disconnect() } catch {}
      try { node.gain.disconnect() } catch {}
      this.audioNodes.delete(id)
    }

    for (const source of sources) {
      const stream = source.stream
      const videoTrack = stream?.getVideoTracks().find((track) => track.readyState === "live")
      const currentVideo = this.videoNodes.get(source.id)
      if (videoTrack) {
        if (!currentVideo || currentVideo.trackId !== videoTrack.id) {
          if (currentVideo) {
            currentVideo.element.pause()
            currentVideo.element.srcObject = null
          }
          const element = document.createElement("video")
          element.autoplay = true
          element.playsInline = true
          element.muted = true
          element.srcObject = new MediaStream([videoTrack])
          void element.play().catch(() => undefined)
          this.videoNodes.set(source.id, { trackId: videoTrack.id, element })
        }
      } else if (currentVideo) {
        currentVideo.element.pause()
        currentVideo.element.srcObject = null
        this.videoNodes.delete(source.id)
      }

      const audioTrack = stream?.getAudioTracks().find((track) => track.readyState === "live")
      const currentAudio = this.audioNodes.get(source.id)
      if (audioTrack) {
        if (!currentAudio || currentAudio.trackId !== audioTrack.id) {
          if (currentAudio) {
            try { currentAudio.source.disconnect() } catch {}
            try { currentAudio.gain.disconnect() } catch {}
          }
          try {
            const audioStream = new MediaStream([audioTrack])
            const audioSource = this.audioContext.createMediaStreamSource(audioStream)
            const gain = this.audioContext.createGain()
            gain.gain.value = 1
            audioSource.connect(gain)
            gain.connect(this.audioDestination)
            this.audioNodes.set(source.id, { trackId: audioTrack.id, source: audioSource, gain })
          } catch {
            // Uma faixa de áudio isolada pode falhar em aparelhos mais antigos.
            // O restante da gravação continua normalmente.
          }
        }
      } else if (currentAudio) {
        try { currentAudio.source.disconnect() } catch {}
        try { currentAudio.gain.disconnect() } catch {}
        this.audioNodes.delete(source.id)
      }
    }
  }

  private startRenderLoop() {
    if (this.renderTimer !== null) window.clearInterval(this.renderTimer)
    this.renderFrame()
    this.renderTimer = window.setInterval(() => this.renderFrame(), Math.round(1000 / FPS))
  }

  private renderFrame() {
    const ctx = this.ctx
    const width = this.canvas.width
    const height = this.canvas.height
    ctx.fillStyle = "#0b0d0f"
    ctx.fillRect(0, 0, width, height)

    const screen = this.sources.find((source) => source.screenSharing && source.videoEnabled && this.videoNodes.has(source.id))
    if (screen) {
      this.drawSource(screen, 0, 0, width, height, true)
      return
    }

    const sources = this.sources.length ? this.sources : [{ id: "empty", name: "Reunião", videoEnabled: false }]
    const columns = Math.max(1, Math.ceil(Math.sqrt(sources.length)))
    const rows = Math.max(1, Math.ceil(sources.length / columns))
    const gap = 12
    const tileWidth = (width - gap * (columns + 1)) / columns
    const tileHeight = (height - gap * (rows + 1)) / rows

    sources.forEach((source, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = gap + column * (tileWidth + gap)
      const y = gap + row * (tileHeight + gap)
      this.drawSource(source, x, y, tileWidth, tileHeight, false)
    })
  }

  private drawSource(source: MeetingRecordingSource, x: number, y: number, width: number, height: number, screen: boolean) {
    const ctx = this.ctx
    ctx.save()
    roundedRect(ctx, x, y, width, height, screen ? 0 : 18)
    ctx.clip()
    ctx.fillStyle = "#171a1d"
    ctx.fillRect(x, y, width, height)

    const node = this.videoNodes.get(source.id)
    const canDrawVideo = Boolean(
      source.videoEnabled
      && node
      && node.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && node.element.videoWidth > 0,
    )
    let drewVideo = false
    if (canDrawVideo && node) {
      try { drewVideo = drawVideoContain(ctx, node.element, x, y, width, height) } catch {}
    }

    if (!drewVideo) {
      const radius = Math.max(34, Math.min(width, height) * 0.11)
      ctx.fillStyle = "#25303a"
      ctx.beginPath()
      ctx.arc(x + width / 2, y + height / 2 - 8, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#e8edf2"
      ctx.font = `600 ${Math.max(22, radius * 0.62)}px system-ui, sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(initials(source.name), x + width / 2, y + height / 2 - 8)
    }

    const labelHeight = screen ? 48 : 42
    const gradient = ctx.createLinearGradient(0, y + height - labelHeight * 2, 0, y + height)
    gradient.addColorStop(0, "rgba(0,0,0,0)")
    gradient.addColorStop(1, "rgba(0,0,0,0.78)")
    ctx.fillStyle = gradient
    ctx.fillRect(x, y + height - labelHeight * 2, width, labelHeight * 2)
    ctx.fillStyle = "#ffffff"
    ctx.font = `600 ${screen ? 22 : 18}px system-ui, sans-serif`
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(screen ? `Tela de ${source.name}` : source.name, x + 18, y + height - 16, Math.max(40, width - 36))
    ctx.restore()
  }

  private startSegment() {
    if (!this.running) return
    this.chunks = []
    const mimeType = chooseMimeType()
    const recorder = new MediaRecorder(this.mixedStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_200_000,
      audioBitsPerSecond: 96_000,
    })
    recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data)
    }
    recorder.start(1000)
    this.recorder = recorder
    this.rotateTimer = window.setTimeout(() => {
      void this.rotateSegment()
    }, SEGMENT_MS)
  }

  private async stopCurrentSegment() {
    const recorder = this.recorder
    if (!recorder) return
    if (this.rotateTimer !== null) {
      window.clearTimeout(this.rotateTimer)
      this.rotateTimer = null
    }
    if (recorder.state === "inactive") {
      this.recorder = null
      return
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("O gravador encontrou um erro ao finalizar este trecho."))
      recorder.onstop = () => {
        const content = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" })
        resolve(content)
      }
      try { recorder.stop() } catch (error) { reject(error) }
    })
    this.recorder = null
    this.chunks = []
    if (blob.size > 1024) {
      await saveMeetingRecordingSegment(this.meetingId, this.segmentIndex, blob)
      this.segmentIndex += 1
    }
  }

  private async rotateSegment() {
    if (!this.running) return
    await this.stopCurrentSegment()
    if (this.running) this.startSegment()
  }

  async stop() {
    if (this.stopping) return this.stopping
    this.stopping = (async () => {
      this.running = false
      if (this.rotateTimer !== null) {
        window.clearTimeout(this.rotateTimer)
        this.rotateTimer = null
      }
      await this.stopCurrentSegment()
      if (this.renderTimer !== null) {
        window.clearInterval(this.renderTimer)
        this.renderTimer = null
      }
      for (const node of this.videoNodes.values()) {
        node.element.pause()
        node.element.srcObject = null
      }
      this.videoNodes.clear()
      for (const node of this.audioNodes.values()) {
        try { node.source.disconnect() } catch {}
        try { node.gain.disconnect() } catch {}
      }
      this.audioNodes.clear()
      this.canvasStream.getTracks().forEach((track) => track.stop())
      this.audioDestination.stream.getTracks().forEach((track) => track.stop())
      try { await this.audioContext.close() } catch {}
      return this.segmentIndex
    })()
    return this.stopping
  }
}
