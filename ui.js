import {
  DataStore,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_CONTAINER_COLOR,
  DEFAULT_EMPTY_COLOR,
  ALBUMS_PER_PAGE,
  CATEGORY_CLASSES,
  LABEL_HIERARCHY,
  LABEL_MAP,
  formatStatusDate,
  formatDuration,
  truncateName
} from "./data.js";
import { fetchWorkbook, updateWorkbook } from "./api.js";

class UiController {
  constructor(store = new DataStore()) {
    this.store = store;
    this.uiState = {
      currentCategory: "DB",
      currentPage: 0,
      managementMode: "F",
      foldersNeedRefresh: false,
      autoDataLoaded: false,
      selectedLabels: store.getLabelSelection(),
      currentFileHandle: null,
      statusTimeout: null,
      loadRetryTimer: null
    };
    this.dom = {};
  }

  init() {
    this.cacheDom();
    this.attachEvents();
    this.buildLabelFilterPanel();
    this.clearFileStatus();
    this.loadInitialData();
  }

  cacheDom() {
    this.dom = {
      albumsContainer: document.getElementById("albumsContainer"),
      realFileInput: document.getElementById("realFileInput"),
      xlsxBtn: document.getElementById("xlsxBtn"),
      updateBtn: document.getElementById("updateBtn"),
      folderSelect: document.getElementById("folderSelect"),
      containerSelect: document.getElementById("containerSelect"),
      dateFrom: document.getElementById("dateFrom"),
      dateTo: document.getElementById("dateTo"),
      labelFilterBtn: document.getElementById("labelFilterBtn"),
      labelFilterPanel: document.getElementById("label-filter-panel"),
      newFolderBtn: document.getElementById("newFolderBtn"),
      deleteFolderBtn: document.getElementById("deleteFolderBtn"),
      exportFolderBtn: document.getElementById("exportFolderBtn"),
      editFolderBtn: document.getElementById("editFolderBtn"),
      modeSwitch: document.getElementById("modeSwitch"),
      foldersRefreshBtn: document.getElementById("foldersRefreshBtn"),
      fileStatus: document.getElementById("fileStatus"),
      navItems: Array.from(document.querySelectorAll(".nav-item")),
      prevBtn: document.getElementById("prevBtn"),
      nextBtn: document.getElementById("nextBtn"),
      pageInfo: document.getElementById("pageInfo"),
      pageSelect: document.getElementById("pageSelect"),
      countDB: document.getElementById("countDB"),
      countNR: document.getElementById("countNR"),
      countFD: document.getElementById("countFD"),
      countCS: document.getElementById("countCS")
    };
  }

  attachEvents() {
    const {
      realFileInput,
      xlsxBtn,
      updateBtn,
      folderSelect,
      containerSelect,
      dateFrom,
      dateTo,
      labelFilterBtn,
      labelFilterPanel,
      newFolderBtn,
      deleteFolderBtn,
      exportFolderBtn,
      editFolderBtn,
      modeSwitch,
      foldersRefreshBtn,
      prevBtn,
      nextBtn,
      pageSelect,
      navItems
    } = this.dom;

    xlsxBtn?.addEventListener("click", () => this.handleXlsxButton());
    realFileInput?.addEventListener("change", (ev) => this.handleFileInput(ev));
    updateBtn?.addEventListener("click", () => this.handleSave());

    folderSelect?.addEventListener("change", () => {
      this.uiState.currentPage = 0;
      this.processAndRender();
    });
    containerSelect?.addEventListener("change", () => {
      this.rebuildFolderSelect();
      this.uiState.currentPage = 0;
      this.processAndRender();
    });

    dateFrom?.addEventListener("change", () => this.processAndRender());
    dateTo?.addEventListener("change", () => this.processAndRender());

    labelFilterBtn?.addEventListener("click", () => {
      if (!labelFilterPanel) return;
      labelFilterPanel.style.display = labelFilterPanel.style.display === "block" ? "none" : "block";
    });

    document.addEventListener("click", (event) => {
      if (
        labelFilterPanel &&
        labelFilterBtn &&
        !labelFilterPanel.contains(event.target) &&
        event.target !== labelFilterBtn
      ) {
        labelFilterPanel.style.display = "none";
      }
    });

    newFolderBtn?.addEventListener("click", () => this.handleCreateEntity());
    editFolderBtn?.addEventListener("click", () => this.handleEditEntity());
    deleteFolderBtn?.addEventListener("click", () => this.handleDeleteEntity());
    exportFolderBtn?.addEventListener("click", () => this.exportFolderToXlsx());

    modeSwitch?.addEventListener("click", () => this.toggleManagementMode());
    foldersRefreshBtn?.addEventListener("click", () => {
      this.uiState.foldersNeedRefresh = false;
      foldersRefreshBtn.classList.remove("needs-refresh");
      this.processAndRender();
    });

    prevBtn?.addEventListener("click", () => {
      if (this.uiState.currentPage > 0) {
        this.uiState.currentPage -= 1;
        this.renderAlbumsPage();
      }
    });
    nextBtn?.addEventListener("click", () => {
      this.uiState.currentPage += 1;
      this.renderAlbumsPage();
    });

    pageSelect?.addEventListener("change", () => {
      this.uiState.currentPage = parseInt(pageSelect.value, 10) || 0;
      this.renderAlbumsPage();
    });

    navItems?.forEach((item) => {
      item.addEventListener("click", () => {
        const cat = item.dataset.page || "DB";
        this.renderCategory(cat);
      });
    });
  }

