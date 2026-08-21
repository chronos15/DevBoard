const input = document.getElementById("baseUrl")
const status = document.getElementById("status")

async function load() {
  const { devboardBaseUrl = "http://localhost:3000" } = await chrome.storage.local.get("devboardBaseUrl")
  input.value = devboardBaseUrl
}

async function save() {
  try {
    const url = new URL(input.value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use um endereço http:// ou https://.")
    await chrome.storage.local.set({ devboardBaseUrl: url.origin })
    input.value = url.origin
    status.textContent = "Configuração salva."
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Endereço inválido."
  }
}

document.getElementById("save").addEventListener("click", () => void save())
void load()
