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

async function exportWorkbookToFile(directory) {
  const api = ensureElectronAPI();
  const response = await api.exportXlsx({ directory });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się wyeksportować danych do XLSX");
  }
  return response;
}

async function importWorkbookFromFile(directory) {
  const api = ensureElectronAPI();
  const response = await api.importXlsx({ directory });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zaimportować danych z XLSX");
  }
  return response;
}

async function importNewsWorkbookFromFile(directory) {
  const api = ensureElectronAPI();
  const response = await api.importNewsXlsx({ directory });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zaimportować danych z XLSX");
  }
  return response;
}

async function selectDirectory() {
  const api = ensureElectronAPI();
  const response = await api.selectDirectory();
  if (!response) {
    throw new Error("Nie udało się wybrać folderu docelowego");
  }
  if (response.status === "ok") return response.path;
  if (response.status === "cancelled") return null;
  throw new Error(response?.error || "Nie udało się wybrać folderu docelowego");
}

async function getAppDirectory() {
  const api = ensureElectronAPI();
  const response = await api.getAppDirectory();
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się ustalić katalogu aplikacji");
  }
  return response.path;
}

async function saveBinaryFile(fileName, data, directory) {
  const api = ensureElectronAPI();
  const response = await api.saveFile({
    fileName,
    directory,
    binary: true,
    data: Array.from(new Uint8Array(data))
  });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zapisać pliku");
  }
  return response.filePath;
}

async function saveTextFile(fileName, contents, directory) {
  const api = ensureElectronAPI();
  const response = await api.saveFile({
    fileName,
    directory,
    binary: false,
    data: contents
  });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zapisać pliku TXT");
  }
  return response.filePath;
}

export {
  fetchWorkbook,
  updateWorkbook,
  exportWorkbookToFile,
  importWorkbookFromFile,
  importNewsWorkbookFromFile,
  selectDirectory,
  getAppDirectory,
  saveBinaryFile,
  saveTextFile
};
