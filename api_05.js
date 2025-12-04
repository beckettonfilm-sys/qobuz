function ensureElectronAPI() {
  if (!window?.electronAPI) {
    throw new Error("Brak warstwy Electron. Uruchom aplikację jako klienta desktopowego.");
  }
  return window.electronAPI;
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

export { fetchWorkbook, updateWorkbook };