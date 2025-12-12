const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  fetchWorkbook: () => ipcRenderer.invoke("fetch-workbook"),
  updateWorkbook: (records, sheetName) =>
    ipcRenderer.invoke("update-workbook", { records, sheetName }),
  exportXlsx: () => ipcRenderer.invoke("export-xlsx"),
  importXlsx: () => ipcRenderer.invoke("import-xlsx")
});