const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");

const CONFIG_PATH = path.join(__dirname, "db.config.json");
const CONFIG_SAMPLE_PATH = path.join(__dirname, "db.config.example.json");

const defaultConfig = {
  table: process.env.SQLITE_TABLE || "zajebiste_dane"
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`⚠️ Nie udało się odczytać pliku konfiguracyjnego ${filePath}:`, error);
    return {};
  }
}

const fileConfig = readJson(CONFIG_PATH);
const exampleConfig = readJson(CONFIG_SAMPLE_PATH);
const resolvedConfig = {
  ...exampleConfig,
  ...defaultConfig,
  ...fileConfig
};

const TABLE_NAME = resolvedConfig.table || "zajebiste_dane";
const FILTER_TABLE_NAME = "filtr_data";
const DB_PREFIX = "music_database";
const BACKUP_DIR = path.join(__dirname, "BACKUP_DB");
let dbInstance;
let dbFilePath;

function formatTimestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}_${pad(date.getHours())}-${pad(
    date.getMinutes()
  )}-${pad(date.getSeconds())}`;
}

function buildDatabaseFileName(date = new Date()) {
  return `${DB_PREFIX}_${formatTimestampForFileName(date)}.sqlite`;
}

async function ensureBackupDir() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
}

async function findLatestDatabaseFile() {
  await ensureBackupDir();
  const regex = new RegExp(
    `^${DB_PREFIX}_(\\d{2})-(\\d{2})-(\\d{4})_(\\d{2})-(\\d{2})-(\\d{2})\\.sqlite$`,
    "i"
  );
  const entries = await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    const match = entry.isFile() ? entry.name.match(regex) : null;
    if (!match) continue;
    const fullPath = path.join(BACKUP_DIR, entry.name);
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

async function resolveDatabaseFile() {
  if (dbFilePath) return dbFilePath;
  await ensureBackupDir();

  const latest = await findLatestDatabaseFile();
  if (latest) {
    dbFilePath = latest.path;
    return dbFilePath;
  }

  const fileName = buildDatabaseFileName();
  dbFilePath = path.join(BACKUP_DIR, fileName);
  return dbFilePath;
}

async function getDatabase() {
  if (dbInstance) return dbInstance;
  await resolveDatabaseFile();
  dbInstance = new sqlite3.Database(dbFilePath);
  return dbInstance;
}

async function closeDatabase() {
  if (!dbInstance) return;
  await new Promise((resolve, reject) => {
    dbInstance.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  dbInstance = null;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function addColumnIfMissing(db, name, definitionSql) {
  const columns = await all(db, `PRAGMA table_info("${TABLE_NAME}")`);
  if (columns.some((col) => col.name === name)) {
    return;
  }
  await run(db, `ALTER TABLE "${TABLE_NAME}" ADD COLUMN "${name}" ${definitionSql}`);
  console.log(`Kolumna ${name} została dodana do tabeli ${TABLE_NAME}.`);
}

async function ensureSchema() {
  const db = await getDatabase();

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS "${TABLE_NAME}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_order INTEGER NOT NULL DEFAULT 0,
      selector TEXT NOT NULL DEFAULT 'N',
      folder TEXT NOT NULL DEFAULT 'brak',
      container TEXT NOT NULL DEFAULT 'brak',
      heard INTEGER NOT NULL DEFAULT 0,
      ory_copy TEXT NOT NULL DEFAULT 'O',
      added TEXT NULL,
      label TEXT NULL,
      link TEXT NULL,
      picture TEXT NULL,
      artist TEXT NULL,
      title TEXT NULL,
      duration INTEGER NULL,
      release_date INTEGER NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS "idx_${TABLE_NAME}_row_order" ON "${TABLE_NAME}" (row_order)`
  );

  await addColumnIfMissing(db, "heard", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "ory_copy", "TEXT NOT NULL DEFAULT 'O'");

  await run(
    db,
    `CREATE TRIGGER IF NOT EXISTS "${TABLE_NAME}_updated_at"
    AFTER UPDATE ON "${TABLE_NAME}"
    BEGIN
      UPDATE "${TABLE_NAME}" SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS "${FILTER_TABLE_NAME}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await run(
    db,
    `CREATE TRIGGER IF NOT EXISTS "${FILTER_TABLE_NAME}_updated_at"
    AFTER UPDATE ON "${FILTER_TABLE_NAME}"
    BEGIN
      UPDATE "${FILTER_TABLE_NAME}" SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;`
  );
}

const COLUMN_MAP = [
  { field: "SELECTOR", column: "selector" },
  { field: "FOLDER", column: "folder" },
  { field: "KONTENER", column: "container" },
  { field: "HEARD", column: "heard" },
  { field: "ORY_COPY", column: "ory_copy" },
  { field: "ADDED", column: "added" },
  { field: "LABEL", column: "label" },
  { field: "LINK", column: "link" },
  { field: "PICTURE", column: "picture" },
  { field: "ARTIST", column: "artist" },
  { field: "TITLE", column: "title" },
  { field: "DURATION", column: "duration" },
  { field: "RELEASE_DATE", column: "release_date" }
];

function normalizeValue(column, value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (column === "duration" || column === "release_date" || column === "heard") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return value;
}

async function fetchRecords() {
  const db = await getDatabase();
  const rows = await all(
    db,
    `SELECT ${COLUMN_MAP.map((c) => `"${c.column}"`).join(", ")}
     FROM "${TABLE_NAME}"
     ORDER BY row_order ASC, id ASC`
  );
  return rows.map((row) => {
    const record = {};
    COLUMN_MAP.forEach(({ field, column }) => {
      const raw = row[column];
      record[field] = raw === null || raw === undefined ? "" : raw;
    });
    return record;
  });
}

async function fetchFilterPresets() {
  const db = await getDatabase();
  return all(
    db,
    `SELECT name, payload, updated_at
     FROM "${FILTER_TABLE_NAME}"
     ORDER BY name COLLATE NOCASE ASC`
  );
}

async function saveFilterPreset(name, payload) {
  const db = await getDatabase();
  const serialized = JSON.stringify(payload ?? {});
  await run(
    db,
    `INSERT INTO "${FILTER_TABLE_NAME}" (name, payload)
     VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET
       payload = excluded.payload,
       updated_at = CURRENT_TIMESTAMP`,
    [name, serialized]
  );
}

async function renameFilterPreset(currentName, nextName) {
  const db = await getDatabase();
  await run(
    db,
    `UPDATE "${FILTER_TABLE_NAME}"
     SET name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
    [nextName, currentName]
  );
}

