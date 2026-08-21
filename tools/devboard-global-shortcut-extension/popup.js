const current = document.getElementById("current")
const status = document.getElementById("status")

async function refresh() {
  const { devboardBaseUrl = "http://localhost:3000" } = await chrome.storage.local.get("devboardBaseUrl")
  current.textContent = devboardBaseUrl
  current.title = devboardBaseUrl
}

async function bindCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return
  try {
    const url = new URL(tab.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Abra o Devboard nesta aba primeiro.")
    await chrome.storage.local.set({ devboardBaseUrl: url.origin })
    status.textContent = "Devboard vinculado a esta aba."
    await refresh()
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Não foi possível vincular esta aba."
  }
}

document.getElementById("bind").addEventListener("click", () => void bindCurrentTab())
document.getElementById("open").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "open-devboard-panel" }, () => window.close())
})
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage())
void refresh()
