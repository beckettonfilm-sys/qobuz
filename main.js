const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  ensureSchema,
  fetchRecords,
  replaceRecords,
  TABLE_NAME,
  resolvedConfig
} = require("./backend/db");

const SHEET_NAME = "MySQL";
let mainWindow;

// LOG w tym samym katalogu co main.js / aplikacja
const LOG_FILE_PATH = path.join(__dirname, "debug-log.txt");

function appendLogLine(line) {
  fs.appendFile(LOG_FILE_PATH, line + "\n", (err) => {
    if (err) {
      console.error("Log write failed:", err);
    }
  });
}

function logFromMain(type, payload = {}) {
  const ts = payload.ts || Date.now();
  const stamp = new Date(ts).toISOString();
  const clean = { ...payload, ts };
  appendLogLine(`[${stamp}] [${type}] ${JSON.stringify(clean)}`);
}

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
  const start = Date.now();
  logFromMain("bootstrap-start", {});
  try {
    await ensureSchema();
    const durationMs = Date.now() - start;
    logFromMain("bootstrap-done", { durationMs });
  } catch (error) {
    const durationMs = Date.now() - start;
    logFromMain("bootstrap-error", { durationMs, message: error.message });
    dialog.showErrorBox(
      "Błąd połączenia z MySQL",
      `Nie udało się przygotować bazy danych. Sprawdź konfigurację połączenia.\n\nSzczegóły: ${error.message}`
    );
    throw error;
  }
}

function registerHandlers() {
  ipcMain.handle("fetch-workbook", async () => {
    const start = Date.now();
    logFromMain("fetch-workbook-start", {});

    const records = await fetchRecords();

    const durationMs = Date.now() - start;
    logFromMain("fetch-workbook-done", {
      durationMs,
      recordCount: Array.isArray(records) ? records.length : 0
    });

    return {
      status: "ok",
      file_name: `Baza MySQL – tabela '${TABLE_NAME}'`,
      sheet_name: SHEET_NAME,
      updated_at: Date.now(),
      records
    };
  });

  ipcMain.handle("update-workbook", async (_event, payload = {}) => {
    const { records = [], sheetName = SHEET_NAME } = payload;

    const start = Date.now();
    logFromMain("update-workbook-start", {
      sheetName,
      recordCount: Array.isArray(records) ? records.length : 0
    });

    const count = await replaceRecords(records);
    const timestamp = Date.now();
    const durationMs = timestamp - start;

    logFromMain("update-workbook-done", {
      sheetName,
      savedCount: count,
      durationMs
    });

    return {
      status: "ok",
      message: `✅ Zapisano ${count} rekordów w tabeli MySQL '${TABLE_NAME}'.`,
      updated_at: timestamp,
      sheet_name: sheetName,
      file_name: `Baza MySQL – tabela '${TABLE_NAME}'`
    };
  });

  // Logger z renderera (ui.js / api.js → logEvent)
  ipcMain.handle("log-event", async (_event, payload = {}) => {
    logFromMain("renderer-event", payload || {});
    return { status: "ok" };
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
