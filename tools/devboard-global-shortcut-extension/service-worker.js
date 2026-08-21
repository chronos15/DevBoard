const DEFAULT_BASE_URL = "http://localhost:3000"

function normalizeBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_BASE_URL
    return url.origin
  } catch {
    return DEFAULT_BASE_URL
  }
}

async function configuredBaseUrl() {
  const stored = await chrome.storage.local.get("devboardBaseUrl")
  return normalizeBaseUrl(stored.devboardBaseUrl || DEFAULT_BASE_URL)
}

async function openDeveloperPanel() {
  const baseUrl = await configuredBaseUrl()
  const origin = new URL(baseUrl).origin
  const targetUrl = `${origin}/dev#dev-session`
  const tabs = await chrome.tabs.query({})

  const candidates = tabs.filter((tab) => {
    if (!tab.id || !tab.url) return false
    try {
      return new URL(tab.url).origin === origin
    } catch {
      return false
    }
  })

  const existing = candidates.find((tab) => tab.active) || candidates[0]
  let targetTab = existing

  if (existing?.id) {
    targetTab = await chrome.tabs.update(existing.id, { url: targetUrl, active: true })
  } else {
    targetTab = await chrome.tabs.create({ url: targetUrl, active: true })
  }

  if (targetTab?.windowId != null) {
    try {
      const currentWindow = await chrome.windows.get(targetTab.windowId)
      await chrome.windows.update(targetTab.windowId, {
        focused: true,
        ...(currentWindow.state === "minimized" ? { state: "normal" } : {}),
      })
    } catch {
      // A aba já foi aberta/ativada; não falha o comando por causa do estado da janela.
    }
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-devboard-panel") void openDeveloperPanel()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-devboard-panel") return
  void openDeveloperPanel()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : String(error) }))
  return true
})

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const stored = await chrome.storage.local.get("devboardBaseUrl")
  if (!stored.devboardBaseUrl) await chrome.storage.local.set({ devboardBaseUrl: DEFAULT_BASE_URL })
  if (reason === "install") await chrome.runtime.openOptionsPage()
})
