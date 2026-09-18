"use client"

const DB_NAME = "taskboard-share-target-v221"
const DB_VERSION = 1
const STORE_NAME = "shares"

export type LocalSharedFileRecord = {
  index: number
  name: string
  type: string
  size: number
  lastModified: number
  blob: Blob
}

export type LocalShareRecord = {
  id: string
  receivedAt: string
  title: string
  text: string
  url: string
  files: LocalSharedFileRecord[]
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("O armazenamento local do PWA não está disponível neste dispositivo."))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento local do PWA."))
    request.onblocked = () => reject(new Error("O armazenamento local do PWA está bloqueado por outra versão aberta do TaskBoard."))
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Falha ao acessar o armazenamento local do PWA."))
  })
}

export async function readLocalStagedShare(id: string) {
  if (!id) throw new Error("Compartilhamento local inválido.")
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const record = await requestResult(store.get(id)) as LocalShareRecord | undefined
    if (!record) throw new Error("O anexo compartilhado não está mais disponível no armazenamento local do PWA.")

    const files = [...(record.files || [])]
      .sort((a, b) => a.index - b.index)
      .map((item, index) => new File([item.blob], item.name || `arquivo-compartilhado-${index + 1}`, {
        type: item.type || item.blob.type || "application/octet-stream",
        lastModified: item.lastModified || Date.now(),
      }))

    return {
      metadata: {
        id: record.id,
        title: record.title || "",
        text: record.text || "",
        url: record.url || "",
        receivedAt: record.receivedAt || new Date().toISOString(),
        files: (record.files || []).map(({ index, name, type, size, lastModified }) => ({
          index,
          name,
          type,
          size,
          lastModified,
        })),
      },
      files,
    }
  } finally {
    db.close()
  }
}

export async function deleteLocalStagedShare(id: string) {
  if (!id || typeof indexedDB === "undefined") return
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    await requestResult(store.delete(id))
  } finally {
    db.close()
  }
}
