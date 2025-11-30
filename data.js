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
  FD: "cat-B"
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
    this.categorized = { DB: [], NR: [], FD: [] };
    this.foldersList = new Set(["brak"]);
    this.containersList = new Set(["brak"]);
    this.folderMeta = new Map([["brak", { container: "brak" }]]);
    this.containerMeta = new Map([["brak", { folders: new Set() }]]);
    this.selectedLabels = new Set(Array.from(LABEL_MAP.keys()));
    this.currentSheetName = "Sheet1";
    this.currentFileName = "";
    this.currentFileTimestamp = "";
    this.sortedByRelease = [];
    this.sortedByAdded = [];
    this.filteredFolderBuckets = new Map();
    this.filteredContainerBuckets = new Map();
    this.cachedCounts = {
      folders: new Map([["brak", 0]]),
      containers: new Map([["brak", 0]]),
      foldersByContainer: new Map([["brak", new Map([["brak", 0]])]])
    };
    this.indexesDirty = true;
    this.activeFilters = {
      dateFromTs: null,
      dateToTs: null,
      labelsKey: "",
      labelsSet: new Set(this.selectedLabels)
    };
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
      release_original: row.RELEASE_DATE
    };
  }

  loadFromRows(rows = [], { sheetName } = {}) {
    this.records = rows.map((row) => this.convertRowToRecord(row));
    this.currentSheetName = sheetName || this.currentSheetName || "Sheet1";
    this.indexesDirty = true;
    this.rebuildMetaStructures();
    this.buildSortedCaches();
    this.rebuildCategories();
  }

  rebuildMetaStructures() {
    this.foldersList = new Set(["brak"]);
    this.containersList = new Set(["brak"]);
    this.folderMeta = new Map([["brak", { container: "brak" }]]);
    this.containerMeta = new Map([["brak", { folders: new Set() }]]);

    this.records.forEach((rec) => {
      const folderName = sanitizeName(rec.folder) || "brak";
      const containerName = sanitizeName(rec.container) || "brak";

      rec.folder = folderName;
      rec.container = containerName;

      this.foldersList.add(folderName);
      this.containersList.add(containerName);

      if (!this.containerMeta.has(containerName)) {
        this.containerMeta.set(containerName, { folders: new Set() });
      }
      const containerInfo = this.containerMeta.get(containerName);
      if (!containerInfo.folders) containerInfo.folders = new Set();
      if (folderName !== "brak") containerInfo.folders.add(folderName);

      if (!this.folderMeta.has(folderName)) {
        this.folderMeta.set(folderName, { container: containerName });
      }
      const folderInfo = this.folderMeta.get(folderName);
      folderInfo.container = containerName;
    });
  }

  buildSortedCaches() {
    if (!this.indexesDirty) return;
    this.sortedByRelease = [...this.records].sort(compareByReleaseDesc);
    this.sortedByAdded = [...this.records].sort(compareByAddedDesc);
    this.indexesDirty = false;
  }

  applyFilters({ dateFrom = null, dateTo = null, labels = null } = {}) {
    const dateFromTs = dateFrom ? Math.floor(dateFrom.getTime() / 1000) : null;
    const dateToTs = dateTo ? Math.floor(dateTo.getTime() / 1000) + 86399 : null;
    const labelsSet = labels ? new Set(labels) : new Set(this.selectedLabels);
    const labelsKey = Array.from(labelsSet).sort().join("|");
    const changed =
      this.activeFilters.dateFromTs !== dateFromTs ||
      this.activeFilters.dateToTs !== dateToTs ||
      this.activeFilters.labelsKey !== labelsKey;

    if (changed) {
      this.activeFilters = { dateFromTs, dateToTs, labelsKey, labelsSet };
    }
    this.selectedLabels = new Set(labelsSet);
    return changed;
  }

  rebuildCategories(filters = null) {
    if (filters) {
      this.applyFilters(filters);
    }
    if (this.indexesDirty) {
      this.rebuildMetaStructures();
      this.buildSortedCaches();
    }
   
 const { dateFromTs, dateToTs, labelsSet } = this.activeFilters;
    const allowedLabels = labelsSet || this.selectedLabels;
    const todayStart = new Date(new Date().toDateString()).getTime() / 1000;

    const categorized = { DB: [], NR: [], FD: [] };
    const folderBuckets = new Map();
    const containerBuckets = new Map();
    const folderCounts = new Map();
    const containerCounts = new Map();
    const foldersByContainer = new Map();

    const passesFilters = (album) => {
      if (allowedLabels.size && !allowedLabels.has(album.label)) return false;
      if (dateFromTs && album.release_date && album.release_date < dateFromTs) return false;
      if (dateToTs && album.release_date && album.release_date > dateToTs) return false;
      return true;
    };

      this.sortedByRelease.forEach((album) => {
      if (!passesFilters(album)) return;
      categorized.DB.push(album);
      const diffDays = album.release_date ? Math.floor((todayStart - album.release_date) / 86400) : 9999;
      if (album.release_date && diffDays >= 0 && diffDays <= 6) {
        categorized.NR.push(album);
      }
        const containerName = album.container || "brak";
      containerCounts.set(containerName, (containerCounts.get(containerName) || 0) + 1);
    });
    this.sortedByAdded.forEach((album) => {
      if (!passesFilters(album)) return;
      categorized.FD.push(album);
      const folderName = album.folder || "brak";
      const containerName = album.container || "brak";
     if (!folderBuckets.has(folderName)) folderBuckets.set(folderName, []);
      folderBuckets.get(folderName).push(album);

      if (!containerBuckets.has(containerName)) containerBuckets.set(containerName, []);
      containerBuckets.get(containerName).push(album);

     folderCounts.set(folderName, (folderCounts.get(folderName) || 0) + 1);
      containerCounts.set(containerName, (containerCounts.get(containerName) || 0) + 1);

    if (!foldersByContainer.has(containerName)) foldersByContainer.set(containerName, new Map());
      const map = foldersByContainer.get(containerName);
      map.set(folderName, (map.get(folderName) || 0) + 1);
    });

    this.categorized = categorized;
     this.filteredFolderBuckets = folderBuckets;
    this.filteredContainerBuckets = containerBuckets;
    this.cachedCounts = { folders: folderCounts, containers: containerCounts, foldersByContainer };
    return categorized;
  }

  getCategoryList(category) {
    return this.categorized[category] || [];
  }

  getPagedCategory(category, page, { folderFilter, containerFilter } = {}) {
    let list = this.getCategoryList(category);
    if (category === "FD") {
      if (folderFilter && folderFilter !== "__all__") {
        list = this.filteredFolderBuckets.get(folderFilter) || [];
      } else if (containerFilter && containerFilter !== "__all__") {
        list = this.filteredContainerBuckets.get(containerFilter) || [];
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
    if (normalizedTarget === "brak") {
      updates = { folder: "brak", container: "brak", added: "", added_ts: 0 };
    } else {
      const folderInfo = this.folderMeta.get(normalizedTarget) || this.ensureFolderEntry(normalizedTarget, "brak");
      const containerName = folderInfo.container || "brak";
      const now = new Date();
      const addedStr = formatAddedString(now);
      updates = {
        folder: normalizedTarget,
        container: containerName,
        added: addedStr,
         added_ts: now.getTime()
      };
     this.ensureContainerEntry(containerName).folders.add(normalizedTarget);
    }

    Object.assign(album, updates);
     this.indexesDirty = true;
    return updates;
  }

  syncRecord(record, updates) {
    if (!record || !updates) return;
    Object.assign(record, updates);
  }

  getFolderCounts(containerFilter) {
   if (containerFilter && containerFilter !== "__all__") {
      const scoped = this.cachedCounts.foldersByContainer.get(containerFilter) || new Map();
      return Object.fromEntries(scoped.entries());
    }
    return Object.fromEntries(this.cachedCounts.folders.entries());
  }

  getContainerCounts() {
     return Object.fromEntries(this.cachedCounts.containers.entries());
  }

  getFoldersForContainer(container) {
    if (!container || container === "__all__") return Array.from(this.foldersList);
    return Array.from(this.containerMeta.get(container)?.folders || []);
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
        RELEASE_DATE: releaseValue
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
      "RELEASE_DATE"
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
  
  ensureFolderEntry(name, container = "brak") {
    const normalized = sanitizeName(name) || "brak";
    if (!this.folderMeta.has(normalized)) {
      this.folderMeta.set(normalized, { container });
    }
    const entry = this.folderMeta.get(normalized);
    entry.container = sanitizeName(container) || entry.container || "brak";
    this.foldersList.add(normalized);
    return entry;
  }

  ensureContainerEntry(name) {
    const normalized = sanitizeName(name) || "brak";
    if (!this.containerMeta.has(normalized)) {
      this.containerMeta.set(normalized, { folders: new Set() });
    }
    const entry = this.containerMeta.get(normalized);
    if (!entry.folders) entry.folders = new Set();
    this.containersList.add(normalized);
    return entry;
  }

  getFolderColor(name) {
    const normalized = sanitizeName(name) || "brak";
    return normalized === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_FOLDER_COLOR;
  }

  getContainerColor(name) {
    const normalized = sanitizeName(name) || "brak";
    return normalized === "brak" ? DEFAULT_EMPTY_COLOR : DEFAULT_CONTAINER_COLOR;
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