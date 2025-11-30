const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const {
  ensureSchema,
  fetchRecords,
  replaceRecords,
  TABLE_NAME,
  resolvedConfig
} = require("./backend/db");

const SHEET_NAME = "MySQL";
let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.maximize();

  await mainWindow.loadFile(path.join(__dirname, "index.html"));
}

async function bootstrapDatabase() {
  try {
    await ensureSchema();
  } catch (error) {
    dialog.showErrorBox(
      "Błąd połączenia z MySQL",
      `Nie udało się przygotować bazy danych. Sprawdź konfigurację połączenia.\n\nSzczegóły: ${error.message}`
    );
    throw error;
  }
}

function registerHandlers() {
  ipcMain.handle("fetch-workbook", async () => {
    const records = await fetchRecords();
    return {
      status: "ok",
      file_name: `MySQL://${resolvedConfig.host}/${resolvedConfig.database}/${TABLE_NAME}`,
      sheet_name: SHEET_NAME,
      updated_at: Date.now(),
      records
    };
  });

  ipcMain.handle("update-workbook", async (_event, payload = {}) => {
    const { records = [], sheetName = SHEET_NAME } = payload;
    const count = await replaceRecords(records);
    const timestamp = Date.now();
    return {
      status: "ok",
      message: `✅ Zapisano ${count} rekordów w tabeli MySQL '${TABLE_NAME}'.`,
      updated_at: timestamp,
      sheet_name: sheetName,
      file_name: `MySQL://${resolvedConfig.host}/${resolvedConfig.database}/${TABLE_NAME}`
    };
  });
}

app.whenReady().then(async () => {
  await bootstrapDatabase();
  registerHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});