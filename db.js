const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const CONFIG_PATH = path.join(__dirname, "..", "db.config.json");
const CONFIG_SAMPLE_PATH = path.join(__dirname, "..", "db.config.example.json");

const defaultConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "qobuz_albums",
  table: process.env.MYSQL_TABLE || "zajebiste_dane"
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
let pool;

async function addColumnIfMissing(poolInstance, name, definitionSql) {
  try {
    await poolInstance.query(
      `ALTER TABLE \`${TABLE_NAME}\` ADD COLUMN \`${name}\` ${definitionSql}`
    );
    console.log(`Kolumna ${name} została dodana do tabeli ${TABLE_NAME}.`);
  } catch (err) {
    // 1060 / ER_DUP_FIELDNAME = kolumna już istnieje → olewamy
    if (err.code === "ER_DUP_FIELDNAME" || err.errno === 1060) {
      console.log(`Kolumna ${name} już istnieje – pomijam ADD COLUMN.`);
      return;
    }
    // każdy inny błąd puszczamy dalej
    throw err;
  }
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: resolvedConfig.host,
      port: resolvedConfig.port,
      user: resolvedConfig.user,
      password: resolvedConfig.password,
      database: resolvedConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4_unicode_ci"
    });
  }
  return pool;
}

async function ensureDatabase() {
  const connection = await mysql.createConnection({
    host: resolvedConfig.host,
    port: resolvedConfig.port,
    user: resolvedConfig.user,
    password: resolvedConfig.password,
    multipleStatements: false
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${resolvedConfig.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function ensureSchema() {
  await ensureDatabase();
  const poolInstance = getPool();

  // 1. Jeżeli tabeli nie ma – tworzymy z aktualnym schematem
  await poolInstance.query(`
    CREATE TABLE IF NOT EXISTS \`${TABLE_NAME}\` (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      row_order INT UNSIGNED NOT NULL DEFAULT 0,
      selector VARCHAR(64) NOT NULL DEFAULT 'N',
      folder VARCHAR(255) NOT NULL DEFAULT 'brak',
      container VARCHAR(255) NOT NULL DEFAULT 'brak',
      heard INT UNSIGNED NOT NULL DEFAULT 0,
      ory_copy CHAR(1) NOT NULL DEFAULT 'O',
      added VARCHAR(64) NULL,
      label VARCHAR(255) NULL,
      link TEXT NULL,
      picture TEXT NULL,
      artist TEXT NULL,
      title  TEXT NULL,
      duration INT NULL,
      release_date BIGINT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_row_order (row_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  // 2. Jeżeli tabela już istniała, ale była stara – dodać brakujące kolumny

  // heard (jak w schema powyżej)
  await addColumnIfMissing(
    poolInstance,
    "heard",
    "INT UNSIGNED NOT NULL DEFAULT 0 AFTER `container`"
  );

  // ory_copy (jak w schema powyżej)
  await addColumnIfMissing(
    poolInstance,
    "ory_copy",
    "CHAR(1) NOT NULL DEFAULT 'O' AFTER `heard`"
  );

  // Jeśli w przyszłości dodasz kolejne kolumny – dopisujesz je tutaj:
  // await addColumnIfMissing(poolInstance, "nowa_kolumna", "TYP NULL AFTER `jakas_inna`");
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
  const poolInstance = getPool();
  const [rows] = await poolInstance.query(
    `SELECT ${COLUMN_MAP.map((c) => c.column).join(", ")} FROM \`${TABLE_NAME}\` ORDER BY row_order ASC, id ASC`
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

async function replaceRecords(records = []) {
  const poolInstance = getPool();
  const connection = await poolInstance.getConnection();
  const total = records.length;
  const batchSize = 5000; // ile rekordów na jeden INSERT

  console.log(`🧹 TRUNCATE + INSERT w paczkach (batchSize=${batchSize}) dla ${total} rekordów...`);

  try {
    const t0 = Date.now();

    await connection.beginTransaction();
    await connection.query(`TRUNCATE TABLE \`${TABLE_NAME}\``);
    const tAfterTruncate = Date.now();

    if (total) {
      const dataColumns = COLUMN_MAP.map((c) => `\`${c.column}\``);
      const columns = [...dataColumns, "`row_order`"];

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

        const sql = `INSERT INTO \`${TABLE_NAME}\` (${columns.join(", ")}) VALUES ${placeholders}`;
        await connection.query(sql, values);

        inserted += batch.length;
        console.log(`   → Wstawiono ${inserted}/${total} rekordów...`);
      }
    }

    await connection.commit();
    const tEnd = Date.now();

    const truncateMs = tAfterTruncate - t0;
    const insertMs = tEnd - tAfterTruncate;
    const totalMs = tEnd - t0;

    console.log(
      `✅ Zastąpiono rekordy w bazie. Łącznie: ${total}. ` +
      `TRUNCATE: ${truncateMs} ms, INSERT: ${insertMs} ms, razem: ${(totalMs / 1000).toFixed(2)} s.`
    );

    return total;
  } catch (error) {
    await connection.rollback();
    console.error("❌ Błąd w replaceRecords:", error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ensureSchema,
  fetchRecords,
  replaceRecords,
  TABLE_NAME,
  resolvedConfig
};