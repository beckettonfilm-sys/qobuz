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

async function exportWorkbookToFile() {
  const api = ensureElectronAPI();
  const response = await api.exportXlsx();
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się wyeksportować danych do XLSX");
  }
  return response;
}

async function importWorkbookFromFile() {
  const api = ensureElectronAPI();
  const response = await api.importXlsx();
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zaimportować danych z XLSX");
  }
  return response;
}

export { fetchWorkbook, updateWorkbook, exportWorkbookToFile, importWorkbookFromFile };