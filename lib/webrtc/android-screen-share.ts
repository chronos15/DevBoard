export type NativeScreenRecipient = {
  sessionId: string
  userId: string
}

export type NativeScreenSignal = {
  type: "native-screen-offer" | "native-screen-answer" | "native-screen-ice" | "native-screen-stop"
  meetingId: string
  fromSession: string
  fromUserId: string
  toSession: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

type NativeScreenState = {
  active: boolean
  error?: string
}

type DevboardNativeBridge = {
  getCapabilities(): string
  configureIceServers(json: string): void
  requestScreenShare(meetingId: string, sessionId: string, userId: string): void
  stopScreenShare(): void
  syncScreenRecipients(json: string): void
  handleScreenSignal(json: string): void
}

declare global {
  interface Window {
    DevboardNativeBridge?: DevboardNativeBridge
  }
}

export function getAndroidScreenBridge() {
  if (typeof window === "undefined") return null
  return window.DevboardNativeBridge ?? null
}

export function hasAndroidNativeScreenShare() {
  const bridge = getAndroidScreenBridge()
  if (!bridge) return false
  try {
    const capabilities = JSON.parse(bridge.getCapabilities()) as { mediaProjection?: boolean }
    return capabilities.mediaProjection === true
  } catch {
    return false
  }
}

export function configureAndroidScreenShare(iceServers: RTCIceServer[]) {
  getAndroidScreenBridge()?.configureIceServers(JSON.stringify(iceServers))
}

export function requestAndroidScreenShare(meetingId: string, sessionId: string, userId: string) {
  getAndroidScreenBridge()?.requestScreenShare(meetingId, sessionId, userId)
}

export function stopAndroidScreenShare() {
  getAndroidScreenBridge()?.stopScreenShare()
}

export function syncAndroidScreenRecipients(recipients: NativeScreenRecipient[]) {
  getAndroidScreenBridge()?.syncScreenRecipients(JSON.stringify(recipients))
}

export function forwardAndroidScreenSignal(signal: NativeScreenSignal) {
  getAndroidScreenBridge()?.handleScreenSignal(JSON.stringify(signal))
}

export function subscribeAndroidScreenState(listener: (state: NativeScreenState) => void) {
  if (typeof window === "undefined") return () => undefined
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<NativeScreenState>).detail
    if (detail) listener(detail)
  }
  window.addEventListener("devboard-native-screen-state", handler)
  return () => window.removeEventListener("devboard-native-screen-state", handler)
}

export function subscribeAndroidScreenSignal(listener: (signal: NativeScreenSignal) => void) {
  if (typeof window === "undefined") return () => undefined
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<NativeScreenSignal>).detail
    if (detail) listener(detail)
  }
  window.addEventListener("devboard-native-screen-signal", handler)
  return () => window.removeEventListener("devboard-native-screen-signal", handler)
}
