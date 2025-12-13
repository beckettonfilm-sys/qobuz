const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const {
  ensureSchema,
  fetchRecords,
  replaceRecords,
  appendRecords,
  TABLE_NAME,
  resolvedConfig
} = require("./backend/db");
const XLSX = require("xlsx");
const fs = require("fs");

const SHEET_NAME = "MySQL";

function resolveDataFile(directory) {
  const targetDir = directory || app.getAppPath() || __dirname;
  return path.join(targetDir, "dane.xlsx");
}

async function ensureDirectory(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}
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

function buildImportSummary({
  totalRows,
  sheetName,
  readMs,
  dbMs,
  overallMs,
  sourceRows,
  duplicates,
  missingLink
  }) {
      const lines = [
        `✅ Import zakończony. Wstawiono ${totalRows} rekordów z arkusza "${sheetName}".`
      ];

      if (Number.isFinite(sourceRows)) lines.push(`📄 Wiersze w XLSX: ${sourceRows}`);
      if (Number.isFinite(duplicates)) lines.push(`🟡 Duplikaty (LINK): ${duplicates}`);
      if (Number.isFinite(missingLink)) lines.push(`🟠 Bez LINK: ${missingLink}`);

      lines.push(
        `⏱ Wczytanie XLSX: ${(readMs / 1000).toFixed(2)} s`,
        `⏱ Operacje na bazie: ${(dbMs / 1000).toFixed(2)} s`,
        `⏱ Całość: ${(overallMs / 1000).toFixed(2)} s`
      );

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

  ipcMain.handle("export-xlsx", async (_event, payload = {}) => {
    const targetDir = payload?.directory || app.getAppPath() || __dirname;
    await ensureDirectory(targetDir);
    const dataFilePath = resolveDataFile(targetDir);

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
    XLSX.writeFile(workbook, dataFilePath);
    const xlsxEnd = Date.now();

    const overallEnd = Date.now();
    const payloadResponse = {
      status: "ok",
      total: records.length,
      filePath: dataFilePath,
      summary: buildExportSummary({
        total: records.length,
        schemaMs: schemaEnd - schemaStart,
        dbMs: dbEnd - dbStart,
        xlsxMs: xlsxEnd - xlsxStart,
        overallMs: overallEnd - overallStart
      })
    };
    return payloadResponse;
  });

  ipcMain.handle("import-xlsx", async (_event, payload = {}) => {
    const targetDir = payload?.directory || app.getAppPath() || __dirname;
    const filePath = resolveDataFile(targetDir);
    await ensureDirectory(targetDir);

    const overallStart = Date.now();
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
    const payloadResponse = {
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
    return payloadResponse;
  });

  ipcMain.handle("import-news-xlsx", async (_event, payload = {}) => {
    const targetDir = payload?.directory || app.getAppPath() || __dirname;
    const filePath = resolveDataFile(targetDir);
    await ensureDirectory(targetDir);

    if (!fs.existsSync(filePath)) {
      throw new Error("Brak pliku dane.xlsx do importu.");
    }

    const overallStart = Date.now();
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
    const stats = await appendRecords(rows);
    const dbEnd = Date.now();

    const inserted = Number(stats?.inserted ?? 0);
    const duplicates = Number(stats?.duplicates ?? 0);
    const missingLink = Number(stats?.missingLink ?? 0);
    const sourceRows = Number(stats?.sourceRows ?? rows.length);
    const overallEnd = Date.now();

    const payloadResponse = {
      status: "ok",
      total: inserted,
      duplicates,
      missingLink,
      sourceRows,
      sheetName,
      summary: buildImportSummary({
        totalRows: inserted,
        sheetName,
        sourceRows,
        duplicates,
        missingLink,
        readMs: readEnd - readStart,
        dbMs: dbEnd - dbStart,
        overallMs: overallEnd - overallStart
      })
    };
    return payloadResponse;
  });

  ipcMain.handle("select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Wybierz folder dla operacji danych"
    });
    if (result.canceled || !result.filePaths.length) {
      return { status: "cancelled", error: "Użytkownik anulował wybór" };
    }
    return { status: "ok", path: result.filePaths[0] };
  });

  ipcMain.handle("get-app-directory", () => ({
    status: "ok",
    path: app.getAppPath() || __dirname
  }));

  ipcMain.handle("save-file", async (_event, payload = {}) => {
    const { directory, fileName, data, binary = true } = payload;
    if (!fileName) {
      return { status: "error", error: "Brak nazwy pliku" };
    }
    const targetDir = directory || app.getAppPath() || __dirname;
    await ensureDirectory(targetDir);
    const filePath = path.join(targetDir, fileName);
    const buffer = binary ? Buffer.from(data || []) : Buffer.from(String(data ?? ""), "utf8");
    await fs.promises.writeFile(filePath, buffer);
    return { status: "ok", filePath };
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