async function replaceRecords(records = []) {
  const db = await getDatabase();
  const total = records.length;
  const batchSize = 200;

  console.log(`🧹 DELETE + INSERT w paczkach (batchSize=${batchSize}) dla ${total} rekordów...`);

  try {
    const t0 = Date.now();
    await run(db, "BEGIN TRANSACTION");
    await run(db, `DELETE FROM "${TABLE_NAME}"`);
    try {
      await run(db, "DELETE FROM sqlite_sequence WHERE name = ?", [TABLE_NAME]);
    } catch (error) {
      console.warn("⚠️ Nie udało się zresetować sekwencji SQLite:", error.message);
    }
    const tAfterDelete = Date.now();

    if (total) {
      const dataColumns = COLUMN_MAP.map((c) => `"${c.column}"`);
      const columns = [...dataColumns, '"row_order"'];

      let inserted = 0;

      for (let offset = 0; offset < total; offset += batchSize) {
        const batch = records.slice(offset, offset + batchSize);

        const placeholders = batch
          .map(() => `(${COLUMN_MAP.map(() => "?").join(", ")}, ?)`)
          .join(", ");

        const values = [];

        batch.forEach((record, indexInBatch) => {
          COLUMN_MAP.forEach(({ field, column }) => {
            values.push(normalizeValue(column, record[field]));
          });
          const rowOrder = offset + indexInBatch;
          values.push(rowOrder);
        });

        const sql = `INSERT INTO "${TABLE_NAME}" (${columns.join(", ")}) VALUES ${placeholders}`;
        await run(db, sql, values);

        inserted += batch.length;
        console.log(`   → Wstawiono ${inserted}/${total} rekordów...`);
      }
    }

    await run(db, "COMMIT");
    const tEnd = Date.now();

    const deleteMs = tAfterDelete - t0;
    const insertMs = tEnd - tAfterDelete;
    const totalMs = tEnd - t0;

    console.log(
      `✅ Zastąpiono rekordy w bazie. Łącznie: ${total}. ` +
      `DELETE: ${deleteMs} ms, INSERT: ${insertMs} ms, razem: ${(totalMs / 1000).toFixed(2)} s.`
    );

    return total;
  } catch (error) {
    await run(db, "ROLLBACK");
    console.error("❌ Błąd w replaceRecords:", error.message);
    throw error;
  }
}

