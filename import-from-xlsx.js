// import-from-xlsx.js
const path = require("path");
const XLSX = require("xlsx");

const { ensureSchema, replaceAlbums, replaceFolderData } = require("./db");

async function run() {
  const overallStart = Date.now();

  try {
    const filePath = path.join(__dirname, "dane.xlsx");

    console.log("📂 Czytam plik XLSX:", filePath);
    const readStart = Date.now();
    const workbook = XLSX.readFile(filePath);

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error(`Nie znaleziono arkusza w pliku XLSX (${sheetName})`);
    }

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: "" // puste komórki jako pusty string
    });
    const readEnd = Date.now();

    console.log(`📑 Wczytano ${rows.length} wierszy z arkusza "${sheetName}".`);
    console.log(`⏱ Wczytanie + parsowanie Excela: ${((readEnd - readStart) / 1000).toFixed(2)} s`);

    if (!rows.length) {
      throw new Error("Plik XLSX nie zawiera żadnych wierszy danych");
    }

    console.log("🛢 Sprawdzam schemat bazy...");
    const dbStart = Date.now();
    await ensureSchema();

    console.log("🧹 Czyszczę tabelę i wstawiam nowe rekordy (pełne nadpisanie)...");
    const total = await replaceAlbums(rows);
    await replaceFolderData({ containers: [], folders: [], albumFolders: [] });
    const dbEnd = Date.now();

    console.log(`⏱ Operacje na bazie (TRUNCATE + INSERT): ${((dbEnd - dbStart) / 1000).toFixed(2)} s`);
    console.log(`✅ Import zakończony sukcesem. Rekordów w bazie: ${total}.`);

    const overallEnd = Date.now();
    console.log(`⏱ Cały import (Excel + DB): ${((overallEnd - overallStart) / 1000).toFixed(2)} s`);
  } catch (error) {
    console.error("❌ Błąd podczas importu z XLSX:", error.message);
    console.error(error);
  } finally {
    process.exit();
  }
}

run();
