// export-to-xlsx.js
const path = require("path");
const XLSX = require("xlsx");

const { ensureSchema, fetchRecords } = require("./db");

async function run() {
  const overallStart = Date.now();

  try {
    console.log("🛢 Sprawdzam schemat bazy...");
    const schemaStart = Date.now();
    await ensureSchema();
    const schemaEnd = Date.now();

    console.log("📥 Pobieram dane z bazy...");
    const dbStart = Date.now();
    const records = await fetchRecords();
    const dbEnd = Date.now();

    console.log(`W bazie jest ${records.length} rekordów.`);
    console.log(`⏱ Pobranie danych z bazy: ${((dbEnd - dbStart) / 1000).toFixed(2)} s`);

    if (!records.length) {
      console.log("Brak danych w bazie - nie ma czego eksportować.");
      return;
    }

    console.log("📑 Tworzę arkusz Excela...");
    const xlsxStart = Date.now();

    const worksheet = XLSX.utils.json_to_sheet(records);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    const filePath = path.join(__dirname, "dane.xlsx");
    XLSX.writeFile(workbook, filePath);

    const xlsxEnd = Date.now();

    console.log(`✅ Eksport zakończony. Zapisano do pliku: ${filePath}`);
    console.log(`⏱ Tworzenie i zapis Excela: ${((xlsxEnd - xlsxStart) / 1000).toFixed(2)} s`);

    const overallEnd = Date.now();
    console.log(`⏱ Cały eksport (DB → Excel): ${((overallEnd - overallStart) / 1000).toFixed(2)} s`);
  } catch (error) {
    console.error("❌ Błąd podczas eksportu do XLSX:", error.message);
    console.error(error);
  } finally {
    process.exit();
  }
}

run();
