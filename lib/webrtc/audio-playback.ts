let sharedContext: AudioContext | null = null

function audioContextConstructor() {
  if (typeof window === "undefined") return null
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AudioContextCtor ?? null
}

export async function primeCallAudio() {
  const AudioContextCtor = audioContextConstructor()
  if (!AudioContextCtor) return false

  try {
    if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContextCtor()
    if (sharedContext.state === "suspended") await sharedContext.resume()

    // Um buffer silencioso iniciado dentro do gesto do usuário deixa a saída de áudio
    // pronta para as tracks WebRTC que chegam alguns instantes depois.
    const buffer = sharedContext.createBuffer(1, 1, 22050)
    const source = sharedContext.createBufferSource()
    source.buffer = buffer
    source.connect(sharedContext.destination)
    source.start(0)
    source.stop(0)

    return sharedContext.state === "running"
  } catch {
    return false
  }
}

export function getCallAudioContext() {
  return sharedContext
}

export async function resumeCallAudio() {
  if (!sharedContext) return primeCallAudio()
  try {
    if (sharedContext.state === "suspended") await sharedContext.resume()
    return sharedContext.state === "running"
  } catch {
    return false
  }
}
