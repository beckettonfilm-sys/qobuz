const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  fetchWorkbook: () => ipcRenderer.invoke("fetch-workbook"),
  updateWorkbook: (records, sheetName) =>
    ipcRenderer.invoke("update-workbook", { records, sheetName }),
  exportXlsx: (payload = {}) => ipcRenderer.invoke("export-xlsx", payload),
  importXlsx: (payload = {}) => ipcRenderer.invoke("import-xlsx", payload),
  importNewsXlsx: (payload = {}) => ipcRenderer.invoke("import-news-xlsx", payload),
  selectDirectory: (payload = {}) => ipcRenderer.invoke("select-directory", payload),
  selectFile: (payload = {}) => ipcRenderer.invoke("select-file", payload),
  getAppDirectory: () => ipcRenderer.invoke("get-app-directory"),
  resolveImportFile: (payload = {}) => ipcRenderer.invoke("resolve-import-file", payload),
  saveFile: (payload) => ipcRenderer.invoke("save-file", payload)
});