function ensureElectronAPI() {
  if (!window?.electronAPI) {
    throw new Error("Brak warstwy Electron. Uruchom aplikację jako klienta desktopowego.");
  }
  return window.electronAPI;
}

function tryGetElectronAPI() {
  return window?.electronAPI || null;
}

async function fetchWorkbook() {
  const api = ensureElectronAPI();
  const response = await api.fetchWorkbook();
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się pobrać danych z MySQL");
  }
  return response;
}

async function updateWorkbook(records, sheetName) {
  const api = ensureElectronAPI();
  const response = await api.updateWorkbook(records, sheetName);
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zapisać danych do MySQL");
  }
  return response;
}

// NOWE: miękki logger – jak brak Electron API, po prostu nic nie robi
async function logEvent(entry) {
  const api = tryGetElectronAPI();
  if (!api?.logEvent) return;

  try {
    await api.logEvent({
      ts: Date.now(),
      ...entry
    });
  } catch (err) {
    // logowanie nie może rozwalić apki
    console.warn("logEvent failed:", err);
  }
}

export { fetchWorkbook, updateWorkbook, logEvent };