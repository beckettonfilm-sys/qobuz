const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const {
  ensureSchema,
  fetchAlbums,
  fetchCollections,
  fetchContainers,
  fetchFolders,
  fetchAlbumFolders,
  fetchFilterPresets,
  replaceAlbums,
  replaceFolderData,
  appendRecords,
  saveFilterPreset,
  renameFilterPreset,
  deleteFilterPreset,
  createDatabaseBackup,
  TABLE_NAME
} = require("./db");
const XLSX = require("xlsx");
const fs = require("fs");

const SHEET_NAME = "SQLite";

// Dodatkowe arkusze – backup/restore folderów i kontenerów.
// (Stare pliki XLSX mogą ich nie mieć – wtedy import zachowuje bieżące dane folderów z DB.)
const EXTRA_SHEETS = {
  collections: "COLLECTIONS",
  containers: "CONTAINERS",
  folders: "FOLDERS",
  albumFolders: "ALBUM_FOLDERS"
};

function getWorksheetByName(workbook, preferredName) {
  if (!workbook?.Sheets) return null;
  if (preferredName && workbook.Sheets[preferredName]) return workbook.Sheets[preferredName];
  if (!preferredName) return null;

  // Case-insensitive fallback (Excel potrafi przestawić / zmienić wielkość liter).
  const match = (workbook.SheetNames || []).find(
    (name) => String(name || "").trim().toLowerCase() === String(preferredName).trim().toLowerCase()
  );
  return match ? workbook.Sheets[match] : null;
}

function sheetToJsonSafe(worksheet) {
  if (!worksheet) return [];
  return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
}

function buildAlbumIdSet(rows = []) {
  const set = new Set();
  rows.forEach((row) => {
    const id = Number(row?.ID_ALBUMU);
    if (Number.isFinite(id) && id > 0) set.add(id);
  });
  return set;
}

function normalizeContainersFromFolders(folders = []) {
  const seen = new Set();
  const result = [];
  folders.forEach((folder) => {
    const name = String(folder?.container || "").trim();
    if (!name) return;
    if (seen.has(name)) return;
    seen.add(name);
    result.push({ name, sort_order: result.length });
  });
  return result;
}

function normalizeCollectionsFromContainers(containers = []) {
  const seen = new Set();
  const result = [];
  containers.forEach((container) => {
    const name = String(container?.collection || "").trim();
    if (!name) return;
    if (seen.has(name)) return;
    seen.add(name);
    result.push({ name, sort_order: result.length });
  });
  return result;
}

const DATA_PREFIXES = {
  importDb: "music_database",
  updateDb: "update_database"
};

function formatTimestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}_${pad(date.getHours())}-${pad(
    date.getMinutes()
  )}-${pad(date.getSeconds())}`;
}

function buildTimestampedName(prefix, extension = "xlsx") {
  return `${prefix}_${formatTimestampForFileName()}.${extension}`;
}

function buildDuplicateAlbumsFileName() {
  return `zdublowane_albumy_${formatTimestampForFileName()}.xlsx`;
}

async function findLatestDataFile(targetDir, prefix) {
  const regex = new RegExp(
    `^${prefix}_(\\d{2})-(\\d{2})-(\\d{4})_(\\d{2})-(\\d{2})-(\\d{2})\\.xlsx$`,
    "i"
  );
  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    const match = entry.isFile() ? entry.name.match(regex) : null;
    if (!match) continue;
    const fullPath = path.join(targetDir, entry.name);
    const stats = await fs.promises.stat(fullPath);
    const [, day, month, year, hour, minute, second] = match;
    const parsedDate = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    const stamp = Number.isFinite(parsedDate.getTime()) ? parsedDate.getTime() : stats.mtimeMs;
    candidates.push({ name: entry.name, path: fullPath, timestamp: stamp });
  }

  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return candidates[0] || null;
}

async function resolveSourceFile({ directory, filePath, prefix }) {
  const targetDir = directory || app.getAppPath() || __dirname;
  await ensureDirectory(targetDir);

  if (filePath) {
    const normalized = path.resolve(filePath);
    if (!fs.existsSync(normalized)) {
      throw new Error(`Wybrany plik nie istnieje: ${normalized}`);
    }
    return { path: normalized, name: path.basename(normalized) };
  }

  const latest = await findLatestDataFile(targetDir, prefix);
  if (!latest) {
    throw new Error(`Brak pliku ${prefix}_DD-MM-RRRR_HH-MM-SS.xlsx w folderze ${targetDir}.`);
  }
  return { path: latest.path, name: latest.name };
}

async function ensureDirectory(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}
let mainWindow;

function buildExportSummary({ total, schemaMs, dbMs, xlsxMs, overallMs, fileName }) {
  const lines = [
    `✅ Eksport zakończony. Zapisano ${total} rekordów do pliku ${fileName}.`,
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

function isProcessRunning(processName) {
  if (!processName) return Promise.resolve(false);
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("tasklist", ["/FI", `IMAGENAME eq ${processName}`], { windowsHide: true }, (error, stdout = "") => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
      });
      return;
    }
    execFile("ps", ["-A"], (error, stdout = "") => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
    });
  });
}

function maximizeTidalWindow() {
  if (process.platform !== "win32") return Promise.resolve(false);
  const script = [
    "$sig = '[DllImport(\"user32.dll\")]public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);[DllImport(\"user32.dll\")]public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    "Add-Type -MemberDefinition $sig -Name WinAPI -Namespace Win32",
    "$process = Get-Process -Name 'TIDAL' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    "if ($process) { [Win32.WinAPI]::ShowWindowAsync($process.MainWindowHandle, 3) | Out-Null; [Win32.WinAPI]::SetForegroundWindow($process.MainWindowHandle) | Out-Null }"
  ].join("; ");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true },
      (error) => {
        resolve(!error);
      }
    );
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.maximize();

  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }

  await mainWindow.loadFile(path.join(__dirname, "index.html"));
}

async function bootstrapDatabase() {
  try {
    await ensureSchema();
  } catch (error) {
    dialog.showErrorBox(
      "Błąd połączenia z SQLite / bazą danych",
      `Nie udało się przygotować bazy danych. Sprawdź plik bazy danych.\n\nSzczegóły: ${error.message}`
    );
    throw error;
  }
}

function registerHandlers() {
  ipcMain.handle("fetch-workbook", async () => {
    const records = await fetchAlbums();
    const collections = await fetchCollections();
    const containers = await fetchContainers();
    const folders = await fetchFolders();
    const albumFolders = await fetchAlbumFolders();
    return {
      status: "ok",
      file_name: `SQLite / baza danych – tabela '${TABLE_NAME}'`,
      sheet_name: SHEET_NAME,
      updated_at: Date.now(),
      records,
      collections,
      containers,
      folders,
      albumFolders
    };
  });

  ipcMain.handle("fetch-filter-presets", async () => {
    await ensureSchema();
    const presets = await fetchFilterPresets();
    return {
      status: "ok",
      presets
    };
  });

  ipcMain.handle("save-filter-preset", async (_event, payload = {}) => {
    const name = String(payload?.name || "").trim();
    if (!name) {
      throw new Error("Nazwa filtra jest wymagana.");
    }
    await ensureSchema();
    await saveFilterPreset(name, payload?.filters || {});
    return { status: "ok" };
  });

  ipcMain.handle("rename-filter-preset", async (_event, payload = {}) => {
    const currentName = String(payload?.currentName || "").trim();
    const nextName = String(payload?.nextName || "").trim();
    if (!currentName || !nextName) {
      throw new Error("Nazwa filtra jest wymagana.");
    }
    await ensureSchema();
    await renameFilterPreset(currentName, nextName);
    return { status: "ok" };
  });

  ipcMain.handle("delete-filter-preset", async (_event, payload = {}) => {
    const name = String(payload?.name || "").trim();
    if (!name) {
      throw new Error("Nazwa filtra jest wymagana.");
    }
    await ensureSchema();
    await deleteFilterPreset(name);
    return { status: "ok" };
  });

  ipcMain.handle("is-process-running", async (_event, payload = {}) => {
    const name = String(payload?.name || "").trim();
    if (!name) {
      return { status: "error", error: "Nazwa procesu jest wymagana." };
    }
    const running = await isProcessRunning(name);
    return { status: "ok", running };
  });

  ipcMain.handle("update-workbook", async (_event, payload = {}) => {
    const {
      records = [],
      sheetName = SHEET_NAME,
      collections = [],
      containers = [],
      folders = [],
      albumFolders = []
    } = payload;
    const count = await replaceAlbums(records);
    await replaceFolderData({ collections, containers, folders, albumFolders });
    const timestamp = Date.now();
    return {
      status: "ok",
      message: `✅ Zapisano ${count} rekordów w tabeli SQLite / baza danych '${TABLE_NAME}'.`,
      updated_at: timestamp,
      sheet_name: sheetName,
      file_name: `SQLite / baza danych – tabela '${TABLE_NAME}'`
    };
  });

  ipcMain.handle("backup-database", async () => {
    const result = await createDatabaseBackup();
    return {
      status: "ok",
      backupFileName: result.backupFileName,
      backupPath: result.backupPath,
      sourcePath: result.sourcePath
    };
  });

  ipcMain.handle("export-xlsx", async (_event, payload = {}) => {
    const targetDir = payload?.directory || app.getAppPath() || __dirname;
    await ensureDirectory(targetDir);
    const fileName = buildTimestampedName(DATA_PREFIXES.importDb);
    const dataFilePath = path.join(targetDir, fileName);

    const overallStart = Date.now();
    const schemaStart = Date.now();
    await ensureSchema();
    const schemaEnd = Date.now();

    const dbStart = Date.now();
    const [records, collections, containers, folders, albumFolders] = await Promise.all([
      fetchAlbums(),
      fetchCollections(),
      fetchContainers(),
      fetchFolders(),
      fetchAlbumFolders()
    ]);
    const dbEnd = Date.now();

    const xlsxStart = Date.now();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), SHEET_NAME);
    // Foldery/kontenery jako osobne arkusze – dzięki temu IMPORT DB przywraca je w całości.
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(collections || []), EXTRA_SHEETS.collections);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(containers || []), EXTRA_SHEETS.containers);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(folders || []), EXTRA_SHEETS.folders);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(albumFolders || []), EXTRA_SHEETS.albumFolders);
    XLSX.writeFile(workbook, dataFilePath);
    const xlsxEnd = Date.now();

    const overallEnd = Date.now();
    const payloadResponse = {
      status: "ok",
      total: records.length,
      filePath: dataFilePath,
      fileName,
      summary: buildExportSummary({
        total: records.length,
        schemaMs: schemaEnd - schemaStart,
        dbMs: dbEnd - dbStart,
        xlsxMs: xlsxEnd - xlsxStart,
        overallMs: overallEnd - overallStart,
        fileName
      })
    };
    return payloadResponse;
  });

  ipcMain.handle("import-xlsx", async (_event, payload = {}) => {
    const targetDir = payload?.directory || app.getAppPath() || __dirname;
    await ensureDirectory(targetDir);

    const source = await resolveSourceFile({
      directory: targetDir,
      filePath: payload?.filePath,
      prefix: DATA_PREFIXES.importDb
    });

    const overallStart = Date.now();
    const readStart = Date.now();
    const workbook = XLSX.readFile(source.path);

    // 1) Albumy – preferujemy arkusz o nazwie SHEET_NAME ("SQLite"), bo stary import brał "pierwszy".
    const albumSheetName = workbook.Sheets?.[SHEET_NAME] ? SHEET_NAME : workbook.SheetNames[0];
    const albumWorksheet = workbook.Sheets?.[albumSheetName];
    if (!albumWorksheet) {
      throw new Error(`Nie znaleziono arkusza w pliku XLSX (${albumSheetName}).`);
    }
    const rows = XLSX.utils.sheet_to_json(albumWorksheet, { defval: "" });

    // 2) Foldery/kontenery – jeśli plik je zawiera, importujemy z pliku.
    // Jeśli NIE zawiera (stare pliki), zachowujemy bieżące dane folderów z DB.
    const collectionsWs = getWorksheetByName(workbook, EXTRA_SHEETS.collections);
    const containersWs = getWorksheetByName(workbook, EXTRA_SHEETS.containers);
    const foldersWs = getWorksheetByName(workbook, EXTRA_SHEETS.folders);
    const albumFoldersWs = getWorksheetByName(workbook, EXTRA_SHEETS.albumFolders);
    const hasAnyFolderSheet = Boolean(collectionsWs || containersWs || foldersWs || albumFoldersWs);

    const readEnd = Date.now();

    await ensureSchema();

    let collections = sheetToJsonSafe(collectionsWs);
    let containers = sheetToJsonSafe(containersWs);
    let folders = sheetToJsonSafe(foldersWs);
    let albumFolders = sheetToJsonSafe(albumFoldersWs);

    if (!hasAnyFolderSheet) {
      // Stary XLSX (bez arkuszy folderów) → nie kasujemy folderów/kontenerów i przypisań.
      [collections, containers, folders, albumFolders] = await Promise.all([
        fetchCollections(),
        fetchContainers(),
        fetchFolders(),
        fetchAlbumFolders()
      ]);
    } else {
      // Mamy przynajmniej część arkuszy folderów.
      if (!foldersWs) {
        // Bez listy folderów nie da się sensownie odtworzyć struktury – bierzemy ją z DB.
        const [existingCollections, existingContainers, existingFolders, existingAlbumFolders] = await Promise.all([
          fetchCollections(),
          fetchContainers(),
          fetchFolders(),
          fetchAlbumFolders()
        ]);
        if (!collectionsWs) collections = existingCollections;
        if (!containersWs) containers = existingContainers;
        folders = existingFolders;
        if (!albumFoldersWs) albumFolders = existingAlbumFolders;
      } else {
        // Foldery są w pliku.
        if (!containersWs || !Array.isArray(containers) || containers.length === 0) {
          // Plik ma foldery, ale nie ma kontenerów → wyciągamy kontenery z kolumny "container".
          containers = normalizeContainersFromFolders(folders);
        }

        if (!collectionsWs || !Array.isArray(collections) || collections.length === 0) {
          collections = normalizeCollectionsFromContainers(containers);
          if (!collections.length) {
            collections = await fetchCollections();
          }
        }

        if (!albumFoldersWs) {
          // Struktura folderów jest w pliku, ale przypisań brak → próbujemy zachować przypisania z DB.
          albumFolders = await fetchAlbumFolders();
        }
      }
    }

    // 3) Bezpiecznik FK: przypisania muszą wskazywać na istniejące ID_ALBUMU z importu.
    const importedAlbumIds = buildAlbumIdSet(rows);
    if (importedAlbumIds.size === 0) {
      albumFolders = [];
    } else {
      albumFolders = (albumFolders || []).filter((item) => importedAlbumIds.has(Number(item?.album_id)));
    }

    const dbStart = Date.now();
    const total = await replaceAlbums(rows);
    await replaceFolderData({ collections, containers, folders, albumFolders });
    const dbEnd = Date.now();

    const overallEnd = Date.now();
    const payloadResponse = {
      status: "ok",
      total,
      sheetName: albumSheetName,
      summary: buildImportSummary({
        totalRows: total,
        sheetName: albumSheetName,
        readMs: readEnd - readStart,
        dbMs: dbEnd - dbStart,
        overallMs: overallEnd - overallStart
      }),
      fileName: source.name
    };
    return payloadResponse;
  });

  ipcMain.handle("import-news-xlsx", async (_event, payload = {}) => {
    const targetDir = payload?.directory || app.getAppPath() || __dirname;
    await ensureDirectory(targetDir);

    const source = await resolveSourceFile({
      directory: targetDir,
      filePath: payload?.filePath,
      prefix: DATA_PREFIXES.updateDb
    });

    const overallStart = Date.now();
    const readStart = Date.now();
    const workbook = XLSX.readFile(source.path);
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
    const duplicateRecords = stats?.duplicateRecords || [];
    let duplicatesFileName = null;
    let duplicatesFilePath = null;
    if (duplicateRecords.length) {
      const duplicateWorkbook = XLSX.utils.book_new();
      const duplicateSheet = XLSX.utils.json_to_sheet(duplicateRecords);
      XLSX.utils.book_append_sheet(duplicateWorkbook, duplicateSheet, "DUPLIKATY");
      duplicatesFileName = buildDuplicateAlbumsFileName();
      const targetDirectory = path.dirname(source.path);
      duplicatesFilePath = path.join(targetDirectory, duplicatesFileName);
      XLSX.writeFile(duplicateWorkbook, duplicatesFilePath);
    }
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
      insertedLinks: stats?.insertedLinks || [],
      duplicatesFileName,
      duplicatesFilePath,
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
      }),
      fileName: source.name
    };
    return payloadResponse;
  });

  ipcMain.handle("select-directory", async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Wybierz folder dla operacji danych",
      defaultPath: payload?.defaultPath
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

  ipcMain.handle("select-file", async (_event, payload = {}) => {
    const { defaultPath, filters } = payload;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Wybierz plik danych",
      defaultPath,
      filters: filters && Array.isArray(filters) ? filters : [{ name: "Arkusze Excel", extensions: ["xlsx"] }]
    });
    if (result.canceled || !result.filePaths.length) {
      return { status: "cancelled", error: "Użytkownik anulował wybór" };
    }
    return { status: "ok", path: result.filePaths[0] };
  });

  ipcMain.handle("resolve-import-file", async (_event, payload = {}) => {
    const { directory, filePath, prefix } = payload;
    const source = await resolveSourceFile({ directory, filePath, prefix: prefix || DATA_PREFIXES.importDb });
    return { status: "ok", filePath: source.path, fileName: source.name };
  });

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

  ipcMain.handle("open-external", async (_event, url) => {
    if (!url || typeof url !== "string") return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("maximize-tidal-window", async () => {
    return maximizeTidalWindow();
  });
}

app.whenReady().then(async () => {
  if (process.platform !== "darwin") {
    // Wyłączamy menu aplikacji na Windows/Linux, żeby ALT nie przełączał focusu na pasek menu
    // (to potrafi rozwalić wpisywanie w polach tekstowych po native dialogach).
    Menu.setApplicationMenu(null);
  }
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