async function appendRecords(records = []) {
  const db = await getDatabase();
  const sourceRows = Array.isArray(records) ? records.length : 0;
  if (!sourceRows) return { inserted: 0, duplicates: 0, missingLink: 0, sourceRows: 0 };

  const existingRows = await all(db, `SELECT link, row_order FROM "${TABLE_NAME}" ORDER BY row_order ASC`);
  const existingKeys = new Set();
  let maxOrder = 0;

  existingRows.forEach((row) => {
    const linkKey = row.link || "";
    if (linkKey) existingKeys.add(linkKey);
    maxOrder = Math.max(maxOrder, row.row_order || 0);
  });

  const dataColumns = COLUMN_MAP.map((c) => `"${c.column}"`);
  const columns = [...dataColumns, '"row_order"'];

  const rowsToInsert = [];
  const insertedLinks = [];
  const duplicateRecords = [];
  let order = maxOrder + 1;

  let duplicates = 0;
  let missingLink = 0;

  records.forEach((record) => {
    const linkKey = record.LINK || record.link || "";
    if (!linkKey) {
      missingLink += 1;
      return;
    }
    if (existingKeys.has(linkKey)) {
      duplicates += 1;
      duplicateRecords.push(record);
      return;
    }
    existingKeys.add(linkKey);
    insertedLinks.push(linkKey);

    const rowValues = [];
    COLUMN_MAP.forEach(({ field, column }) => {
      rowValues.push(normalizeValue(column, record[field]));
    });
    rowValues.push(order);
    order += 1;
    rowsToInsert.push(rowValues);
  });

  if (!rowsToInsert.length) {
    return { inserted: 0, duplicates, missingLink, sourceRows, insertedLinks, duplicateRecords };
  }

  const batchSize = 200;

  await run(db, "BEGIN TRANSACTION");
  try {
    for (let offset = 0; offset < rowsToInsert.length; offset += batchSize) {
      const batch = rowsToInsert.slice(offset, offset + batchSize);
      const placeholders = batch.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
      const flatValues = batch.flat();
      await run(db, `INSERT INTO "${TABLE_NAME}" (${columns.join(", ")}) VALUES ${placeholders}`, flatValues);
    }
    await run(db, "COMMIT");
  } catch (error) {
    await run(db, "ROLLBACK");
    throw error;
  }

  return { inserted: rowsToInsert.length, duplicates, missingLink, sourceRows, insertedLinks, duplicateRecords };
}

async function createDatabaseBackup() {
  await ensureSchema();
  await ensureBackupDir();
  const sourcePath = await resolveDatabaseFile();
  const backupFileName = buildDatabaseFileName();
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  await fs.promises.copyFile(sourcePath, backupPath);
  dbFilePath = backupPath;
  await closeDatabase();
  return { backupFileName, backupPath, sourcePath };
}

module.exports = {
  ensureSchema,
  fetchRecords,
  fetchFilterPresets,
  replaceRecords,
  appendRecords,
  saveFilterPreset,
  renameFilterPreset,
  createDatabaseBackup,
  TABLE_NAME,
  FILTER_TABLE_NAME,
  resolvedConfig
};