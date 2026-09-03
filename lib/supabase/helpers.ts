import type { AttachmentKind, AttachmentUploadInput, Member } from '@/lib/types'

export const ATTACHMENTS_BUCKET = 'cadence-attachments'
export const AVATARS_BUCKET = 'cadence-avatars'
export const CHAT_MEDIA_BUCKET = 'devboard-chat-media'
export const TOPIC_MEDIA_BUCKET = 'devboard-topic-media'
export const PROJECT_ICONS_BUCKET = 'devboard-project-icons'
export const SERVICE_REQUEST_MEDIA_BUCKET = 'devboard-request-media'
export const SERVICE_REQUEST_UNIT_ICONS_BUCKET = 'devboard-request-unit-icons'

export function colorForUser(id: string) {
  const palette = [
    'oklch(0.655 0.19 34)',
    'oklch(0.6 0.13 262)',
    'oklch(0.7 0.11 195)',
    'oklch(0.72 0.14 158)',
    'oklch(0.8 0.13 78)',
    'oklch(0.64 0.16 318)',
  ]
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

export function initialsForName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'US'
}

export function mapMember(row: any, role?: string): Member {
  const avatarUrl = row.avatar_url ?? undefined
  return {
    id: row.id,
    name: row.name || row.email || 'Usuário',
    initials: row.initials || initialsForName(row.name || row.email || 'Usuário'),
    color: row.color || colorForUser(row.id),
    email: row.email || undefined,
    avatarUrl,
    avatarPath: row.avatar_path || undefined,
    role: ['admin','developer','aqs','support','member'].includes(String(role)) ? role as Member['role'] : 'member',
  }
}

export function dataUrlToBlob(dataUrl: string) {
  const [meta, payload] = dataUrl.split(',', 2)
  if (!meta || payload === undefined) throw new Error('Conteúdo do anexo inválido')
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream'
  const binary = meta.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export function safeFileName(name: string) {
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : ''
  const stem = name.slice(0, Math.max(1, name.length - ext.length))
  return `${stem.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'arquivo'}${ext.toLowerCase()}`
}

export function attachmentStoragePath(
  workspaceId: string,
  projectId: string,
  uploaderId: string,
  input: AttachmentUploadInput,
) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${workspaceId}/${projectId}/${uploaderId}/${random}-${safeFileName(input.name)}`
}


export function serviceRequestUnitIconStoragePath(uploaderId: string, unitId: string, fileName: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${uploaderId}/${unitId}/${random}-${safeFileName(fileName)}`
}

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return ['image','pdf','text','document','video','audio','other'].includes(String(value))
}


export function chatMediaStoragePath(
  workspaceId: string,
  conversationId: string,
  uploaderId: string,
  fileName: string,
) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${workspaceId}/${conversationId}/${uploaderId}/${random}-${safeFileName(fileName)}`
}

export function chatAudioStoragePath(
  workspaceId: string,
  conversationId: string,
  uploaderId: string,
  mimeType: string,
) {
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
  return chatMediaStoragePath(workspaceId, conversationId, uploaderId, `audio.${ext}`)
}

export function chatMediaKind(file: Pick<File, 'name' | 'type'>): AttachmentKind {
  const mime = (file.type || '').toLowerCase()
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.startsWith('text/') || ['sql','txt','md','json','xml','yaml','yml','csv','log','ts','tsx','js','jsx','css','scss','html','dart','pas','kt','java','py','sh','ps1'].includes(ext)) return 'text'
  if (['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf'].includes(ext) || /officedocument|msword|ms-excel|ms-powerpoint/.test(mime)) return 'document'
  return 'other'
}


export function projectIconStoragePath(
  uploaderId: string,
  projectId: string,
  fileName: string,
) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${uploaderId}/${projectId}/${random}-${safeFileName(fileName)}`
}

export function topicMediaStoragePath(
  workspaceId: string,
  topicId: string,
  uploaderId: string,
  fileName: string,
) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${workspaceId}/${topicId}/${uploaderId}/${random}-${safeFileName(fileName)}`
}


export function serviceRequestMediaStoragePath(
  workspaceId: string,
  requestId: string,
  uploaderId: string,
  fileName: string,
) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${workspaceId}/${requestId}/${uploaderId}/${random}-${safeFileName(fileName)}`
}
