const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const {
  ensureSchema,
  fetchRecords,
  replaceRecords,
  TABLE_NAME,
  resolvedConfig
} = require("./backend/db");
const XLSX = require("xlsx");
const fs = require("fs");

const SHEET_NAME = "MySQL";
const DATA_FILE = path.join(__dirname, "dane.xlsx");
let mainWindow;

function buildExportSummary({ total, schemaMs, dbMs, xlsxMs, overallMs }) {
  const lines = [
    `✅ Eksport zakończony. Zapisano ${total} rekordów do pliku dane.xlsx.`,
    `⏱ Schemat bazy: ${(schemaMs / 1000).toFixed(2)} s`,
    `⏱ Pobranie danych: ${(dbMs / 1000).toFixed(2)} s`,
    `⏱ Tworzenie XLSX: ${(xlsxMs / 1000).toFixed(2)} s`,
    `⏱ Całość: ${(overallMs / 1000).toFixed(2)} s`
  ];
  return lines.join("\n");
}

function buildImportSummary({ totalRows, sheetName, readMs, dbMs, overallMs }) {
  const lines = [
    `✅ Import zakończony. Wstawiono ${totalRows} rekordów z arkusza "${sheetName}".`,
    `⏱ Wczytanie XLSX: ${(readMs / 1000).toFixed(2)} s`,
    `⏱ Operacje na bazie: ${(dbMs / 1000).toFixed(2)} s`,
    `⏱ Całość: ${(overallMs / 1000).toFixed(2)} s`
  ];
  return lines.join("\n");
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
      file_name: `Baza MySQL – tabela '${TABLE_NAME}'`,
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
      file_name: `Baza MySQL – tabela '${TABLE_NAME}'`
    };
  });

  ipcMain.handle("export-xlsx", async () => {
    const overallStart = Date.now();
    const schemaStart = Date.now();
    await ensureSchema();
    const schemaEnd = Date.now();

    const dbStart = Date.now();
    const records = await fetchRecords();
    const dbEnd = Date.now();

    const xlsxStart = Date.now();
    const worksheet = XLSX.utils.json_to_sheet(records);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME);
    XLSX.writeFile(workbook, DATA_FILE);
    const xlsxEnd = Date.now();

    const overallEnd = Date.now();
    const payload = {
      status: "ok",
      total: records.length,
      filePath: DATA_FILE,
      summary: buildExportSummary({
        total: records.length,
        schemaMs: schemaEnd - schemaStart,
        dbMs: dbEnd - dbStart,
        xlsxMs: xlsxEnd - xlsxStart,
        overallMs: overallEnd - overallStart
      })
    };
    return payload;
  });

  ipcMain.handle("import-xlsx", async () => {
    const overallStart = Date.now();
    const filePath = DATA_FILE;
    if (!fs.existsSync(filePath)) {
      throw new Error("Brak pliku dane.xlsx do importu.");
    }

    const readStart = Date.now();
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Nie znaleziono arkusza w pliku XLSX (${sheetName}).`);
    }
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    const readEnd = Date.now();

    await ensureSchema();
    const dbStart = Date.now();
    const total = await replaceRecords(rows);
    const dbEnd = Date.now();

    const overallEnd = Date.now();
    const payload = {
      status: "ok",
      total,
      sheetName,
      summary: buildImportSummary({
        totalRows: total,
        sheetName,
        readMs: readEnd - readStart,
        dbMs: dbEnd - dbStart,
        overallMs: overallEnd - overallStart
      })
    };
    return payload;
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