  buildLabelFilterPanel() {
    const { labelFilterPanel } = this.dom;
    if (!labelFilterPanel) return;
    labelFilterPanel.innerHTML = "<strong>Wybierz wytwórnie:</strong><div style=\"height:8px\"></div>";
    this.uiState.selectedLabels = new Set();
    LABEL_HIERARCHY.forEach((entry) => {
      const [, name] = entry.split(" - ");
      const id = `lblchk_${name.replace(/\s+/g, "_").replace(/[^\w\-]/g, "")}`;
      const div = document.createElement("div");
      div.style.marginBottom = "6px";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.value = name;
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.uiState.selectedLabels.add(name);
        else this.uiState.selectedLabels.delete(name);
        this.processAndRender();
      });
      const label = document.createElement("label");
      label.htmlFor = id;
      label.style.marginLeft = "6px";
      label.textContent = name;
      div.appendChild(checkbox);
      div.appendChild(label);
      labelFilterPanel.appendChild(div);
      this.uiState.selectedLabels.add(name);
    });
    const tools = document.createElement("div");
    tools.style.marginTop = "8px";
    const allBtn = document.createElement("button");
    allBtn.textContent = "Wszystkie";
    allBtn.style.marginRight = "6px";
    const noneBtn = document.createElement("button");
    noneBtn.textContent = "Brak";
    allBtn.addEventListener("click", () => {
      labelFilterPanel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = true;
        this.uiState.selectedLabels.add(cb.value);
      });
      this.processAndRender();
    });
    noneBtn.addEventListener("click", () => {
      labelFilterPanel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = false;
        this.uiState.selectedLabels.delete(cb.value);
      });
      this.processAndRender();
    });
    tools.appendChild(allBtn);
    tools.appendChild(noneBtn);
    labelFilterPanel.appendChild(tools);
  }

  async loadInitialData() {
    try {
      const response = await fetchWorkbook();
      if (response && Array.isArray(response.records)) {
        this.applyRecordsList(response.records, {
          sheetName: response.sheet_name,
          fileName: response.file_name,
          timestamp: Date.now()
        });
        this.uiState.autoDataLoaded = true;
      }
    } catch (error) {
      console.warn("Nie udało się pobrać danych z API:", error);
      if (!this.uiState.loadRetryTimer) {
        this.uiState.loadRetryTimer = setTimeout(() => {
          this.uiState.loadRetryTimer = null;
          this.loadInitialData();
        }, 6000);
      }
    }
  }

  applyRecordsList(records, meta = {}) {
    this.store.loadFromRows(records, meta);
    if (meta.fileName || meta.lastModified || meta.timestamp) {
      this.store.setFileMeta({
        name: meta.fileName,
        timestamp: meta.lastModified ? new Date(meta.lastModified) : meta.timestamp
      });
      this.refreshFileStatus();
    }
    this.processAndRender();
  }

  processAndRender() {
    const { dateFrom, dateTo } = this.dom;
    const filters = {
      dateFrom: dateFrom?.value ? new Date(dateFrom.value) : null,
      dateTo: dateTo?.value ? new Date(dateTo.value) : null,
      labels: this.uiState.selectedLabels
    };
    this.store.setLabelSelection(this.uiState.selectedLabels);
    this.store.rebuildCategories(filters);
    this.updateNavCounts();
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    if (this.uiState.currentCategory !== "FD" || !this.uiState.foldersNeedRefresh) {
      this.renderAlbumsPage();
    }
  }

  updateNavCounts() {
    const { countDB, countNR, countFD, countCS } = this.dom;
    if (countDB) countDB.textContent = `(${this.store.categorized.DB.length})`;
    if (countNR) countNR.textContent = `(${this.store.categorized.NR.length})`;
    if (countFD) countFD.textContent = `(${this.store.categorized.FD.length})`;
    if (countCS) countCS.textContent = `(${this.store.categorized.CS.length})`;
  }

  renderCategory(category) {
    this.uiState.currentCategory = category;
    this.uiState.currentPage = 0;
    document.body.classList.remove(...Object.values(CATEGORY_CLASSES));
    const className = this.store.getCategoryClass(category);
    if (className) document.body.classList.add(className);
    this.updateNavActive(category);
    if (category === "FD" && this.uiState.foldersNeedRefresh) {
      return;
    }
    this.renderAlbumsPage();
  }

  updateNavActive(category) {
    this.dom.navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.page === category);
    });
  }

  renderAlbumsPage() {
    const { folderSelect, containerSelect, albumsContainer, pageInfo, pageSelect, prevBtn, nextBtn } = this.dom;
    const folderFilter = folderSelect?.value;
    const containerFilter = containerSelect?.value;
    const { pageItems, total, totalPages, currentPage } = this.store.getPagedCategory(
      this.uiState.currentCategory,
      this.uiState.currentPage,
      { folderFilter, containerFilter }
    );

    this.uiState.currentPage = currentPage;
    if (albumsContainer) {
      albumsContainer.innerHTML = "";
      pageItems.forEach((album) => {
        const card = this.createAlbumCard(album);
        albumsContainer.appendChild(card);
      });
    }

    if (pageInfo) {
      pageInfo.textContent = totalPages ? `Strona ${currentPage + 1} z ${totalPages}` : "Strona 0 z 0";
    }

    if (pageSelect) {
      pageSelect.innerHTML = "";
      if (totalPages > 0) {
        for (let i = 0; i < totalPages; i += 1) {
          const option = document.createElement("option");
          option.value = i;
          option.textContent = i + 1;
          if (i === currentPage) option.selected = true;
          pageSelect.appendChild(option);
        }
        pageSelect.disabled = false;
      } else {
        pageSelect.disabled = true;
      }
    }

    if (prevBtn) prevBtn.disabled = currentPage <= 0;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages - 1 || totalPages === 0;
  }

  createAlbumCard(album) {
    const { folderSelect } = this.dom;
    const card = document.createElement("a");
    card.href = album.link || "#";
    card.target = "_blank";
    card.className = "album-card";
    card.title = `${album.title} — ${album.artist}`;

    const img = document.createElement("img");
    img.className = "album-cover";
    img.src = album.picture || "";
    if (album.selector === "X") img.classList.add("grayscale");

    const info = document.createElement("div");
    info.className = "album-info";
    const titleRow = document.createElement("div");
    titleRow.className = "album-title";

    if (album.folder && album.folder !== "brak") {
      const dot = document.createElement("span");
      dot.className = "folder-dot";
      dot.style.background = album.col_f || this.store.getFolderColor(album.folder);
      dot.title = album.folder;
      titleRow.appendChild(dot);
    }

    const titleText = document.createElement("span");
    titleText.style.minWidth = "0";
    titleText.textContent = album.title;
    titleRow.appendChild(titleText);

    const artist = document.createElement("div");
    artist.className = "album-artist";
    artist.textContent = album.artist;

    const meta = document.createElement("div");
    meta.className = "album-meta";
    const metaParts = [];
    if (album.release_date) {
      const d = new Date(album.release_date * 1000);
      const dateStr = `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
        .toString()
        .padStart(2, "0")}/${d.getFullYear()}`;
      metaParts.push(dateStr);
    }
    const dur = formatDuration(album.duration);
    if (dur !== "brak") metaParts.push(dur);
    meta.textContent = metaParts.length ? metaParts.join(" • ") : "brak danych";

    info.appendChild(titleRow);
    info.appendChild(artist);
    info.appendChild(meta);

    const code = LABEL_MAP.get(album.label) || "00A";
    const icon = document.createElement("img");
    icon.className = "album-label-icon";
    icon.src = `${code}.svg`;
    icon.alt = album.label;
    icon.title = album.label;
    icon.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cycleSelector(album, img, card);
    });

    card.addEventListener("mouseenter", () => {
      if (album.selector === "X") img.classList.remove("grayscale");
    });
    card.addEventListener("mouseleave", () => {
      if (album.selector === "X") img.classList.add("grayscale");
    });

    this.applySelectorColorToCard(card, album.selector);

    card.addEventListener("click", (event) => {
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.button === 0) {
        event.preventDefault();
        const target = folderSelect?.value;
        if (target && target !== "__all__") {
          try {
            this.store.assignAlbumToFolder(album, target);
            this.markFoldersPending();
            this.processAndRender();
          } catch (err) {
            alert(err.message);
          }
        } else {
          alert('Wybierz konkretny folder z listy (nie "wszystkie").');
        }
      }
    });

    card.addEventListener("contextmenu", (event) => {
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (album.folder && album.folder !== "brak") {
          this.store.assignAlbumToFolder(album, "brak");
          this.markFoldersPending();
          this.processAndRender();
        }
      }
    });

    card.appendChild(img);
    card.appendChild(info);
    card.appendChild(icon);
    return card;
  }

  cycleSelector(album, image, card) {
    const selectors = ["N", "X", "F", "K"];
    const current = album.selector || "N";
    const idx = selectors.indexOf(current);
    const next = selectors[(idx + 1) % selectors.length];
    album.selector = next;
    this.store.updateSelector(album, next);
    if (next === "X") image.classList.add("grayscale");
    else image.classList.remove("grayscale");
    this.applySelectorColorToCard(card, next);
  }

  applySelectorColorToCard(card, selector) {
    if (!card) return;
    if (selector === "X") {
      card.style.setProperty("--card-border-color", "rgba(150,150,150,0.6)");
      card.style.setProperty("--card-hover-color", "rgba(150,150,150,1)");
      card.style.setProperty("--album-info-bg", "#f7f7f7");
    } else if (selector === "F") {
      card.style.setProperty("--card-border-color", "rgba(30, 136, 229, 0.45)");
      card.style.setProperty("--card-hover-color", "rgba(30, 136, 229, 0.85)");
      card.style.setProperty("--album-info-bg", "#e3f2fd");
    } else if (selector === "K") {
      card.style.setProperty("--card-border-color", "rgba(67, 160, 71, 0.45)");
      card.style.setProperty("--card-hover-color", "rgba(67, 160, 71, 0.85)");
      card.style.setProperty("--album-info-bg", "#e8f5e9");
    } else {
      card.style.setProperty("--card-border-color", "rgba(200,0,0,0.25)");
      card.style.setProperty("--card-hover-color", "rgba(200,0,0,1)");
      card.style.setProperty("--album-info-bg", "#fff");
    }
  }

  rebuildContainerSelect() {
    const { containerSelect } = this.dom;
    if (!containerSelect) return;
    const selected = containerSelect.value;
    containerSelect.innerHTML = "";
    const counts = this.store.getContainerCounts();
    const sorted = Array.from(this.store.containersList).sort((a, b) => a.localeCompare(b, "pl"));
    const createOption = (value, label, color) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${label} (${counts[value] || 0})`;
      option.style.color = color;
      return option;
    };
    containerSelect.appendChild(createOption("__all__", "wszystkie kontenery", "#1e1e1e"));
    sorted.forEach((name) => {
      const color = this.store.getContainerColor(name);
      const option = createOption(name, truncateName(name, 32), color);
      option.title = name;
      containerSelect.appendChild(option);
    });
    if (selected && Array.from(containerSelect.options).some((opt) => opt.value === selected)) {
      containerSelect.value = selected;
    } else {
      containerSelect.value = "__all__";
    }
  }

  rebuildFolderSelect() {
    const { folderSelect, containerSelect } = this.dom;
    if (!folderSelect) return;
    const selected = folderSelect.value;
    folderSelect.innerHTML = "";
    const containerFilter = containerSelect?.value && containerSelect.value !== "__all__" ? containerSelect.value : null;
    const counts = this.store.getFolderCounts(containerFilter);
    const sorted = Array.from(this.store.foldersList).sort((a, b) => a.localeCompare(b, "pl"));
    const createOption = (value, label, color) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${label} (${counts[value] || 0})`;
      option.style.color = color;
      return option;
    };
    folderSelect.appendChild(createOption("__all__", "wszystkie", "#1e1e1e"));
    sorted.forEach((name) => {
      const color = this.store.getFolderColor(name);
      const option = createOption(name, truncateName(name, 32), color);
      option.title = name;
      folderSelect.appendChild(option);
    });
    if (selected && Array.from(folderSelect.options).some((opt) => opt.value === selected)) {
      folderSelect.value = selected;
    } else {
      folderSelect.value = "__all__";
    }
  }

  markFoldersPending() {
    const { foldersRefreshBtn } = this.dom;
    this.uiState.foldersNeedRefresh = true;
    foldersRefreshBtn?.classList.add("needs-refresh");
  }

  clearFoldersPending() {
    const { foldersRefreshBtn } = this.dom;
    this.uiState.foldersNeedRefresh = false;
    foldersRefreshBtn?.classList.remove("needs-refresh");
  }

  async handleXlsxButton() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "Pliki Excel",
              accept: {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
              }
            }
          ]
        });
        if (!handle) return;
        this.uiState.currentFileHandle = handle;
        const file = await handle.getFile();
        this.store.setFileMeta({
          name: handle.name || file.name || "data.xlsx",
          timestamp: new Date(file.lastModified || Date.now())
        });
        this.refreshFileStatus();
        await this.loadWorkbookFromFile(file);
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.error(error);
        alert(`Nie udało się wczytać pliku XLSX: ${error?.message || error}`);
      }
    } else {
      this.dom.realFileInput?.click();
    }
  }

  async handleFileInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.uiState.currentFileHandle = null;
    this.store.setFileMeta({
      name: file.name || "data.xlsx",
      timestamp: new Date(file.lastModified || Date.now())
    });
    this.refreshFileStatus();
    await this.loadWorkbookFromFile(file);
    event.target.value = "";
  }

  async loadWorkbookFromFile(file) {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0] || "Sheet1";
      const sheet = workbook.Sheets[sheetName];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
      this.store.loadFromRows(rows, { sheetName });
      this.processAndRender();
      alert(`✅ Załadowano ${this.store.records.length} rekordów z pliku XLSX`);
    } catch (err) {
      console.error(err);
      alert(`❌ Wystąpił problem podczas wczytywania pliku XLSX: ${err?.message || err}`);
    }
  }

  async handleSave() {
    if (!this.store.records.length) {
      alert("📂 Brak danych do zapisania! Najpierw wczytaj plik XLSX.");
      return;
    }
    try {
      const payload = this.store.getSerializableRecords();
      const response = await updateWorkbook(payload, this.store.currentSheetName || "Sheet1");
      const message = response.message || "✅ Dane zapisane poprawnie.";
      alert(message);
      this.flashFileUpdated();
    } catch (error) {
      alert(`❌ Nie udało się zapisać danych: ${error.message}`);
      console.error("Błąd zapisu", error);
    }
  }

  toggleManagementMode() {
    const { modeSwitch } = this.dom;
    this.uiState.managementMode = this.uiState.managementMode === "F" ? "K" : "F";
    if (modeSwitch) {
      modeSwitch.textContent = this.uiState.managementMode;
      modeSwitch.classList.toggle("mode-k", this.uiState.managementMode === "K");
    }
  }

  getCustomFolderCount() {
    let count = 0;
    this.store.foldersList.forEach((name) => {
      if (name !== "brak") count += 1;
    });
    return count;
  }

  getCustomContainerCount() {
    let count = 0;
    this.store.containersList.forEach((name) => {
      if (name !== "brak") count += 1;
    });
    return count;
  }

  async handleCreateEntity() {
    if (this.uiState.managementMode === "K") {
      if (this.getCustomContainerCount() >= 1000) {
        alert("Osiągnięto limit 1000 kontenerów. Usuń istniejący, aby dodać nowy.");
        return;
      }
      const dialog = await this.openEntityDialog({
        mode: "container",
        title: "Nowy kontener",
        defaultColor: DEFAULT_CONTAINER_COLOR
      });
      if (!dialog) return;
      const name = dialog.name;
      if (!this.isValidEntityName(name)) {
        alert("Nieprawidłowa nazwa kontenera. Dozwolone maks. 50 znaków (w tym spacje).");
        return;
      }
      if (this.store.containersList.has(name)) {
        alert("Kontener o takiej nazwie już istnieje.");
        return;
      }
      const color = dialog.color || DEFAULT_CONTAINER_COLOR;
      const entry = this.store.ensureContainerEntry(name);
      entry.color = color;
      this.rebuildContainerSelect();
      this.dom.containerSelect.value = name;
      this.rebuildFolderSelect();
      this.dom.folderSelect.value = "__all__";
      this.markFoldersPending();
      this.processAndRender();
      alert(`Utworzono kontener: ${name}`);
      return;
    }

    if (this.getCustomFolderCount() >= 1000) {
      alert("Osiągnięto limit 1000 folderów. Usuń istniejący folder, aby dodać nowy.");
      return;
    }
    const suggestedContainer =
      this.dom.containerSelect?.value && this.dom.containerSelect.value !== "__all__"
        ? this.dom.containerSelect.value
        : "brak";
    const dialog = await this.openEntityDialog({
      mode: "folder",
      title: "Nowy folder",
      defaultColor: DEFAULT_FOLDER_COLOR,
      defaultContainer: suggestedContainer
    });
    if (!dialog) return;
    const name = dialog.name;
    if (!this.isValidEntityName(name)) {
      alert("Nieprawidłowa nazwa folderu. Dozwolone maks. 50 znaków (w tym spacje).");
      return;
    }
    if (this.store.foldersList.has(name)) {
      alert("Folder o takiej nazwie już istnieje.");
      return;
    }
    const color = dialog.color || DEFAULT_FOLDER_COLOR;
    const container = dialog.container || "brak";
    const entry = this.store.ensureFolderEntry(name, container);
    entry.color = color;
    this.store.ensureContainerEntry(container).folders.add(name);
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = name;
    this.markFoldersPending();
    this.processAndRender();
    alert(`Utworzono folder: ${name}`);
  }

  async handleEditEntity() {
    if (this.uiState.managementMode === "K") {
      const selected = this.dom.containerSelect?.value;
      if (!selected || selected === "__all__" || selected === "brak") {
        alert("Wybierz kontener do edycji.");
        return;
      }
      const entry = this.store.ensureContainerEntry(selected);
      const dialog = await this.openEntityDialog({
        mode: "container",
        title: `Edytuj kontener: ${selected}`,
        defaultName: selected,
        defaultColor: entry.color
      });
      if (!dialog) return;
      if (!this.isValidEntityName(dialog.name)) {
        alert("Nieprawidłowa nazwa kontenera.");
        return;
      }
      if (dialog.name !== selected && this.store.containersList.has(dialog.name)) {
        alert("Kontener o takiej nazwie już istnieje.");
        return;
      }
      this.renameContainer(selected, dialog.name, dialog.color);
      this.processAndRender();
      alert("Zaktualizowano kontener.");
      return;
    }

    const selected = this.dom.folderSelect?.value;
    if (!selected || selected === "__all__") {
      alert("Wybierz folder do edycji.");
      return;
    }
    const entry = this.store.ensureFolderEntry(selected, "brak");
    const dialog = await this.openEntityDialog({
      mode: "folder",
      title: `Edytuj folder: ${selected}`,
      defaultName: selected,
      defaultColor: entry.color,
      defaultContainer: entry.container
    });
    if (!dialog) return;
    if (!this.isValidEntityName(dialog.name)) {
      alert("Nieprawidłowa nazwa folderu.");
      return;
    }
    if (dialog.name !== selected && this.store.foldersList.has(dialog.name)) {
      alert("Folder o takiej nazwie już istnieje.");
      return;
    }
    this.renameFolder(selected, dialog.name, dialog.color, dialog.container);
    this.processAndRender();
    alert("Zaktualizowano folder.");
  }

  async handleDeleteEntity() {
    if (this.uiState.managementMode === "K") {
      const selected = this.dom.containerSelect?.value;
      if (!selected || selected === "__all__" || selected === "brak") {
        alert("Wybierz kontener do usunięcia.");
        return;
      }
      if (!confirm(`Czy na pewno usunąć kontener "${selected}"?`)) return;
      this.removeContainer(selected);
      this.processAndRender();
      alert("Kontener usunięty.");
      return;
    }

    const selected = this.dom.folderSelect?.value;
    if (!selected || selected === "__all__") {
      alert("Wybierz folder do usunięcia.");
      return;
    }
    if (!confirm(`Czy na pewno usunąć folder "${selected}"?`)) return;
    this.removeFolder(selected);
    this.processAndRender();
    alert("Folder usunięty.");
  }

  exportFolderToXlsx() {
    const selected = this.dom.folderSelect?.value;
    if (!selected || selected === "__all__") {
      alert("Wybierz konkretny folder do eksportu.");
      return;
    }
    const list = this.store.records.filter((record) => (record.folder || "brak") === selected);
    if (!list.length) {
      alert("Wybrany folder jest pusty.");
      return;
    }
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
    const data = list.map((rec) => ({
      SELECTOR: rec.selector,
      FOLDER: rec.folder,
      KONTENER: rec.container,
      ADDED: rec.added,
      LABEL: rec.label,
      LINK: rec.link,
      PICTURE: rec.picture,
      ARTIST: rec.artist,
      TITLE: rec.title,
      DURATION: rec.duration,
      RELEASE_DATE: rec.release_original ?? rec.release_date,
      Col_K: rec.col_k,
      Col_F: rec.col_f
    }));
    const sheet = window.XLSX.utils.json_to_sheet(data, { header: headers, skipHeader: false });
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, selected.slice(0, 25));
    window.XLSX.writeFile(workbook, `folder_${selected.replace(/\s+/g, "_")}.xlsx`);
  }

  renameFolder(oldName, newName, color, container) {
    const currentMeta = this.store.folderMeta.get(oldName);
    const prevContainer = currentMeta?.container || "brak";
    const normalizedContainer = container || "brak";
    const colorChanged = color !== this.store.getFolderColor(oldName);
    const nameChanged = oldName !== newName;
    const containerChanged = prevContainer !== normalizedContainer;
    if (!colorChanged && !nameChanged && !containerChanged) {
      return;
    }

    this.store.foldersList.delete(oldName);
    this.store.folderMeta.delete(oldName);
    this.store.containerMeta.forEach((value) => value.folders?.delete(oldName));

    const entry = this.store.ensureFolderEntry(newName, normalizedContainer);
    entry.color = color;
    const containerEntry = this.store.ensureContainerEntry(normalizedContainer);
    containerEntry.folders.add(newName);

    this.store.records.forEach((record) => {
      if ((record.folder || "brak") === oldName) {
        record.folder = newName;
        record.col_f = color;
        record.container = normalizedContainer;
        record.col_k = this.store.getContainerColor(normalizedContainer);
      }
    });

    this.store.foldersList.add(newName);
    this.markFoldersPending();
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = newName;
  }

  renameContainer(oldName, newName, color) {
    if (oldName === newName && color === this.store.getContainerColor(oldName)) return;
    const folders = this.store.containerMeta.get(oldName)?.folders || new Set();
    this.store.containersList.delete(oldName);
    this.store.containerMeta.delete(oldName);
    this.store.containerMeta.forEach((value) => value.folders?.delete(oldName));

    const entry = this.store.ensureContainerEntry(newName);
    entry.color = color;
    entry.folders = new Set([...folders]);

    this.store.records.forEach((record) => {
      if ((record.container || "brak") === oldName) {
        record.container = newName;
        record.col_k = color;
      }
    });

    this.store.folderMeta.forEach((folderInfo) => {
      if (folderInfo.container === oldName) {
        folderInfo.container = newName;
      }
    });

    this.store.containersList.add(newName);
    this.rebuildContainerSelect();
    this.dom.containerSelect.value = newName;
  }

  removeFolder(name) {
    this.store.foldersList.delete(name);
    this.store.folderMeta.delete(name);
    this.store.containerMeta.forEach((value) => value.folders?.delete(name));
    this.store.records.forEach((record) => {
      if (record.folder === name) {
        record.folder = "brak";
        record.col_f = DEFAULT_EMPTY_COLOR;
        record.container = "brak";
        record.col_k = this.store.getContainerColor("brak");
      }
    });
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = "__all__";
    this.markFoldersPending();
  }

  removeContainer(name) {
    this.store.containersList.delete(name);
    const foldersToUpdate = this.store.containerMeta.get(name)?.folders || new Set();
    foldersToUpdate.forEach((folder) => {
      const entry = this.store.folderMeta.get(folder);
      if (entry) entry.container = "brak";
    });
    this.store.containerMeta.delete(name);
    this.store.records.forEach((record) => {
      if (record.container === name) {
        record.container = "brak";
        record.col_k = DEFAULT_EMPTY_COLOR;
      }
    });
    this.rebuildContainerSelect();
    this.dom.containerSelect.value = "__all__";
  }

  isValidEntityName(name) {
    if (typeof name !== "string") return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (trimmed.length > 50) return false;
    return true;
  }

  openEntityDialog({ mode = "folder", title = "", defaultName = "", defaultColor, defaultContainer = "brak" } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "entity-dialog-backdrop";

      const dialog = document.createElement("div");
      dialog.className = "entity-dialog";
      const heading = document.createElement("h3");
      heading.textContent = title;
      dialog.appendChild(heading);

      const nameLabel = document.createElement("label");
      nameLabel.textContent = mode === "folder" ? "Nazwa folderu" : "Nazwa kontenera";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = defaultName || "";
      nameInput.placeholder = mode === "folder" ? "np. Moje ulubione" : "np. Kontener A";
      dialog.appendChild(nameLabel);
      dialog.appendChild(nameInput);

      const colorLabel = document.createElement("label");
      colorLabel.textContent = "Kolor";
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = defaultColor || (mode === "folder" ? DEFAULT_FOLDER_COLOR : DEFAULT_CONTAINER_COLOR);
      dialog.appendChild(colorLabel);
      dialog.appendChild(colorInput);

      let containerSelectEl = null;
      if (mode === "folder") {
        const containerLabel = document.createElement("label");
        containerLabel.textContent = "Kontener";
        containerSelectEl = document.createElement("select");
        Array.from(this.store.containersList)
          .sort((a, b) => a.localeCompare(b, "pl"))
          .forEach((container) => {
            const option = document.createElement("option");
            option.value = container;
            option.textContent = container;
            if (container === defaultContainer) option.selected = true;
            containerSelectEl.appendChild(option);
          });
        dialog.appendChild(containerLabel);
        dialog.appendChild(containerSelectEl);
      }

      const info = document.createElement("small");
      info.textContent = "SHIFT + klik na karcie przypisuje album do wybranego folderu.";
      dialog.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "entity-dialog-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "cancel";
      cancelBtn.textContent = "Anuluj";
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "confirm";
      confirmBtn.textContent = "Zapisz";
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      dialog.appendChild(actions);

      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const close = (result) => {
        document.body.removeChild(backdrop);
        document.removeEventListener("keydown", onKeyDown);
        resolve(result);
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(null);
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          confirmBtn.click();
        }
      };

      cancelBtn.addEventListener("click", () => close(null));
      confirmBtn.addEventListener("click", () => {
        const nameValue = nameInput.value.trim();
        const colorValue = colorInput.value;
        const containerValue = containerSelectEl ? containerSelectEl.value : undefined;
        close({ name: nameValue, color: colorValue, container: containerValue });
      });
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close(null);
      });
      document.addEventListener("keydown", onKeyDown);
      nameInput.focus();
      nameInput.select();
    });
  }

  refreshFileStatus() {
    const { fileStatus } = this.dom;
    if (!fileStatus) return;
    clearTimeout(this.uiState.statusTimeout);
    this.uiState.statusTimeout = null;
    fileStatus.classList.remove("status-updated");
    const timestamp = this.store.currentFileTimestamp;
    const name = this.store.currentFileName;
    fileStatus.textContent = name ? (timestamp ? `${name} ${timestamp}` : name) : "";
  }

  flashFileUpdated() {
    const { fileStatus } = this.dom;
    if (!fileStatus) return;
    clearTimeout(this.uiState.statusTimeout);
    fileStatus.classList.add("status-updated");
    fileStatus.textContent = "ZAKTUALIZOWANO";
    this.uiState.statusTimeout = setTimeout(() => {
      fileStatus.classList.remove("status-updated");
      this.refreshFileStatus();
    }, 2000);
  }

  clearFileStatus() {
    const { fileStatus } = this.dom;
    if (!fileStatus) return;
    clearTimeout(this.uiState.statusTimeout);
    this.uiState.statusTimeout = null;
    fileStatus.classList.remove("status-updated");
    fileStatus.textContent = "";
  }
}

export { UiController };