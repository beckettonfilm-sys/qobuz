const LABEL_HIERARCHY = [
  "01A - ECM New Series","02A - Deutsche Grammophon (DG)","03A - Chandos","04A - Sony Classical",
  "05A - Decca Music Group Ltd.","06A - Harmonia mundi","07A - Alpha Classics","08A - PENTATONE",
  "09A - Channel Classics","10B - Hyperion","11B - BIS","12B - Warner Classics / Erato",
  "13B - Delphian Records","14B - Lawo Classics","15B - Naxos","16B - Signum Records",
  "17B - LSO Live","18B - Berlin Classics","19C - Aparté","20C - Orchid Classics",
  "21C - Fuga Libera","22C - Ondine","23C - Evidence Classics","24C - Navona","25C - Ricercar",
  "26C - Arcana","27C - Nonesuch","28C - Linn Records","29C - AVIE Records","30C - Naive",
  "31C - Rubicon","32C - Mirare","33C - CPO","34C - Brilliant Classics","35C - Capriccio",
  "36C - BR-Klassik","37C - Resonus Classics","38C - Onyx Classics","39C - First Hand Records",
  "40C - Piano Classics","41C - Hänssler CLASSIC","42C - Grand Piano","43C - Bright Shiny Things",
  "44C - RCA Red Seal"
];

const LABEL_MAP = LABEL_HIERARCHY.reduce((map, item) => {
  const [code, name] = item.split(" - ");
  if (code && name) {
    map.set(name.trim(), code.trim());
  }
  return map;
}, new Map());

const DEFAULT_FOLDER_COLOR = "#2e7d32";
const DEFAULT_CONTAINER_COLOR = "#1976d2";
const DEFAULT_EMPTY_COLOR = "#9e9e9e";
const ALBUMS_PER_PAGE = 12;

const CATEGORY_CLASSES = {
  DB: "cat-C",
  NR: "cat-A",
  FD: "cat-B",
  CS: "cat-D"
};

function formatAddedString(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}-${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatStatusDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseAddedField(value) {
  if (value === undefined || value === null || value === "") return { text: "", ts: 0 };
  if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
    const decoded = window.XLSX.SSF.parse_date_code(value);
    if (decoded) {
      const dt = new Date(
        decoded.y,
        (decoded.m || 1) - 1,
        decoded.d || 1,
        decoded.H || 0,
        decoded.M || 0,
        Math.floor(decoded.S || 0)
      );
      if (!Number.isNaN(dt.getTime())) {
        return { text: formatAddedString(dt), ts: dt.getTime() };
      }
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { text: "", ts: 0 };
    const match = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})[-\s](\d{2}):(\d{2}):(\d{2})$/);
    if (match) {
      const dt = new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6])
      );
      if (!Number.isNaN(dt.getTime())) {
        return { text: formatAddedString(dt), ts: dt.getTime() };
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return { text: formatAddedString(parsed), ts: parsed.getTime() };
    }
    return { text: trimmed, ts: 0 };
  }
  return { text: "", ts: 0 };
}

function parseReleaseDateValue(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") {
    if (value > 1000000000000) return Math.floor(value / 1000);
    if (value > 1000000000) return Math.floor(value);
    if (window.XLSX?.SSF?.parse_date_code) {
      const decoded = window.XLSX.SSF.parse_date_code(value);
      if (decoded) {
        const dt = new Date(
          decoded.y,
          (decoded.m || 1) - 1,
          decoded.d || 1,
          decoded.H || 0,
          decoded.M || 0,
          Math.floor(decoded.S || 0)
        );
        if (!Number.isNaN(dt.getTime())) {
          return Math.floor(dt.getTime() / 1000);
        }
      }
    }
    return 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (/^-?\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      if (num > 1000000000000) return Math.floor(num / 1000);
      return num;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return Math.floor(parsed.getTime() / 1000);
    }
  }
  return 0;
}

