const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  fetchWorkbook: () => ipcRenderer.invoke("fetch-workbook"),

  updateWorkbook: (records, sheetName) =>
    ipcRenderer.invoke("update-workbook", { records, sheetName }),

  // NOWE:
  logEvent: (entry) => ipcRenderer.invoke("log-event", entry)
});