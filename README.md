# Qobuz Electron App

## Overview
This project packages the previous browser/Flask interface into a standalone Electron desktop application that works on Windows and macOS. The renderer still loads `index.html` plus the existing JS/CSS assets, but all data access now flows through the Electron main process.

## Data source (zamiast pliku `ZAJEBISTE_DANE.xlsx`)
- Aplikacja **nie czyta już** bezpośrednio arkusza XLSX. Zamiast tego, `ui.js` wywołuje metody z `api.js`, które korzystają z kanałów IPC `fetch-workbook` oraz `update-workbook`.
- Kanały IPC są obsługiwane w `main.js`, a tamtejsze funkcje używają modułu `backend/db.js`.
- `backend/db.js` łączy się z bazą **MySQL** (korzystając z ustawień z `db.config.json` lub zmiennych środowiskowych) i pobiera dane z tabeli `zajebiste_dane` (lub innej wskazanej w konfiguracji). To z tej tabeli ładowane są rekordy, które wcześniej znajdowały się w `ZAJEBISTE_DANE.xlsx`.
- Jeżeli tabela jest pusta, interfejs nadal się uruchomi, a przycisk „ODŚWIEŻ” spróbuje pobrać zawartość z bazy; zapis poprzez „ZAPISZ” aktualizuje rekordy w MySQL.

## Konfiguracja
1. Sklonuj repo i zainstaluj zależności: `npm install`.
2. Skopiuj `db.config.example.json` do `db.config.json` i uzupełnij danymi swojej instancji MySQL (lub ustaw zmienne środowiskowe `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_TABLE`).
3. Uruchom MySQL i upewnij się, że użytkownik ma uprawnienia do tworzenia bazy/tabeli – `backend/db.js` sam zadba o ich utworzenie.

## Uruchomienie
```bash
npm start
```
Aplikacja otworzy okno Electron i załaduje dotychczasowy interfejs. Wszystkie odczyty/zapisy danych będą trafiały do bazy MySQL, więc plik `ZAJEBISTE_DANE.xlsx` jest już potrzebny jedynie jako archiwum referencyjne.