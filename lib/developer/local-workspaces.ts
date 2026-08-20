"use client"

const DB_NAME = "devboard-developer-local-workspaces"
const DB_VERSION = 1
const STORE_NAME = "directory-handles"

export type LocalDirectoryHandle = {
  kind: "directory"
  name: string
  queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
  requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }) => Promise<LocalDirectoryHandle>
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível neste navegador."))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento local."))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = run(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Falha no armazenamento local."))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error("Falha no armazenamento local."))
    }
  })
}

export function supportsDirectoryPicker() {
  return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
}

export async function pickDirectory(pickerId: string) {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) throw new Error("Seu navegador não oferece seleção persistente de pastas. Use Chrome ou Edge atualizado no desktop.")
  return picker({ id: pickerId.slice(0, 32), mode: "read" })
}

export async function saveDirectoryHandle(key: string, handle: LocalDirectoryHandle) {
  await withStore("readwrite", (store) => store.put(handle, key))
}

export async function getDirectoryHandle(key: string) {
  return withStore<LocalDirectoryHandle | undefined>("readonly", (store) => store.get(key))
}

export async function removeDirectoryHandle(key: string) {
  await withStore("readwrite", (store) => store.delete(key))
}

export async function ensureDirectoryPermission(handle: LocalDirectoryHandle) {
  if (handle.queryPermission) {
    const current = await handle.queryPermission({ mode: "read" })
    if (current === "granted") return true
  }
  if (handle.requestPermission) return (await handle.requestPermission({ mode: "read" })) === "granted"
  return true
}

export function localDirectoryKey(userId: string, projectId: string) {
  return `${userId}:${projectId}`
}
