import {
  DataStore,
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
       operationInProgress: false,
      fileStatusBackup: "",
      selectedLabels: store.getLabelSelection(),
      selectedSelectors: store.getSelectorSelection(),
      statusTimeout: null,
      loadRetryTimer: null
    };
    this.dom = {};
    this.renderScheduled = false;
  }

  init() {
    this.cacheDom();
    this.attachEvents();
    this.buildFilterPanel();
    this.clearFileStatus();
    this.loadInitialData();
  }

  cacheDom() {
    this.dom = {
      albumsContainer: document.getElementById("albumsContainer"),
      xlsxBtn: document.getElementById("xlsxBtn"),
      updateBtn: document.getElementById("updateBtn"),
      folderSelect: document.getElementById("folderSelect"),
      containerSelect: document.getElementById("containerSelect"),
      releaseYear: document.getElementById("releaseYear"),
      releaseMonth: document.getElementById("releaseMonth"),
      searchInput: document.getElementById("searchInput"),
      filterBtn: document.getElementById("filterBtn"),
      filterPanel: document.getElementById("filter-panel"),
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
      countNR: document.getElementById("countNR")
    };
  }

  attachEvents() {
    const {
      xlsxBtn,
      updateBtn,
      folderSelect,
      containerSelect,
      filterBtn,
      filterPanel,
      newFolderBtn,
      deleteFolderBtn,
      exportFolderBtn,
      editFolderBtn,
      modeSwitch,
      foldersRefreshBtn,
      prevBtn,
      nextBtn,
      pageSelect,
      releaseMonth,
      releaseYear,
      searchInput,
      navItems
    } = this.dom;

    xlsxBtn?.addEventListener("click", () => this.handleXlsxButton());
    updateBtn?.addEventListener("click", () => this.handleSave());

    folderSelect?.addEventListener("change", () => {
      this.uiState.currentPage = 0;
      this.markFoldersPending();
      this.processAndRender();
    });
    containerSelect?.addEventListener("change", () => {
      this.rebuildFolderSelect();
      this.uiState.currentPage = 0;
      this.markFoldersPending();
      this.processAndRender();
    });

    releaseMonth?.addEventListener("change", () => {
      this.uiState.currentPage = 0;
      this.processAndRender();
    });
    releaseYear?.addEventListener("change", () => {
      if (releaseYear.value === "__all__" && releaseMonth) {
        releaseMonth.value = "__all__";
      }
      this.uiState.currentPage = 0;
      this.processAndRender();
    });
    searchInput?.addEventListener("input", () => {
      this.uiState.currentPage = 0;
      this.processAndRender();
    });

    filterBtn?.addEventListener("click", () => this.toggleFilterPanel());

    document.addEventListener("click", (event) => {
      if (
        filterPanel &&
        filterBtn &&
        !filterPanel.contains(event.target) &&
        event.target !== filterBtn
      ) {
        this.hideFilterPanel();
      }
    });

    newFolderBtn?.addEventListener("click", () => this.handleCreateEntity());
    editFolderBtn?.addEventListener("click", () => this.handleEditEntity());
    deleteFolderBtn?.addEventListener("click", () => this.handleDeleteEntity());
    exportFolderBtn?.addEventListener("click", () => this.exportFolderToXlsx());

    modeSwitch?.addEventListener("click", () => this.toggleManagementMode());
    foldersRefreshBtn?.addEventListener("click", async () => {
    this.uiState.foldersNeedRefresh = false;
    foldersRefreshBtn.classList.remove("needs-refresh");
    this.startOperation("🔁 Przeliczanie folderów i kontenerów...");
      try {
        this.processAndRender();
      } finally {
        this.finishOperation();
      }
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

 toggleFilterPanel() {
    const { filterPanel } = this.dom;
    if (!filterPanel) return;
    filterPanel.style.display = filterPanel.style.display === "block" ? "none" : "block";
  }

  hideFilterPanel() {
    const { filterPanel } = this.dom;
    if (filterPanel) filterPanel.style.display = "none";
  }

  buildFilterPanel() {
    const { filterPanel } = this.dom;
    if (!filterPanel) return;

    if (!this.uiState.selectedLabels.size) {
      this.uiState.selectedLabels = this.store.getLabelSelection();
    }
    if (!this.uiState.selectedSelectors.size) {
      this.uiState.selectedSelectors = this.store.getSelectorSelection();
    }

    filterPanel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "filter-panel__header";

    const titleWrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = "Filtry albumów";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Zawęż wyniki według selektora lub wytwórni";
    titleWrap.appendChild(heading);
    titleWrap.appendChild(subtitle);

    const closeBtn = document.createElement("button");
    closeBtn.className = "filter-panel__close";
    closeBtn.setAttribute("aria-label", "Zamknij panel filtrów");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hideFilterPanel());

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const selectorSection = document.createElement("div");
    selectorSection.className = "filter-section";
    selectorSection.appendChild(this.createSectionTitle("Selektor"));

    const selectorGrid = document.createElement("div");
    selectorGrid.className = "filter-grid";

    ["N", "X", "F", "K"].forEach((value) => {
      selectorGrid.appendChild(
        this.createFilterChip({
          value,
          label: value,
          selectionSet: this.uiState.selectedSelectors,
          onChange: () => this.processAndRender()
        })
      );
    });

    const selectorActions = this.createActionsRow([
      {
        label: "Wszyscy selektorzy",
        handler: () => this.applyBulkSelection(selectorGrid, this.uiState.selectedSelectors, true)
      },
      {
        label: "Brak selektorów",
        handler: () => this.applyBulkSelection(selectorGrid, this.uiState.selectedSelectors, false)
      }
    ]);

    selectorSection.appendChild(selectorGrid);
    selectorSection.appendChild(selectorActions);

    const labelsSection = document.createElement("div");
    labelsSection.className = "filter-section";
    labelsSection.appendChild(this.createSectionTitle("Wytwórnia"));

    const labelsGrid = document.createElement("div");
    labelsGrid.className = "filter-grid";
    LABEL_HIERARCHY.forEach((entry) => {
      const [, name] = entry.split(" - ");
      labelsGrid.appendChild(
        this.createFilterChip({
          value: name,
          label: name,
          selectionSet: this.uiState.selectedLabels,
          onChange: () => this.processAndRender()
        })
      );
    });
    
    const labelActions = this.createActionsRow([
      {
        label: "Wszystkie wytwórnie",
        handler: () => this.applyBulkSelection(labelsGrid, this.uiState.selectedLabels, true)
      },
      {
        label: "Brak wytwórni",
        handler: () => this.applyBulkSelection(labelsGrid, this.uiState.selectedLabels, false)
      }
    ]);

    labelsSection.appendChild(labelsGrid);
    labelsSection.appendChild(labelActions);

    filterPanel.appendChild(header);
    filterPanel.appendChild(selectorSection);
    filterPanel.appendChild(labelsSection);
  }

  createSectionTitle(title) {
    const el = document.createElement("div");
    el.className = "filter-section__title";
    el.textContent = title;
    return el;
  }

  createActionsRow(actions = []) {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-actions";
    actions.forEach(({ label, handler }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => handler?.());
      wrapper.appendChild(btn);
    });
    return wrapper;
  }

  createFilterChip({ value, label, selectionSet, onChange }) {
    const wrapper = document.createElement("label");
    wrapper.className = "filter-chip";

    const text = document.createElement("span");
    text.textContent = label;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = value;
    checkbox.checked = selectionSet.has(value);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectionSet.add(value);
      else selectionSet.delete(value);
      onChange?.();
    });
    
    wrapper.appendChild(text);
    wrapper.appendChild(checkbox);
    return wrapper;
  }

  applyBulkSelection(container, targetSet, shouldSelect) {
    const inputs = container.querySelectorAll("input[type=checkbox]");
    inputs.forEach((cb) => {
      cb.checked = shouldSelect;
      if (shouldSelect) targetSet.add(cb.value);
      else targetSet.delete(cb.value);
    });
    this.processAndRender();
  }

  async loadInitialData() {
  try {
    this.startOperation("🔌 Łączenie z MySQL i wczytywanie danych...");
    await this.reloadFromDatabase(false);
    this.uiState.autoDataLoaded = true;
  } catch (error) {
    console.warn("Nie udało się pobrać danych z API:", error);
    if (!this.uiState.loadRetryTimer) {
      this.uiState.loadRetryTimer = setTimeout(() => {
        this.uiState.loadRetryTimer = null;
        this.loadInitialData();
      }, 6000);
    }
  } finally {
    this.finishOperation();
  }
  }

  async reloadFromDatabase(showFeedback = true) {
    const response = await fetchWorkbook();
    if (!response || !Array.isArray(response.records)) {
      throw new Error("API nie zwróciło poprawnej listy rekordów");
    }
    this.applyRecordsList(response.records, {
      sheetName: response.sheet_name,
      fileName: response.file_name,
      timestamp: response.updated_at || Date.now()
    });
    this.uiState.autoDataLoaded = true;
    if (showFeedback) {
      alert(`🔄 Odświeżono ${response.records.length} rekordów z bazy MySQL.`);
    }
    return response;
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

  scheduleProcessAndRender(delay = 150) {
   if (this.renderScheduled) return;
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      this.processAndRender();
    }, delay);
  }

  processAndRender() {
    const { releaseMonth, releaseYear, searchInput } = this.dom;

    const selectedYear =
      releaseYear && releaseYear.value !== "__all__" ? parseInt(releaseYear.value, 10) : null;
    const normalizedYear = Number.isInteger(selectedYear) ? selectedYear : null;
    const selectedMonth =
      normalizedYear !== null && releaseMonth && releaseMonth.value !== "__all__"
        ? parseInt(releaseMonth.value, 10)
        : null;
    const normalizedMonth = Number.isInteger(selectedMonth) ? selectedMonth : null;
    const filters = {
      releaseYear: normalizedYear,
      releaseMonth: normalizedMonth,
      searchTerm: searchInput?.value || "",
      labels: this.uiState.selectedLabels,
      selectors: this.uiState.selectedSelectors
    };
    this.store.setLabelSelection(this.uiState.selectedLabels);
    this.store.setSelectorSelection(this.uiState.selectedSelectors);
    const filtersChanged = this.store.applyFilters(filters);
    if (filtersChanged || this.store.indexesDirty) {
      this.store.rebuildCategories();
    }
    this.rebuildReleaseYearSelect();
    this.updateNavCounts();
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    if (this.uiState.currentCategory !== "FD" || !this.uiState.foldersNeedRefresh) {
      this.renderAlbumsPage();
    }
  }

  updateNavCounts() {
    const { countDB, countNR } = this.dom;
    if (countDB) countDB.textContent = `(${this.store.categorized.DB.length})`;
    if (countNR) countNR.textContent = `(${this.store.categorized.NR.length})`;
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

    const titleText = document.createElement("span");
    titleText.style.minWidth = "0";
    titleText.textContent = album.ory_copy === "C" ? `${album.title} (C)` : album.title;
    titleRow.appendChild(titleText);

    const artist = document.createElement("div");
    artist.className = "album-artist";
    artist.textContent = album.artist;

    const meta = document.createElement("div");
    meta.className = "album-meta";
    const dot = document.createElement("span");
    dot.className = "folder-dot";
    dot.classList.add(album.ory_copy === "C" ? "copy" : "original");
    dot.title = album.folder && album.folder !== "brak" ? album.folder : "Brak folderu";
    meta.appendChild(dot);

     const metaParts = [];
    if (album.release_date) {
      const d = new Date(album.release_date * 1000);
      const dateStr = `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
        .toString()
        .padStart(2, "0")}.${d.getFullYear()}`;
      metaParts.push(dateStr);
    }
    const dur = formatDuration(album.duration);
    if (dur !== "brak") metaParts.push(dur);
    metaParts.push(album.ory_copy === "C" ? "COPY" : String(album.heard ?? 0));

    metaParts.forEach((part, idx) => {
      if (idx > 0) {
        const sep = document.createElement("span");
        sep.textContent = " • ";
        meta.appendChild(sep);
      }
      const span = document.createElement("span");
      span.textContent = part;
      meta.appendChild(span);
    });

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

    card.addEventListener("click", async (event) => {
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.button === 0) {
        event.preventDefault();
        if (this.uiState.operationInProgress) return;
        const target = folderSelect?.value;
        if (target && target !== "__all__") {
          await this.performAlbumOperation("copy", () => {
          this.store.assignAlbumToFolder(album, target);
          this.markFoldersPending();
          // bez processAndRender – zajmie się tym performAlbumOperation + scheduler
          });
        } else {
          alert('Wybierz konkretny folder z listy (nie "wszystkie").');
        }
      }
    });

    card.addEventListener("contextmenu", async (event) => {
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (this.uiState.operationInProgress) return;
        if (album.folder && album.folder !== "brak") {
            await this.performAlbumOperation("remove", () => {
            this.store.assignAlbumToFolder(album, "brak");
            this.markFoldersPending();
            });
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

  rebuildReleaseYearSelect() {
    const { releaseYear } = this.dom;
    if (!releaseYear) return;

    const availableYears = this.store.getReleaseYears();
    const currentValue = releaseYear.value || "__all__";
    const desired = ["__all__", ...availableYears.map((year) => String(year))];
    const current = Array.from(releaseYear.options).map((opt) => opt.value);

    const optionsMatch =
      desired.length === current.length && desired.every((value, idx) => current[idx] === value);

    if (!optionsMatch) {
      releaseYear.innerHTML = "";
      const allOption = document.createElement("option");
      allOption.value = "__all__";
      allOption.textContent = "wszystkie lata";
      releaseYear.appendChild(allOption);
      availableYears.forEach((year) => {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = year;
        releaseYear.appendChild(option);
      });
    }

    if (desired.includes(currentValue)) {
      releaseYear.value = currentValue;
    } else {
      releaseYear.value = "__all__";
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
    const folderNames = containerFilter
      ? this.store.getFoldersForContainer(containerFilter)
      : Array.from(this.store.foldersList);
    const sorted = folderNames.sort((a, b) => a.localeCompare(b, "pl"));
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

  startOperation(message) {
    const { fileStatus } = this.dom;
    this.uiState.operationInProgress = true;
    if (fileStatus) {
      this.uiState.fileStatusBackup = fileStatus.textContent || "";
      fileStatus.textContent = message;
      fileStatus.classList.add("busy");
    }
  }

  finishOperation() {
    const { fileStatus } = this.dom;
    this.uiState.operationInProgress = false;
    if (fileStatus) {
      fileStatus.classList.remove("busy");
      this.refreshFileStatus();
      if (!fileStatus.textContent && this.uiState.fileStatusBackup) {
        fileStatus.textContent = this.uiState.fileStatusBackup;
      }
    }
    this.uiState.fileStatusBackup = "";
  }

  async performAlbumOperation(type, fn) {
  const message =
    type === "remove" ? "Trwa usuwanie albumu, proszę czekać..." : "Trwa kopiowanie albumu, proszę czekać...";
  try {
    this.startOperation(message);
    await Promise.resolve(fn());
    this.scheduleProcessAndRender();    // ← zamiast wołać render wewnątrz fn()
  } catch (err) {
    alert(err.message || err);
  } finally {
    this.finishOperation();
  }
  }

  async handleXlsxButton() {
  try {
    this.startOperation("🔄 Wczytywanie danych z MySQL...");
    await this.reloadFromDatabase(true);
  } catch (error) {
    console.error(error);
    alert(`Nie udało się odświeżyć danych z MySQL: ${error?.message || error}`);
  } finally {
    this.finishOperation();
  }
}

  async handleSave() {
  if (!this.store.records.length) {
    alert("📂 Brak danych do zapisania! Najpierw pobierz dane z MySQL.");
    return;
  }

  try {
    this.startOperation("💾 Zapisuję dane do MySQL...");

    const payload = this.store.getSerializableRecords();
    const response = await updateWorkbook(payload, this.store.currentSheetName || "Sheet1");

    if (response?.message) {
      alert(response.message);
    }

    if (response?.updated_at) {
      this.store.setFileMeta({
        name: response.file_name || this.store.currentFileName,
        timestamp: response.updated_at || Date.now()
      });
      this.refreshFileStatus();
    }

    this.flashFileUpdated();
  } catch (error) {
    alert(`❌ Nie udało się zapisać danych: ${error.message}`);
    console.error("Błąd zapisu", error);
  } finally {
    this.finishOperation();
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
        title: "Nowy kontener"
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
      this.store.ensureContainerEntry(name);
      this.rebuildContainerSelect();
      this.dom.containerSelect.value = name;
      this.rebuildFolderSelect();
      this.dom.folderSelect.value = "__all__";
      this.markFoldersPending();   // zostaje – zapala żółte "R"
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
    const container = dialog.container || "brak";
    this.store.ensureFolderEntry(name, container);
    this.store.ensureContainerEntry(container).folders.add(name);
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = name;
    this.markFoldersPending();   // tylko flaga
    alert(`Utworzono folder: ${name}`);
  }

  async handleEditEntity() {
    if (this.uiState.managementMode === "K") {
      const selected = this.dom.containerSelect?.value;
      if (!selected || selected === "__all__" || selected === "brak") {
        alert("Wybierz kontener do edycji.");
        return;
      }
      const dialog = await this.openEntityDialog({
        mode: "container",
        title: `Edytuj kontener: ${selected}`,
        defaultName: selected
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
      this.renameContainer(selected, dialog.name);
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
     this.renameFolder(selected, dialog.name, dialog.container);
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
      "HEARD",
      "ORY_COPY",
      "ADDED",
      "LABEL",
      "LINK",
      "PICTURE",
      "ARTIST",
      "TITLE",
      "DURATION",
      "RELEASE_DATE"
    ];
    const data = list.map((rec) => ({
      SELECTOR: rec.selector,
      FOLDER: rec.folder,
      KONTENER: rec.container,
      HEARD: rec.heard,
      ORY_COPY: rec.ory_copy,
      ADDED: rec.added,
      LABEL: rec.label,
      LINK: rec.link,
      PICTURE: rec.picture,
      ARTIST: rec.artist,
      TITLE: rec.title,
      DURATION: rec.duration,
      RELEASE_DATE: rec.release_original ?? rec.release_date
    }));
    const sheet = window.XLSX.utils.json_to_sheet(data, { header: headers, skipHeader: false });
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, selected.slice(0, 25));
    window.XLSX.writeFile(workbook, `folder_${selected.replace(/\s+/g, "_")}.xlsx`);
  }

  renameFolder(oldName, newName, container) {
   const result = this.store.renameFolderRecords(oldName, newName, container);
    if (result.changed) {
      this.markFoldersPending();
    }
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = newName;
  }

  renameContainer(oldName, newName) {
    const result = this.store.renameContainerRecords(oldName, newName);
    if (result.changed) {
      this.markFoldersPending();
    }
    this.rebuildContainerSelect();
    this.dom.containerSelect.value = newName;
    }
    removeFolder(name) {
    const result = this.store.clearFolderAssignments(name);
    if (result.changed) {
      this.markFoldersPending();
    }
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = "__all__";
  }

  removeContainer(name) {
   const result = this.store.clearContainerAssignments(name);
    if (result.changed) {
      this.markFoldersPending();
    }
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

  openEntityDialog({ mode = "folder", title = "", defaultName = "", defaultContainer = "brak" } = {}) {
    return new Promise((resolve) => {
      // Usuń ewentualne pozostałości poprzedniego dialogu, które mogłyby blokować focus
      document.querySelectorAll(".entity-dialog-backdrop").forEach((el) => el.remove());
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
        const containerValue = containerSelectEl ? containerSelectEl.value : undefined;
        close({ name: nameValue, container: containerValue });
      });
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close(null);
      });
      document.addEventListener("keydown", onKeyDown);
       // Użyj microtaska, by upewnić się, że focus trafia w pole nazwy natychmiast po wyrenderowaniu dialogu
      queueMicrotask(() => {
        nameInput.focus();
        nameInput.select();
      });
    });
  }

  refreshFileStatus() {
  const { fileStatus } = this.dom;
  if (!fileStatus) return;
  if (this.uiState.operationInProgress) return;

  clearTimeout(this.uiState.statusTimeout);
  this.uiState.statusTimeout = null;
  fileStatus.classList.remove("status-updated");

  const timestamp = this.store.currentFileTimestamp;
  const name = this.store.currentFileName;

  if (timestamp) {
    // Główna informacja: kiedy ostatni raz gadałeś z MySQL
    fileStatus.textContent = `MySQL – ostatnia aktualizacja: ${timestamp}`;
  } else if (name) {
    fileStatus.textContent = name;
  } else {
    fileStatus.textContent = "";
  }
  }

  flashFileUpdated() {
    const { fileStatus } = this.dom;
    if (!fileStatus) return;
    if (this.uiState.operationInProgress) return;
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