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
    throw new Error(response?.error || "Nie udało się pobrać danych z SQLite / bazy danych");
  }
  return response;
}

async function updateWorkbook(records, sheetName) {
  const api = ensureElectronAPI();
  const response = await api.updateWorkbook(records, sheetName);
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zapisać danych do SQLite / bazy danych");
  }
  return response;
}

async function exportWorkbookToFile(options = {}) {
  const api = ensureElectronAPI();
  const response = await api.exportXlsx(options);
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się wyeksportować danych do XLSX");
  }
  return response;
}

async function importWorkbookFromFile(options = {}) {
  const api = ensureElectronAPI();
  const response = await api.importXlsx(options);
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zaimportować danych z XLSX");
  }
  return response;
}

async function importNewsWorkbookFromFile(options = {}) {
  const api = ensureElectronAPI();
  const response = await api.importNewsXlsx(options);
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zaimportować danych z XLSX");
  }
  return response;
}

async function selectDirectory(options = {}) {
  const api = ensureElectronAPI();
  const response = await api.selectDirectory(options);
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

async function selectFile(options = {}) {
  const api = ensureElectronAPI();
  const response = await api.selectFile(options);
  if (!response) {
    throw new Error("Nie udało się wybrać pliku");
  }
  if (response.status === "ok") return response.path;
  if (response.status === "cancelled") return null;
  throw new Error(response?.error || "Nie udało się wybrać pliku");
}

async function resolveImportFile(options = {}) {
  const api = ensureElectronAPI();
  const response = await api.resolveImportFile(options);
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się odnaleźć pliku do importu");
  }
  return response;
}

async function backupDatabase() {
  const api = ensureElectronAPI();
  const response = await api.backupDatabase();
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się wykonać backupu bazy danych");
  }
  return response;
}

async function fetchFilterPresets() {
  const api = ensureElectronAPI();
  const response = await api.fetchFilterPresets();
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się pobrać zapisanych filtrów");
  }
  return response.presets || [];
}

async function saveFilterPreset(name, filters) {
  const api = ensureElectronAPI();
  const response = await api.saveFilterPreset({ name, filters });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zapisać filtrów");
  }
  return response;
}

async function renameFilterPreset(currentName, nextName) {
  const api = ensureElectronAPI();
  const response = await api.renameFilterPreset({ currentName, nextName });
  if (!response || response.status !== "ok") {
    throw new Error(response?.error || "Nie udało się zmienić nazwy filtrów");
  }
  return response;
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
  selectFile,
  getAppDirectory,
  resolveImportFile,
  backupDatabase,
  saveBinaryFile,
  saveTextFile,
  fetchFilterPresets,
  saveFilterPreset,
  renameFilterPreset
};
