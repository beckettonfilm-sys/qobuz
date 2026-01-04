const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  fetchWorkbook: () => ipcRenderer.invoke("fetch-workbook"),
  updateWorkbook: (payload = {}) => ipcRenderer.invoke("update-workbook", payload),
  exportXlsx: (payload = {}) => ipcRenderer.invoke("export-xlsx", payload),
  importXlsx: (payload = {}) => ipcRenderer.invoke("import-xlsx", payload),
  importNewsXlsx: (payload = {}) => ipcRenderer.invoke("import-news-xlsx", payload),
  selectDirectory: (payload = {}) => ipcRenderer.invoke("select-directory", payload),
  selectFile: (payload = {}) => ipcRenderer.invoke("select-file", payload),
  getAppDirectory: () => ipcRenderer.invoke("get-app-directory"),
  resolveImportFile: (payload = {}) => ipcRenderer.invoke("resolve-import-file", payload),
  saveFile: (payload) => ipcRenderer.invoke("save-file", payload),
  backupDatabase: () => ipcRenderer.invoke("backup-database"),
  fetchFilterPresets: () => ipcRenderer.invoke("fetch-filter-presets"),
  saveFilterPreset: (payload = {}) => ipcRenderer.invoke("save-filter-preset", payload),
  renameFilterPreset: (payload = {}) => ipcRenderer.invoke("rename-filter-preset", payload),
  deleteFilterPreset: (payload = {}) => ipcRenderer.invoke("delete-filter-preset", payload),
  isProcessRunning: (payload = {}) => ipcRenderer.invoke("is-process-running", payload),
  openExternal: (url) => ipcRenderer.invoke("open-external", url)
});