function sanitizeName(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeColor(value, fallback) {
  if (typeof value === "string") {
    let trimmed = value.trim();
    if (!trimmed) return fallback;
    if (!trimmed.startsWith("#") && /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
      trimmed = `#${trimmed}`;
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return fallback;
}

function compareByReleaseDesc(a, b) {
  const diff = (b.release_date || 0) - (a.release_date || 0);
  if (diff !== 0) return diff;
  const labelDiff = getLabelOrderCode(a.label) - getLabelOrderCode(b.label);
  if (labelDiff !== 0) return labelDiff;
  return (a.title || "").localeCompare(b.title || "", "pl", { sensitivity: "base" });
}

function compareByAddedDesc(a, b) {
  const diff = (b.added_ts || 0) - (a.added_ts || 0);
  if (diff !== 0) return diff;
  return compareByReleaseDesc(a, b);
}

function getLabelOrderCode(label) {
  const code = LABEL_MAP.get(label);
  return code ? parseInt(code, 10) : 999;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "brak";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function truncateName(name, n) {
  if (!name) return "";
  if (name.length <= n) return name;
  return `${name.slice(0, n)}…`;
}

class DataStore {
  constructor() {
    this.records = [];
    this.categorized = { DB: [], NR: [], FD: [], CS: [] };
    this.foldersList = new Set(["brak"]);
    this.containersList = new Set(["brak"]);
    this.folderMeta = new Map([["brak", { color: DEFAULT_EMPTY_COLOR, container: "brak" }]]);
    this.containerMeta = new Map([["brak", { color: DEFAULT_EMPTY_COLOR, folders: new Set() }]]);
    this.selectedLabels = new Set(Array.from(LABEL_MAP.keys()));
    this.currentSheetName = "Sheet1";
    this.currentFileName = "";
    this.currentFileTimestamp = "";
  }

  setFileMeta({ name, timestamp } = {}) {
    if (name) {
      this.currentFileName = name;
    }
    if (timestamp) {
      const dt = timestamp instanceof Date ? timestamp : new Date(timestamp);
      if (!Number.isNaN(dt.getTime())) {
        this.currentFileTimestamp = formatStatusDate(dt);
      }
    }
  }

  convertRowToRecord(row = {}) {
    const selectorRaw = row.SELECTOR ?? row.SETECTOR ?? "N";
    const selector = String(selectorRaw || "N").trim() || "N";
    const folder = String(row.FOLDER ?? "brak").trim() || "brak";
    const container = String(row.KONTENER ?? row.CONTAINER ?? "brak").trim() || "brak";
    const addedInfo = parseAddedField(row.ADDED);
    const releaseDate = parseReleaseDateValue(row.RELEASE_DATE);
    const folderColor = normalizeColor(
      row.Col_F ?? row.COL_F ?? row.col_f,
      folder === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_FOLDER_COLOR
    );
    const containerColor = normalizeColor(
      row.Col_K ?? row.COL_K ?? row.col_k,
      container === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_CONTAINER_COLOR
    );
    return {
      selector,
      origSelector: selector,
      folder,
      container,
      added: addedInfo.text,
      added_ts: addedInfo.ts,
      label: String(row.LABEL ?? ""),
      link: String(row.LINK ?? ""),
      picture: String(row.PICTURE ?? ""),
      artist: String(row.ARTIST ?? ""),
      title: String(row.TITLE ?? ""),
      duration: Number(row.DURATION) || 0,
      release_date: releaseDate,
      release_original: row.RELEASE_DATE,
      col_f: folderColor,
      col_k: containerColor
    };
  }

  loadFromRows(rows = [], { sheetName } = {}) {
    this.records = rows.map((row) => this.convertRowToRecord(row));
    this.currentSheetName = sheetName || this.currentSheetName || "Sheet1";
    this.rebuildMetaStructures();
    this.rebuildCategories({});
  }

  rebuildMetaStructures() {
    this.foldersList = new Set(["brak"]);
    this.containersList = new Set(["brak"]);
    this.folderMeta = new Map([["brak", { color: DEFAULT_EMPTY_COLOR, container: "brak" }]]);
    this.containerMeta = new Map([["brak", { color: DEFAULT_EMPTY_COLOR, folders: new Set() }]]);

    this.records.forEach((rec) => {
      const folderName = sanitizeName(rec.folder) || "brak";
      const containerName = sanitizeName(rec.container) || "brak";
      const folderColor = normalizeColor(
        rec.col_f,
        folderName === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_FOLDER_COLOR
      );
      const containerColor = normalizeColor(
        rec.col_k,
        containerName === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_CONTAINER_COLOR
      );

      rec.folder = folderName;
      rec.container = containerName;
      rec.col_f = folderColor;
      rec.col_k = containerColor;

      this.foldersList.add(folderName);
      this.containersList.add(containerName);

      if (!this.containerMeta.has(containerName)) {
        this.containerMeta.set(containerName, { color: containerColor, folders: new Set() });
      }
      const containerInfo = this.containerMeta.get(containerName);
      containerInfo.color = normalizeColor(
        containerColor,
        containerInfo.color || (containerName === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_CONTAINER_COLOR)
      );
      if (!containerInfo.folders) containerInfo.folders = new Set();
      if (folderName !== "brak") containerInfo.folders.add(folderName);

      if (!this.folderMeta.has(folderName)) {
        this.folderMeta.set(folderName, { color: folderColor, container: containerName });
      }
      const folderInfo = this.folderMeta.get(folderName);
      folderInfo.color = normalizeColor(
        folderColor,
        folderInfo.color || (folderName === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_FOLDER_COLOR)
      );
      folderInfo.container = containerName;
    });
  }

  getFolderColor(name) {
    const normalized = sanitizeName(name) || "brak";
    if (this.folderMeta.has(normalized)) {
      return this.folderMeta.get(normalized).color;
    }
    return normalized === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_FOLDER_COLOR;
  }

  getContainerColor(name) {
    const normalized = sanitizeName(name) || "brak";
    if (this.containerMeta.has(normalized)) {
      return this.containerMeta.get(normalized).color;
    }
    return normalized === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_CONTAINER_COLOR;
  }

  ensureFolderEntry(name, container = "brak") {
    const normalized = sanitizeName(name) || "brak";
    if (!this.folderMeta.has(normalized)) {
      this.folderMeta.set(normalized, { color: this.getFolderColor(normalized), container });
    }
    const entry = this.folderMeta.get(normalized);
    entry.container = sanitizeName(container) || entry.container || "brak";
    this.foldersList.add(normalized);
    return entry;
  }

  ensureContainerEntry(name) {
    const normalized = sanitizeName(name) || "brak";
    if (!this.containerMeta.has(normalized)) {
      this.containerMeta.set(normalized, { color: this.getContainerColor(normalized), folders: new Set() });
    }
    const entry = this.containerMeta.get(normalized);
    if (!entry.folders) entry.folders = new Set();
    this.containersList.add(normalized);
    return entry;
  }

  rebuildCategories({ dateFrom = null, dateTo = null, labels = null } = {}) {
    const dateFromTs = dateFrom ? Math.floor(dateFrom.getTime() / 1000) : null;
    const dateToTs = dateTo ? Math.floor(dateTo.getTime() / 1000) + 86399 : null;

    const allowedLabels = labels ? new Set(labels) : this.selectedLabels;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;

    const categorized = { DB: [], NR: [], FD: [], CS: [] };

    this.records.forEach((record) => {
      if (allowedLabels.size && !allowedLabels.has(record.label)) return;
      if (dateFromTs && record.release_date && record.release_date < dateFromTs) return;
      if (dateToTs && record.release_date && record.release_date > dateToTs) return;

      const album = record;
      album._durationNum = record.duration;
      if (typeof album.added_ts !== "number") {
        const info = parseAddedField(album.added);
        album.added = info.text;
        album.added_ts = info.ts;
      }
      album.col_f = this.getFolderColor(album.folder || "brak");
      album.col_k = this.getContainerColor(album.container || "brak");

      if (album._durationNum < 1800) categorized.CS.push(album);

      const diffDays = album.release_date
        ? Math.floor((todayStart - album.release_date) / 86400)
        : 9999;
      if (album.release_date && diffDays >= 0 && diffDays <= 6) {
        categorized.NR.push(album);
      }

      if (album.folder && album.folder !== "brak") categorized.FD.push(album);

      categorized.DB.push(album);
      if (album.folder && album.folder.trim()) this.foldersList.add(album.folder);
    });

    const excludeIds = new Set();
    categorized.NR.forEach((a) => excludeIds.add(a.link));
    categorized.CS.forEach((a) => excludeIds.add(a.link));
    categorized.DB = categorized.DB.filter((a) => !excludeIds.has(a.link));

    categorized.DB.sort(compareByReleaseDesc);
    categorized.NR.sort(compareByReleaseDesc);
    categorized.FD.sort(compareByAddedDesc);
    categorized.CS.sort(compareByReleaseDesc);

    this.categorized = categorized;
    return categorized;
  }

  getCategoryList(category) {
    return this.categorized[category] || [];
  }

  getPagedCategory(category, page, { folderFilter, containerFilter } = {}) {
    let list = this.getCategoryList(category);
    if (category === "FD") {
      if (folderFilter && folderFilter !== "__all__") {
        list = this.records
          .filter((rec) => (rec.folder || "brak") === folderFilter)
          .map((rec) => {
            if (typeof rec.added_ts !== "number") {
              const info = parseAddedField(rec.added);
              rec.added = info.text;
              rec.added_ts = info.ts;
            }
            return rec;
          })
          .sort(compareByAddedDesc);
      } else if (containerFilter && containerFilter !== "__all__") {
        list = list.filter((item) => (item.container || "brak") === containerFilter);
      }
    }

    const total = list.length;
    const totalPages = total ? Math.ceil(total / ALBUMS_PER_PAGE) : 0;
    const safePage = totalPages === 0 ? 0 : Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * ALBUMS_PER_PAGE;
    const end = start + ALBUMS_PER_PAGE;
    return {
      pageItems: list.slice(start, end),
      total,
      totalPages,
      currentPage: safePage
    };
  }

  assignAlbumToFolder(album, targetFolder) {
    if (!album || !targetFolder || targetFolder === "__all__") return null;
    const normalizedTarget = targetFolder;
    const currentFolder = album.folder || "brak";
    if (normalizedTarget === currentFolder) return null;

    if (normalizedTarget !== "brak" && !this.folderMeta.has(normalizedTarget)) {
      throw new Error("Wybrany folder nie istnieje w aktualnej liście.");
    }

    let updates = {};
    const oldFolder = currentFolder;
    const oldContainer = album.container || "brak";

    if (normalizedTarget === "brak") {
      album.folder = "brak";
      album.container = "brak";
      album.added = "";
      album.added_ts = 0;
      album.col_f = DEFAULT_EMPTY_COLOR;
      album.col_k = this.getContainerColor("brak");
      updates = {
        folder: "brak",
        container: "brak",
        added: "",
        added_ts: 0,
        col_f: album.col_f,
        col_k: album.col_k
      };
    } else {
      const folderInfo = this.folderMeta.get(normalizedTarget) || this.ensureFolderEntry(normalizedTarget, "brak");
      this.foldersList.add(normalizedTarget);
      const containerName = folderInfo.container || "brak";
      const now = new Date();
      const addedStr = formatAddedString(now);
      album.folder = normalizedTarget;
      album.container = containerName;
      album.added = addedStr;
      album.added_ts = now.getTime();
      album.col_f = this.getFolderColor(normalizedTarget);
      album.col_k = this.getContainerColor(containerName);
      this.ensureContainerEntry(containerName).folders.add(normalizedTarget);
      updates = {
        folder: normalizedTarget,
        container: containerName,
        added: addedStr,
        added_ts: album.added_ts,
        col_f: album.col_f,
        col_k: album.col_k
      };
    }

    if (oldFolder !== "brak") {
      const oldMeta = this.folderMeta.get(oldFolder);
      if (oldMeta && oldMeta.container) {
        this.ensureContainerEntry(oldMeta.container);
      }
    }
    if (oldContainer && oldContainer !== "brak") {
      this.ensureContainerEntry(oldContainer);
    }

    Object.assign(album, updates);
    return updates;
  }

  syncRecord(record, updates) {
    if (!record || !updates) return;
    Object.assign(record, updates);
  }

  getFolderCounts(containerFilter) {
    const map = {};
    this.foldersList.forEach((folder) => {
      map[folder] = 0;
    });
    this.records.forEach((record) => {
      const folder = sanitizeName(record.folder) || "brak";
      const container = sanitizeName(record.container) || "brak";
      if (containerFilter && containerFilter !== "__all__" && container !== containerFilter) return;
      if (!(folder in map)) map[folder] = 0;
      map[folder] += 1;
    });
    return map;
  }

  getContainerCounts() {
    const map = {};
    this.containersList.forEach((container) => {
      map[container] = 0;
    });
    this.records.forEach((record) => {
      const container = sanitizeName(record.container) || "brak";
      if (!(container in map)) map[container] = 0;
      map[container] += 1;
    });
    return map;
  }

  getLabelSelection() {
    return new Set(this.selectedLabels);
  }

  setLabelSelection(labels) {
    this.selectedLabels = new Set(labels);
  }

  getSerializableRecords() {
    return this.records.map((rec) => {
      const releaseValue =
        rec.release_original !== undefined && rec.release_original !== null && rec.release_original !== ""
          ? rec.release_original
          : rec.release_date || 0;
      return {
        SELECTOR: rec.selector || rec.origSelector || "N",
        FOLDER: rec.folder || "brak",
        KONTENER: rec.container || "brak",
        ADDED: rec.added || "",
        LABEL: rec.label || "",
        LINK: rec.link || "",
        PICTURE: rec.picture || "",
        ARTIST: rec.artist || "",
        TITLE: rec.title || "",
        DURATION: rec.duration || 0,
        RELEASE_DATE: releaseValue,
        Col_K: rec.col_k || this.getContainerColor(rec.container || "brak"),
        Col_F: rec.col_f || this.getFolderColor(rec.folder || "brak")
      };
    });
  }

  buildWorkbook() {
    const headers = [
      "SELECTOR",
      "FOLDER",
      "KONTENER",
      "ADDED",
      "LABEL",
      "LINK",
      "PICTURE",
      "ARTIST",
      "TITLE",
      "DURATION",
      "RELEASE_DATE",
      "Col_K",
      "Col_F"
    ];
    const data = this.getSerializableRecords();
    const worksheet = window.XLSX.utils.json_to_sheet(data, { header: headers, skipHeader: false });
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, this.currentSheetName || "Sheet1");
    return workbook;
  }

  getHierarchy() {
    return [...LABEL_HIERARCHY];
  }

  formatDuration(seconds) {
    return formatDuration(seconds);
  }

  truncateName(name, n) {
    return truncateName(name, n);
  }

  getCategoryClass(cat) {
    return CATEGORY_CLASSES[cat] || "";
  }

  updateSelector(album, nextSelector) {
    if (!album) return;
    album.selector = nextSelector;
    this.syncRecord(album, { selector: nextSelector });
  }
}

export {
  DataStore,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_CONTAINER_COLOR,
  DEFAULT_EMPTY_COLOR,
  ALBUMS_PER_PAGE,
  CATEGORY_CLASSES,
  LABEL_HIERARCHY,
  LABEL_MAP,
  formatAddedString,
  formatStatusDate,
  parseAddedField,
  formatDuration,
  truncateName
};