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
import {
  fetchWorkbook,
  updateWorkbook,
  exportWorkbookToFile,
  importWorkbookFromFile,
  importNewsWorkbookFromFile,
  selectDirectory,
  selectFile,
  getAppDirectory,
  resolveImportFile,
  backupDatabase,
  saveBinaryFile,
  saveTextFile,
  fetchFilterPresets,
  saveFilterPreset,
  renameFilterPreset,
  deleteFilterPreset
} from "./api.js";

const DATA_DIRECTORIES = {
  importDb: ["DATABASE", "MUSIC_DATABASE"],
  updateDb: ["DATABASE", "UPDATE_DATABASE"],
  exportDb: ["DATABASE", "EXPORT_DATABASE"],
  download: ["DATABASE", "EXPORT_DATABASE"]
};

const DATA_PREFIXES = {
  importDb: "music_database",
  updateDb: "update_database"
};

function buildPath(base, ...segments) {
  const normalize = (value) => String(value || "").replace(/[\\/]+$/, "");
  let result = normalize(base);
  segments.forEach((segment) => {
    const cleaned = String(segment || "").replace(/^\\+|^\/+/g, "");
    if (!cleaned) return;
    if (result && !/[\\/]$/.test(result)) {
      result += "/";
    }
    result += cleaned;
  });
  return result;
}

const SELECTOR_LABELS = {
  N: "NIEWYSŁUCHANY",
  X: "SPRAWDZONY",
  F: "PROPOZYCJA",
  K: "WYSŁUCHANY"
};

const SELECTOR_VALUES = Object.keys(SELECTOR_LABELS);

function truncateForStatus(name, maxLength = 15) {
  if (!name) return "";
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength)}...`;
}

class UiController {
  constructor(store = new DataStore()) {
    this.store = store;
    this.uiState = {
      currentCategory: "DB",
      currentPage: 0,
      pageByCategory: { DB: 0, FD: 0, NR: 0 },
      activeFilterTab: "label",
      foldersNeedRefresh: false,
      foldersRefreshMode: "AUTO",
      autoDataLoaded: false,
      dataPaths: {
        importDb: { mode: "AUTO", manualDirectory: "" },
        updateDb: { mode: "AUTO", manualDirectory: "" },
        exportDb: { mode: "AUTO", manualDirectory: "" },
        download: { mode: "AUTO", manualDirectory: "" }
      },
      appDirectory: "",
      operationInProgress: false,
      fileStatusBackup: "",
      selectedLabels: store.getLabelSelection(),
      selectedSelectors: store.getSelectorSelection(),
      heardRange: { min: null, max: null },
      sortMode: "release_desc",
      durationRange: { min: null, max: null },
      statusTimeout: null,
      pendingStatusMessage: "",
      loadRetryTimer: null,
      updateDbLinks: new Set(),
      filterPresets: [],
      activeFilterPreset: "__none__",
      storedFilterPreset: "__none__",
      storedFilterPresetApplied: false,
      skipFolderFiltering: true,
      lastSkipFolderFiltering: false,
      showAlbumId: false,
      activeCollection: "__all__",
      activeOptionsTab: "operations",
      operationsScope: "folders",
      showFavorites: true,
      showFavoriteCorners: true,
      autoFilterFolder: false,
      storedSelections: this.readStoredSelections(),
      storedSelectionsApplied: false,
      keyModifiers: {
        favorite: false,
        copy: false,
        delete: false
      }
    };
    this.dom = {};
    this.renderScheduled = false;
    this.progressInterval = null;
    this.progressValue = 0;
  }

  init() {
    this.cacheDom();
    this.uiState.storedFilterPreset = this.readStoredFilterPreset();
    this.buildFilterPanel();
    this.buildOptionsPanel();
    this.updateAllDataDirectoryHints();
    this.bootstrapDataPaths();
    this.loadFilterPresets();
    this.attachEvents();
    this.clearFileStatus();
    this.loadInitialData();
  }

  cacheDom() {
    this.dom = {
      albumsContainer: document.getElementById("albumsContainer"),
      updateBtn: document.getElementById("updateBtn"),
      folderSelect: document.getElementById("folderSelect"),
      containerSelect: document.getElementById("containerSelect"),
      releaseYearFrom: null,
      releaseMonthFrom: null,
      releaseYearTo: null,
      releaseMonthTo: null,
      releaseYearFromControl: null,
      releaseYearToControl: null,
      searchInput: null,
      filterBtn: document.getElementById("filterBtn"),
      filterBtnDot: document.querySelector("#filterBtn .menu-chip__dot"),
      filterClearBtn: document.getElementById("filterClearBtn"),
      optionsBtn: document.getElementById("optionsBtn"),
      filterPanel: document.getElementById("filter-panel"),
      optionsPanel: document.getElementById("options-panel"),
      collectionSelect: document.getElementById("collectionSelect"),
      addEntityBtn: document.getElementById("addEntityBtn"),
      editEntityBtn: document.getElementById("editEntityBtn"),
      deleteEntityBtn: document.getElementById("deleteEntityBtn"),
      operationsScopeInputs: {},
      foldersRefreshBtn: document.getElementById("foldersRefreshBtn"),
      appRefreshBtn: document.getElementById("appRefreshBtn"),
      foldersRefreshModeInput: null,
      foldersRefreshModeLabels: null,
      fileStatus: document.getElementById("fileStatus"),
      navItems: Array.from(document.querySelectorAll(".nav-item")),
      pageInfo: document.getElementById("pageInfo"),
      countDB: document.getElementById("countDB"),
      newCounter: document.getElementById("newCounter"),
      originalCounter: document.getElementById("originalCounter"),
      copyCounter: document.getElementById("copyCounter"),
      progressContainer: document.getElementById("progressContainer"),
      progressFill: document.querySelector(".progress-fill"),
      progressLabel: document.getElementById("progressLabel"),
      pagination: document.querySelector(".pagination"),
      dataModeToggle: null,
      dataModeLabels: null,
      dataDirectoryHint: null,
      downloadDbBtn: null,
      downloadTxtBtn: null,
      importDbBtn: null,
      exportDbBtn: null,
      updateDbBtn: null,
      heardMinDisplay: null,
      heardMinLeftBtn: null,
      heardMinRightBtn: null,
      heardMaxDisplay: null,
      heardMaxLeftBtn: null,
      heardMaxRightBtn: null,
      sortDurationAscBtn: null,
      sortDurationDescBtn: null,
      sortReleaseAscBtn: null,
      sortReleaseDescBtn: null,
      durationRangeMinInput: null,
      durationRangeMaxInput: null,
      filterPresetSelect: null,
      filterPresetSaveBtn: null,
      filterPresetEditBtn: null,
      filterPresetDeleteBtn: null,
      skipFolderFilteringInput: null,
      skipFolderFilteringLabels: null,
      showFavoritesInput: null,
      showFavoriteCornersInput: null,
      showFavoriteCornersLabels: null,
      autoFilterFolderInput: null,
      autoFilterFolderLabels: null,
      dataModeToggles: {},
      dataModeLabels: {},
      dataDirectoryHints: {}
    };
  }

  attachEvents() {
    const {
      updateBtn,
      folderSelect,
      containerSelect,
      filterBtn,
      filterClearBtn,
      optionsBtn,
      filterPanel,
      optionsPanel,
      collectionSelect,
      addEntityBtn,
      editEntityBtn,
      deleteEntityBtn,
      foldersRefreshBtn,
      appRefreshBtn,
      foldersRefreshModeInput,
      foldersRefreshModeLabels,
      downloadDbBtn,
      downloadTxtBtn,
      importDbBtn,
      updateDbBtn,
      exportDbBtn,
      searchInput,
      navItems,
      pagination
    } = this.dom;

    updateBtn?.addEventListener("click", () => this.handleSave());
    appRefreshBtn?.addEventListener("click", () => {
      window.location.reload();
    });
    downloadDbBtn?.addEventListener("click", () => this.exportFilteredSelection());
    downloadTxtBtn?.addEventListener("click", () => this.exportFilteredLinks());

    folderSelect?.addEventListener("change", () => {
      this.markFoldersPending();
      this.processAndRender();
    });
    containerSelect?.addEventListener("change", () => {
      this.rebuildFolderSelect();
      this.markFoldersPending();
      this.processAndRender();
    });

    searchInput?.addEventListener("input", () => {
      this.resetCurrentPage();
      this.processAndRender();
    });

    filterBtn?.addEventListener("click", () => this.toggleFilterPanel());
    filterClearBtn?.addEventListener("click", () => this.clearAllFilters());
    optionsBtn?.addEventListener("click", () => this.toggleOptionsPanel());

    document.addEventListener("click", (event) => {
      if (event.target.closest(".modal-overlay")) return;
      if (
        filterPanel &&
        filterBtn &&
        !filterPanel.contains(event.target) &&
        event.target !== filterBtn
      ) {
        this.hideFilterPanel();
      }
      if (
        optionsPanel &&
        optionsBtn &&
        !optionsPanel.contains(event.target) &&
        event.target !== optionsBtn
      ) {
        this.hideOptionsPanel();
      }
    });

    collectionSelect?.addEventListener("change", () => {
      this.handleCollectionChange(collectionSelect.value);
    });
    addEntityBtn?.addEventListener("click", () => {
      this.flashOptionButton(addEntityBtn);
      this.handleEntityAction("add");
    });
    editEntityBtn?.addEventListener("click", () => {
      this.flashOptionButton(editEntityBtn);
      this.handleEntityAction("edit");
    });
    deleteEntityBtn?.addEventListener("click", () => {
      this.flashOptionButton(deleteEntityBtn);
      this.handleEntityAction("delete");
    });

    importDbBtn?.addEventListener("click", () => {
      this.flashOptionButton(importDbBtn);
      this.importFromXlsx();
    });

    exportDbBtn?.addEventListener("click", () => {
      this.flashOptionButton(exportDbBtn);
      this.exportToXlsx();
    });

    updateDbBtn?.addEventListener("click", () => {
      this.flashOptionButton(updateDbBtn);
      this.importNewsFromXlsx();
    });

    Object.entries(this.dom.dataModeToggles || {}).forEach(([operationKey, input]) => {
      input?.addEventListener("change", () => this.handleDataModeToggle(operationKey));
    });

    Object.values(this.dom.operationsScopeInputs || {}).forEach((input) => {
      input?.addEventListener("change", () => this.handleOperationsScopeChange(input.value));
    });
    foldersRefreshBtn?.addEventListener("click", async () => {
      await this.refreshFoldersView();
    });

    pagination?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button || button.disabled) return;
      const destination = button.dataset.page;
      const totalPages = Number(this.dom.pagination?.dataset.totalpages || 0);
      if (destination === "first") {
        this.setCurrentPage(0);
        this.renderAlbumsPage();
      } else if (destination === "prev") {
        if (this.uiState.currentPage > 0) {
          this.setCurrentPage(this.uiState.currentPage - 1);
          this.renderAlbumsPage();
        }
      } else if (destination === "next") {
        this.setCurrentPage(this.uiState.currentPage + 1);
        this.renderAlbumsPage();
      } else if (destination === "last" && totalPages > 0) {
        this.setCurrentPage(totalPages - 1);
        this.renderAlbumsPage();
      }
    });

    pagination?.addEventListener("change", (event) => {
      const select = event.target.closest(".pagination__pages");
      if (!select) return;
      const pageNumber = parseInt(select.value, 10);
      if (!Number.isNaN(pageNumber)) {
        this.setCurrentPage(pageNumber);
        this.renderAlbumsPage();
      }
    });

    navItems?.forEach((item) => {
      item.addEventListener("click", () => {
        const cat = item.dataset.page || "DB";
        this.renderCategory(cat);
      });
    });

    const shouldIgnoreKeyEvent = (event) => {
      const target = event.target;
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest?.(".modal-card")
      );
    };

    document.addEventListener("keydown", (event) => {
      if (shouldIgnoreKeyEvent(event)) return;
      const key = event.key.toLowerCase();
      if (key === "f") {
        this.uiState.keyModifiers.favorite = true;
      } else if (key === "c") {
        this.uiState.keyModifiers.copy = true;
      } else if (key === "d") {
        this.uiState.keyModifiers.delete = true;
      }
    });

    document.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      if (key === "f") {
        this.uiState.keyModifiers.favorite = false;
      } else if (key === "c") {
        this.uiState.keyModifiers.copy = false;
      } else if (key === "d") {
        this.uiState.keyModifiers.delete = false;
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "i") return;
      if (this.uiState.showAlbumId) return;
      this.uiState.showAlbumId = true;
      document.body.classList.add("show-album-id");
    });

    document.addEventListener("keyup", (event) => {
      if (event.key.toLowerCase() !== "i") return;
      this.uiState.showAlbumId = false;
      document.body.classList.remove("show-album-id");
    });
  }

  toggleFilterPanel() {
    const { filterPanel } = this.dom;
    if (!filterPanel) return;
    const shouldOpen = filterPanel.style.display !== "block";
    if (shouldOpen) {
      filterPanel.style.visibility = "hidden";
      filterPanel.style.display = "block";
      this.hideOptionsPanel();
      this.syncFilterPanelWidth();
      filterPanel.style.visibility = "";
    } else {
      filterPanel.style.display = "none";
    }
  }

  hideFilterPanel() {
    const { filterPanel } = this.dom;
    if (filterPanel) filterPanel.style.display = "none";
  }

  syncFilterPanelWidth() {
    const { filterPanel } = this.dom;
    if (!filterPanel || !this.activateFilterTab) return;
    const previousTab = this.uiState.activeFilterTab;
    this.activateFilterTab("label");
    const width = Math.ceil(filterPanel.getBoundingClientRect().width);
    if (width) {
      filterPanel.style.width = `${width}px`;
    }
    this.activateFilterTab(previousTab);
  }

  toggleOptionsPanel() {
    const { optionsPanel } = this.dom;
    if (!optionsPanel) return;
    const shouldOpen = optionsPanel.style.display !== "block";
    optionsPanel.style.display = shouldOpen ? "block" : "none";
    if (shouldOpen) {
      this.hideFilterPanel();
    }
  }

  hideOptionsPanel() {
    const { optionsPanel } = this.dom;
    if (optionsPanel) optionsPanel.style.display = "none";
  }

  activateOptionsTab(tabId) {
    const { optionsTabSections, optionsTabsBar } = this.dom;
    if (!optionsTabSections) return;
    const target = optionsTabSections.has(tabId) ? tabId : "operations";
    this.uiState.activeOptionsTab = target;
    optionsTabSections.forEach((section, key) => {
      section.hidden = key !== target;
    });
    optionsTabsBar?.querySelectorAll(".filter-tab__btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === target);
    });
  }

  flashOptionButton(button) {
    if (!button) return;
    button.classList.add("active");
    setTimeout(() => button.classList.remove("active"), 260);
  }

  setCurrentPage(page) {
    const nextPage = Number.isInteger(page) && page >= 0 ? page : 0;
    this.uiState.currentPage = nextPage;
    if (!this.uiState.pageByCategory) {
      this.uiState.pageByCategory = {};
    }
    this.uiState.pageByCategory[this.uiState.currentCategory] = nextPage;
  }

  resetCurrentPage() {
    this.setCurrentPage(0);
  }

  getStoredPage(category) {
    if (!this.uiState.pageByCategory) return 0;
    return this.uiState.pageByCategory[category] ?? 0;
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
    subtitle.textContent = "Przełączaj zakładki aby filtrować i zarządzać danymi";
    titleWrap.appendChild(heading);
    titleWrap.appendChild(subtitle);

    const actions = document.createElement("div");
    actions.className = "filter-panel__actions";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "filter-clear-btn";
    clearBtn.textContent = "CLEAR FILTERS";
    clearBtn.addEventListener("click", () => this.clearAllFilters());

    const autoFilterWrap = document.createElement("div");
    autoFilterWrap.className = "filter-header-toggle";
    const autoFilterLabel = document.createElement("span");
    autoFilterLabel.className = "filter-header-toggle__label";
    autoFilterLabel.textContent = "AUTO FOLDER SAVE FILTR";
    const autoFilterSwitch = this.createSwitch({
      id: "autoFilterFolderToggle",
      leftLabel: "OFF",
      rightLabel: "ON",
      defaultRight: this.uiState.autoFilterFolder,
      compact: true
    });
    this.dom.autoFilterFolderInput = autoFilterSwitch.input;
    this.dom.autoFilterFolderLabels = {
      left: autoFilterSwitch.leftLabel,
      right: autoFilterSwitch.rightLabel
    };
    this.updateSwitchLabels(
      autoFilterSwitch.input,
      autoFilterSwitch.leftLabel,
      autoFilterSwitch.rightLabel
    );
    autoFilterSwitch.input.addEventListener("change", () => {
      this.uiState.autoFilterFolder = autoFilterSwitch.input.checked;
      this.updateSwitchLabels(
        autoFilterSwitch.input,
        autoFilterSwitch.leftLabel,
        autoFilterSwitch.rightLabel
      );
    });
    autoFilterWrap.appendChild(autoFilterLabel);
    autoFilterWrap.appendChild(autoFilterSwitch.wrapper);

    const closeBtn = document.createElement("button");
    closeBtn.className = "filter-panel__close";
    closeBtn.setAttribute("aria-label", "Zamknij panel filtrów");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hideFilterPanel());

    actions.appendChild(clearBtn);
    actions.appendChild(autoFilterWrap);
    actions.appendChild(closeBtn);

    header.appendChild(titleWrap);
    header.appendChild(actions);

    const tabsBar = document.createElement("div");
    tabsBar.className = "filter-tabs";

    const tabsContent = document.createElement("div");
    tabsContent.className = "filter-tabs__content";

    const tabs = [
      { id: "label", label: "LABELS", builder: () => this.createLabelsSection() },
      { id: "selector", label: "SELECTOR", builder: () => this.createSelectorSection() },
      { id: "search", label: "SEARCH & DATA", builder: () => this.createSearchSection() },
      { id: "time", label: "TIME", builder: () => this.createTimeSection() }
    ];

    const presetsWrap = document.createElement("div");
    presetsWrap.className = "filter-tabs__presets";
    const presetsRow = document.createElement("div");
    presetsRow.className = "filter-tabs__presets-row";
    const presetSaveBtn = document.createElement("button");
    presetSaveBtn.type = "button";
    presetSaveBtn.className = "filter-presets__save";
    presetSaveBtn.textContent = "SAVE FILTR";
    presetSaveBtn.addEventListener("click", () => this.handleSaveFilterPreset());
    const presetSelect = document.createElement("select");
    presetSelect.className = "filter-presets__select";
    presetSelect.addEventListener("change", (event) => this.handlePresetSelectionChange(event));
    const presetEditBtn = document.createElement("button");
    presetEditBtn.type = "button";
    presetEditBtn.className = "filter-presets__edit";
    presetEditBtn.textContent = "EDIT FILTR";
    presetEditBtn.addEventListener("click", () => this.handlePresetRename());
    const presetDeleteBtn = document.createElement("button");
    presetDeleteBtn.type = "button";
    presetDeleteBtn.className = "filter-presets__delete";
    presetDeleteBtn.textContent = "DELETE FILTR";
    presetDeleteBtn.addEventListener("click", () => this.handlePresetDelete());
    presetsRow.appendChild(presetSaveBtn);
    presetsRow.appendChild(presetSelect);
    presetsWrap.appendChild(presetsRow);
    const presetsActions = document.createElement("div");
    presetsActions.className = "filter-presets__actions";
    presetsActions.appendChild(presetEditBtn);
    presetsActions.appendChild(presetDeleteBtn);
    presetsWrap.appendChild(presetsActions);

    const sections = new Map();
    const indicators = new Map();

    this.activateFilterTab = (id) => {
      this.uiState.activeFilterTab = id;
      tabsBar.querySelectorAll(".filter-tab__btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === id);
      });
      sections.forEach((section, key) => {
        if (section) section.hidden = key !== id;
      });
    };

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-tab__btn";
      const label = document.createElement("span");
      label.className = "filter-tab__label";
      label.textContent = tab.label;
      const dot = document.createElement("span");
      dot.className = "filter-tab__dot";
      label.appendChild(dot);
      btn.appendChild(label);
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => this.activateFilterTab(tab.id));
      tabsBar.appendChild(btn);

      const section = tab.builder();
      section.classList.add("filter-tab__panel");
      section.hidden = true;
      tabsContent.appendChild(section);
      sections.set(tab.id, section);
      indicators.set(tab.id, dot);
    });

    tabsBar.appendChild(presetsWrap);

    this.dom.filterTabsContent = tabsContent;
    this.dom.filterTabIndicators = indicators;
    this.dom.filterPresetSelect = presetSelect;
    this.dom.filterPresetSaveBtn = presetSaveBtn;
    this.dom.filterPresetEditBtn = presetEditBtn;
    this.dom.filterPresetDeleteBtn = presetDeleteBtn;

    filterPanel.appendChild(header);
    filterPanel.appendChild(tabsBar);
    filterPanel.appendChild(tabsContent);

    this.updateHeardRangeDisplay();
    this.updateTimeSortButtons();
    this.updateFilterPresetOptions();
    this.activateFilterTab(this.uiState.activeFilterTab);
    this.updateFilterTabIndicators();
  }

  buildOptionsPanel() {
    const { optionsPanel } = this.dom;
    if (!optionsPanel) return;

    optionsPanel.innerHTML = "";
    this.dom.dataModeToggles = {};
    this.dom.dataModeLabels = {};
    this.dom.dataDirectoryHints = {};

    const header = document.createElement("div");
    header.className = "filter-panel__header";

    const spacer = document.createElement("div");

    const actions = document.createElement("div");
    actions.className = "filter-panel__actions";
    const backupBtn = document.createElement("button");
    backupBtn.type = "button";
    backupBtn.className = "filter-backup-btn";
    backupBtn.textContent = "BACKUP DB";
    backupBtn.addEventListener("click", () => this.handleDatabaseBackup());
    const closeBtn = document.createElement("button");
    closeBtn.className = "filter-panel__close";
    closeBtn.setAttribute("aria-label", "Zamknij panel opcji");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hideOptionsPanel());
    actions.appendChild(backupBtn);
    actions.appendChild(closeBtn);

    header.appendChild(spacer);
    header.appendChild(actions);

    const tabsBar = document.createElement("div");
    tabsBar.className = "filter-tabs";
    const tabsContent = document.createElement("div");
    tabsContent.className = "filter-tabs__content";
    const sections = new Map();

    const tabs = [
      { id: "paths", label: "PATHS", builder: () => this.createPathsSection() },
      { id: "operations", label: "OPERATIONS", builder: () => this.createOperationsSection() }
    ];

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-tab__btn";
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.addEventListener("click", () => this.activateOptionsTab(tab.id));
      tabsBar.appendChild(btn);

      const section = tab.builder();
      section.classList.add("filter-tab__panel");
      section.hidden = true;
      tabsContent.appendChild(section);
      sections.set(tab.id, section);
    });

    this.dom.optionsTabSections = sections;
    this.dom.optionsTabsBar = tabsBar;

    optionsPanel.appendChild(header);
    optionsPanel.appendChild(tabsBar);
    optionsPanel.appendChild(tabsContent);

    this.activateOptionsTab(this.uiState.activeOptionsTab);
  }

  createSearchSection() {
    const searchSection = document.createElement("div");
    searchSection.className = "filter-section";
    searchSection.appendChild(this.createSectionTitle("SEARCH"));

    const searchRow = document.createElement("div");
    searchRow.className = "filter-search__row";

    const searchWrap = document.createElement("div");
    searchWrap.className = "filter-search";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.id = "searchInput";
    searchInput.placeholder = "Szukaj albumu lub wykonawcy";
    searchInput.title = "Szukaj";
    searchWrap.appendChild(searchInput);

    searchRow.appendChild(searchWrap);
    searchSection.appendChild(searchRow);

    const searchActions = this.createActionsRow([
      {
        label: "CLEAR",
        handler: () => {
          if (searchInput) searchInput.value = "";
          this.resetCurrentPage();
          this.processAndRender();
        }
      }
    ]);
    searchActions.classList.add("filter-actions--inline", "filter-actions--search");
    searchSection.appendChild(searchActions);

    const searchSpacer = document.createElement("div");
    searchSpacer.className = "filter-search__spacer";
    searchSection.appendChild(searchSpacer);

    searchSection.appendChild(this.createSectionTitle("DATA"));

    const skipFolderRow = document.createElement("div");
    skipFolderRow.className = "filter-toggle-row";
    const skipLabel = document.createElement("div");
    skipLabel.className = "filter-toggle-title";
    skipLabel.textContent = "Pomiń filtrowanie w folderach i kontenerach";
    const skipSwitch = this.createSwitch({
      id: "skipFolderFilteringToggle",
      leftLabel: "OFF",
      rightLabel: "ON",
      defaultRight: this.uiState.skipFolderFiltering,
      compact: true
    });
    this.dom.skipFolderFilteringInput = skipSwitch.input;
    this.dom.skipFolderFilteringLabels = { left: skipSwitch.leftLabel, right: skipSwitch.rightLabel };
    this.updateSwitchLabels(skipSwitch.input, skipSwitch.leftLabel, skipSwitch.rightLabel);
    skipSwitch.input.addEventListener("change", () => {
      this.uiState.skipFolderFiltering = skipSwitch.input.checked;
      this.updateSwitchLabels(skipSwitch.input, skipSwitch.leftLabel, skipSwitch.rightLabel);
      this.processAndRender();
    });
    skipFolderRow.appendChild(skipLabel);
    skipFolderRow.appendChild(skipSwitch.wrapper);
    searchSection.appendChild(skipFolderRow);

    const refreshModeRow = document.createElement("div");
    refreshModeRow.className = "filter-toggle-row";
    const refreshModeLabel = document.createElement("div");
    refreshModeLabel.className = "filter-toggle-title";
    refreshModeLabel.textContent =
      "Automatyczny tryb odświeżania folderów i kontenerów w zakładce FOLDERS";
    const refreshModeSwitch = this.createSwitch({
      leftLabel: "OFF",
      rightLabel: "ON",
      defaultRight: this.uiState.foldersRefreshMode === "AUTO",
      compact: true
    });
    this.dom.foldersRefreshModeInput = refreshModeSwitch.input;
    this.dom.foldersRefreshModeLabels = {
      left: refreshModeSwitch.leftLabel,
      right: refreshModeSwitch.rightLabel
    };
    this.updateSwitchLabels(
      refreshModeSwitch.input,
      refreshModeSwitch.leftLabel,
      refreshModeSwitch.rightLabel
    );
    refreshModeSwitch.input.addEventListener("change", () => {
      this.toggleFoldersRefreshMode(refreshModeSwitch.input.checked);
      this.updateSwitchLabels(
        refreshModeSwitch.input,
        refreshModeSwitch.leftLabel,
        refreshModeSwitch.rightLabel
      );
      this.updateFilterTabIndicators();
    });
    refreshModeRow.appendChild(refreshModeLabel);
    refreshModeRow.appendChild(refreshModeSwitch.wrapper);
    searchSection.appendChild(refreshModeRow);

    const favoriteCornerRow = document.createElement("div");
    favoriteCornerRow.className = "filter-toggle-row";
    const favoriteCornerLabel = document.createElement("div");
    favoriteCornerLabel.className = "filter-toggle-title";
    favoriteCornerLabel.textContent = "Pokaż zaznaczone rogi albumów dodanych do ulubionych";
    const favoriteCornerSwitch = this.createSwitch({
      leftLabel: "OFF",
      rightLabel: "ON",
      defaultRight: this.uiState.showFavoriteCorners,
      compact: true
    });
    this.dom.showFavoriteCornersInput = favoriteCornerSwitch.input;
    this.dom.showFavoriteCornersLabels = {
      left: favoriteCornerSwitch.leftLabel,
      right: favoriteCornerSwitch.rightLabel
    };
    this.updateSwitchLabels(
      favoriteCornerSwitch.input,
      favoriteCornerSwitch.leftLabel,
      favoriteCornerSwitch.rightLabel
    );
    favoriteCornerSwitch.input.addEventListener("change", () => {
      this.uiState.showFavoriteCorners = favoriteCornerSwitch.input.checked;
      this.updateSwitchLabels(
        favoriteCornerSwitch.input,
        favoriteCornerSwitch.leftLabel,
        favoriteCornerSwitch.rightLabel
      );
      this.renderAlbumsPage();
    });
    favoriteCornerRow.appendChild(favoriteCornerLabel);
    favoriteCornerRow.appendChild(favoriteCornerSwitch.wrapper);
    searchSection.appendChild(favoriteCornerRow);

    const dateRange = document.createElement("div");
    dateRange.className = "filter-date-range";
    const months = [
      { label: "wszystkie miesiące", value: "__all__" },
      { label: "styczeń", value: "1" },
      { label: "luty", value: "2" },
      { label: "marzec", value: "3" },
      { label: "kwiecień", value: "4" },
      { label: "maj", value: "5" },
      { label: "czerwiec", value: "6" },
      { label: "lipiec", value: "7" },
      { label: "sierpień", value: "8" },
      { label: "wrzesień", value: "9" },
      { label: "październik", value: "10" },
      { label: "listopad", value: "11" },
      { label: "grudzień", value: "12" }
    ];
    
    const createCycleButton = ({ id, className, options, onChange }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      if (id) button.id = id;
      let index = 0;
      const update = () => {
        const current = options[index];
        button.textContent = current.label;
        button.value = current.value;
      };
      const setValue = (value, { silent = false } = {}) => {
        const nextIndex = options.findIndex((option) => option.value === value);
        index = nextIndex >= 0 ? nextIndex : 0;
        update();
        if (!silent) {
          onChange?.(button.value);
        }
      };
      button.setValue = setValue;
      button.addEventListener("click", () => {
        index = (index + 1) % options.length;
        update();
        onChange?.(button.value);
      });
      update();
      return button;
    };

    const createYearControl = ({ id, onChange }) => {
      const yearInput = document.createElement("input");
      yearInput.type = "hidden";
      yearInput.id = id;
      yearInput.value = "__all__";

      const wrapper = document.createElement("div");
      wrapper.className = "filter-year-control";

      const digitOptions = [
        ["X", "1", "2"],
        ["X", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
        ["X", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
        ["X", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
      ];
      const digitIndexes = digitOptions.map(() => 0);
      const digitButtons = digitOptions.map((options, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "filter-year-digit";
        btn.textContent = options[0];
        btn.addEventListener("click", () => {
          digitIndexes[idx] = (digitIndexes[idx] + 1) % options.length;
          btn.textContent = options[digitIndexes[idx]];
          updateYearValue();
        });
        wrapper.appendChild(btn);
        return btn;
      });

      const updateYearValue = (silent = false) => {
        const digits = digitOptions.map((options, idx) => options[digitIndexes[idx]]);
        if (digits.some((digit) => digit === "X")) {
          yearInput.value = "__all__";
        } else {
          yearInput.value = digits.join("");
        }
        if (!silent) {
          onChange?.(yearInput.value);
        }
      };

      const setValue = (value, { silent = false } = {}) => {
        if (typeof value === "string" && /^\d{4}$/.test(value)) {
          value.split("").forEach((digit, idx) => {
            const options = digitOptions[idx];
            const targetIndex = options.indexOf(digit);
            digitIndexes[idx] = targetIndex >= 0 ? targetIndex : 0;
            digitButtons[idx].textContent = options[digitIndexes[idx]];
          });
        } else {
          digitIndexes.forEach((_, idx) => {
            digitIndexes[idx] = 0;
            digitButtons[idx].textContent = digitOptions[idx][0];
          });
        }
        updateYearValue(silent);
      };

      return { wrapper, input: yearInput, setValue, updateYearValue };
    };

    const buildDateBlock = ({ labelText, yearId, monthId, clearLabel, onClear }) => {
      const block = document.createElement("div");
      block.className = "filter-date-block";

      const label = document.createElement("div");
      label.className = "filter-date-label";
      label.textContent = labelText;

      const selectsWrap = document.createElement("div");
      selectsWrap.className = "filter-date-selects";

      const monthButton = createCycleButton({
        id: monthId,
        className: "filter-cycle-btn",
        options: months,
        onChange: () => {
          this.resetCurrentPage();
          this.processAndRender();
        }
      });
      monthButton.title = "Miesiąc wydania";

      const yearControl = createYearControl({
        id: yearId,
        onChange: (value) => {
          if (value === "__all__") {
            monthButton.setValue("__all__", { silent: true });
          }
          this.resetCurrentPage();
          this.processAndRender();
        }
      });
      yearControl.input.title = "Rok wydania";

      selectsWrap.appendChild(yearControl.wrapper);
      selectsWrap.appendChild(yearControl.input);
      selectsWrap.appendChild(monthButton);

      const actions = this.createActionsRow([{ label: clearLabel, handler: onClear }]);
      actions.classList.add("filter-actions--inline");

      block.appendChild(label);
      block.appendChild(selectsWrap);
      block.appendChild(actions);

      return { block, yearControl, monthButton };
    };

    const fromBlock = buildDateBlock({
      labelText: "FROM",
      yearId: "releaseYearFrom",
      monthId: "releaseMonthFrom",
      clearLabel: "CLEAR",
      onClear: () => {
        this.setYearControlValue(this.dom.releaseYearFromControl, "__all__", { silent: true });
        this.setCycleButtonValue(this.dom.releaseMonthFrom, "__all__", { silent: true });
        this.resetCurrentPage();
        this.processAndRender();
      }
    });
    const toBlock = buildDateBlock({
      labelText: "TO",
      yearId: "releaseYearTo",
      monthId: "releaseMonthTo",
      clearLabel: "CLEAR",
      onClear: () => {
        this.setYearControlValue(this.dom.releaseYearToControl, "__all__", { silent: true });
        this.setCycleButtonValue(this.dom.releaseMonthTo, "__all__", { silent: true });
        this.resetCurrentPage();
        this.processAndRender();
      }
    });

    dateRange.appendChild(fromBlock.block);
    dateRange.appendChild(toBlock.block);
    searchSection.appendChild(dateRange);

    this.dom.searchInput = searchInput;
    this.dom.releaseYearFrom = fromBlock.yearControl.input;
    this.dom.releaseMonthFrom = fromBlock.monthButton;
    this.dom.releaseYearTo = toBlock.yearControl.input;
    this.dom.releaseMonthTo = toBlock.monthButton;
    this.dom.releaseYearFromControl = fromBlock.yearControl;
    this.dom.releaseYearToControl = toBlock.yearControl;
    return searchSection;
  }

  createSelectorSection() {
    const selectorSection = document.createElement("div");
    selectorSection.className = "filter-section";

    const selectorGrid = document.createElement("div");
    selectorGrid.className = "filter-grid";

    SELECTOR_VALUES.forEach((value) => {
      const label = `${value} – ${SELECTOR_LABELS[value]}`;
      selectorGrid.appendChild(
        this.createFilterChip({
          value,
          label,
          selectionSet: this.uiState.selectedSelectors,
          onChange: () => this.processAndRender()
        })
      );
    });

    const favoritesChip = document.createElement("label");
    favoritesChip.className = "filter-chip filter-chip--selection";
    const favoritesText = document.createElement("span");
    favoritesText.textContent = "POKAŻ ULUBIONE ALBUMY";
    const favoritesInput = document.createElement("input");
    favoritesInput.type = "checkbox";
    favoritesInput.checked = this.uiState.showFavorites;
    favoritesInput.addEventListener("change", () => {
      this.uiState.showFavorites = favoritesInput.checked;
      this.resetCurrentPage();
      this.processAndRender();
    });
    favoritesChip.appendChild(favoritesText);
    favoritesChip.appendChild(favoritesInput);
    selectorGrid.appendChild(favoritesChip);
    this.dom.showFavoritesInput = favoritesInput;

    const selectorActions = this.createActionsRow([
      {
        label: "ALL",
        handler: () => this.applyBulkSelection(selectorGrid, this.uiState.selectedSelectors, true)
      },
      {
        label: "NONE",
        handler: () => this.applyBulkSelection(selectorGrid, this.uiState.selectedSelectors, false)
      }
    ]);

    selectorSection.appendChild(selectorGrid);
    selectorSection.appendChild(selectorActions);
    return selectorSection;
  }

  createLabelsSection() {
    const labelsSection = document.createElement("div");
    labelsSection.className = "filter-section";

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
        label: "ALL",
        handler: () => this.applyBulkSelection(labelsGrid, this.uiState.selectedLabels, true)
      },
      {
        label: "NONE",
        handler: () => this.applyBulkSelection(labelsGrid, this.uiState.selectedLabels, false)
      }
    ]);

    labelsSection.appendChild(labelsGrid);
    labelsSection.appendChild(labelActions);
    return labelsSection;
  }

  createOperationsSection() {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-ops";
    this.dom.operationsScopeInputs = {};

    const opsButtons = document.createElement("div");
    opsButtons.className = "ops-button-grid";
    const makeOpButton = (id, label) => {
      const btn = document.createElement("button");
      btn.id = id;
      btn.type = "button";
      btn.textContent = label;
      btn.className = "option-chip ops-button";
      opsButtons.appendChild(btn);
      return btn;
    };

    this.dom.importDbBtn = makeOpButton("importDbBtn", "IMPORT DB");
    this.dom.updateDbBtn = makeOpButton("updateDbBtn", "UPDATE DB");
    this.dom.exportDbBtn = makeOpButton("exportDbBtn", "EXPORT DB");
    this.dom.downloadDbBtn = makeOpButton("downloadDbBtn", "SAVE XLSX");
    this.dom.downloadTxtBtn = makeOpButton("downloadTxtBtn", "SAVE TXT");
    const placeholder = document.createElement("div");
    placeholder.className = "ops-button ops-button--placeholder";
    opsButtons.appendChild(placeholder);

    wrapper.appendChild(opsButtons);

    const collectionSection = document.createElement("div");
    collectionSection.className = "filter-section";
    collectionSection.appendChild(this.createSectionTitle("COLLECTIONS"));

    const collectionRow = document.createElement("div");
    collectionRow.className = "options-select-row";
    const collectionLabel = document.createElement("div");
    collectionLabel.className = "options-select-label";
    collectionLabel.textContent = "Kolekcja";
    const collectionSelectWrap = document.createElement("div");
    collectionSelectWrap.className = "menu-select";
    const collectionSelect = document.createElement("select");
    collectionSelect.id = "collectionSelect";
    collectionSelect.title = "Wybierz kolekcję";
    collectionSelectWrap.appendChild(collectionSelect);
    collectionRow.appendChild(collectionLabel);
    collectionRow.appendChild(collectionSelectWrap);
    collectionSection.appendChild(collectionRow);

    this.dom.collectionSelect = collectionSelect;
    this.rebuildCollectionSelect();

    const scopeSection = document.createElement("div");
    scopeSection.className = "filter-section";
    scopeSection.appendChild(this.createSectionTitle("OPERACJE NA"));
    const scopeRow = document.createElement("div");
    scopeRow.className = "ops-scope";
    const scopeOptions = [
      { value: "folders", label: "FOLDERS" },
      { value: "containers", label: "CONTAINERS" },
      { value: "collections", label: "COLLECTIONS" }
    ];
    scopeOptions.forEach(({ value, label }) => {
      const optionLabel = document.createElement("label");
      optionLabel.className = "ops-scope__option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "opsScope";
      input.value = value;
      input.checked = this.uiState.operationsScope === value;
      optionLabel.appendChild(input);
      const text = document.createElement("span");
      text.textContent = label;
      optionLabel.appendChild(text);
      scopeRow.appendChild(optionLabel);
      this.dom.operationsScopeInputs[value] = input;
    });
    scopeSection.appendChild(scopeRow);

    const actionGrid = document.createElement("div");
    actionGrid.className = "option-grid";
    const makeActionBtn = (id, label) => {
      const btn = document.createElement("button");
      btn.id = id;
      btn.type = "button";
      btn.className = "option-chip";
      btn.textContent = label;
      actionGrid.appendChild(btn);
      return btn;
    };
    this.dom.addEntityBtn = makeActionBtn("addEntityBtn", "ADD");
    this.dom.editEntityBtn = makeActionBtn("editEntityBtn", "EDIT");
    this.dom.deleteEntityBtn = makeActionBtn("deleteEntityBtn", "DELETE");
    scopeSection.appendChild(actionGrid);

    wrapper.appendChild(collectionSection);
    wrapper.appendChild(scopeSection);
    return wrapper;
  }

  createPathsSection() {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-section";

    const dataModeGrid = document.createElement("div");
    dataModeGrid.className = "data-mode-grid";
    const switchConfigs = [
      { key: "importDb", label: "IMPORT DB" },
      { key: "updateDb", label: "UPDATE DB" },
      { key: "exportDb", label: "EXPORT DB" },
      { key: "download", label: "SAVE XLSX / TXT" }
    ];

    switchConfigs.forEach(({ key, label }) => {
      const row = document.createElement("div");
      row.className = "data-mode-row";

      const title = document.createElement("div");
      title.className = "data-mode-title";
      title.textContent = label;

      const dataSwitch = this.createSwitch({
        id: `${key}ModeToggle`,
        leftLabel: "MANUAL",
        rightLabel: "AUTO",
        defaultRight: this.getOperationMode(key) !== "MANUAL",
        compact: true
      });

      this.dom.dataModeToggles[key] = dataSwitch.input;
      this.dom.dataModeLabels[key] = { left: dataSwitch.leftLabel, right: dataSwitch.rightLabel };
      this.updateSwitchLabels(dataSwitch.input, dataSwitch.leftLabel, dataSwitch.rightLabel);

      const hint = document.createElement("div");
      hint.className = "data-mode-hint";
      this.dom.dataDirectoryHints[key] = hint;

      row.appendChild(title);
      row.appendChild(dataSwitch.wrapper);
      row.appendChild(hint);
      dataModeGrid.appendChild(row);
    });

    wrapper.appendChild(dataModeGrid);

    return wrapper;
  }

  createTimeSection() {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-section filter-time";
    wrapper.appendChild(this.createSectionTitle("TIME"));

    const heardRow = document.createElement("div");
    heardRow.className = "heard-filter";
    const heardLabel = document.createElement("span");
    heardLabel.className = "heard-filter__label";
    heardLabel.textContent = "Filtr HEARD";

    const heardControls = document.createElement("div");
    heardControls.className = "heard-filter__controls";
    const buildHeardControl = ({ label, onShiftLeft, onShiftRight }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "heard-filter__range";
      const rangeLabel = document.createElement("span");
      rangeLabel.className = "heard-filter__range-label";
      rangeLabel.textContent = label;
      const control = document.createElement("div");
      control.className = "heard-filter__range-control";
      const leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "menu-chip pagination__btn filter-arrow-btn";
      const leftInner = document.createElement("span");
      leftInner.className = "menu-chip__inner";
      leftInner.textContent = "<<";
      leftBtn.appendChild(leftInner);
      leftBtn.addEventListener("click", onShiftLeft);
      const heardValue = document.createElement("div");
      heardValue.className = "heard-filter__value";
      heardValue.textContent = "A";
      const rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "menu-chip pagination__btn filter-arrow-btn";
      const rightInner = document.createElement("span");
      rightInner.className = "menu-chip__inner";
      rightInner.textContent = ">>";
      rightBtn.appendChild(rightInner);
      rightBtn.addEventListener("click", onShiftRight);
      control.appendChild(leftBtn);
      control.appendChild(heardValue);
      control.appendChild(rightBtn);
      wrapper.appendChild(rangeLabel);
      wrapper.appendChild(control);
      return { wrapper, leftBtn, rightBtn, heardValue };
    };

    const heardMinControl = buildHeardControl({
      label: "Od",
      onShiftLeft: () => this.shiftHeardRange("min", -1),
      onShiftRight: () => this.shiftHeardRange("min", 1)
    });
    const heardMaxControl = buildHeardControl({
      label: "Do",
      onShiftLeft: () => this.shiftHeardRange("max", -1),
      onShiftRight: () => this.shiftHeardRange("max", 1)
    });

    this.dom.heardMinLeftBtn = heardMinControl.leftBtn;
    this.dom.heardMinRightBtn = heardMinControl.rightBtn;
    this.dom.heardMinDisplay = heardMinControl.heardValue;
    this.dom.heardMaxLeftBtn = heardMaxControl.leftBtn;
    this.dom.heardMaxRightBtn = heardMaxControl.rightBtn;
    this.dom.heardMaxDisplay = heardMaxControl.heardValue;

    heardControls.appendChild(heardMinControl.wrapper);
    heardControls.appendChild(heardMaxControl.wrapper);

    heardRow.appendChild(heardLabel);
    heardRow.appendChild(heardControls);

    const sortTitle = document.createElement("div");
    sortTitle.className = "filter-section__subtitle";
    sortTitle.textContent = "Sortowanie czasu trwania";

    const sortButtons = document.createElement("div");
    sortButtons.className = "filter-time__sort";

    const buildSortChip = ({ label, mode }) => {
      const chip = document.createElement("label");
      chip.className = "filter-chip";
      const text = document.createElement("span");
      text.textContent = label;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.uiState.sortMode === mode;
      checkbox.addEventListener("change", () => {
        this.setTimeSortMode(mode);
      });
      chip.appendChild(text);
      chip.appendChild(checkbox);
      return { chip, checkbox };
    };

    const ascChip = buildSortChip({
      label: "SORTUJ OD NAJKRÓTSZYCH ALBUMÓW",
      mode: "duration_asc"
    });
    const descChip = buildSortChip({
      label: "SORTUJ OD NAJDŁUŻSZYCH ALBUMÓW",
      mode: "duration_desc"
    });
    const releaseDescChip = buildSortChip({
      label: "SORTUJ OD NAJNOWSZYCH ALBUMÓW",
      mode: "release_desc"
    });
    const releaseAscChip = buildSortChip({
      label: "SORTUJ OD NAJSTARSZYCH ALBUMÓW",
      mode: "release_asc"
    });

    this.dom.sortDurationAscBtn = ascChip.checkbox;
    this.dom.sortDurationDescBtn = descChip.checkbox;
    this.dom.sortReleaseDescBtn = releaseDescChip.checkbox;
    this.dom.sortReleaseAscBtn = releaseAscChip.checkbox;

    const releaseRow = document.createElement("div");
    releaseRow.className = "filter-grid filter-time__sort-row";
    releaseRow.appendChild(releaseDescChip.chip);
    releaseRow.appendChild(releaseAscChip.chip);

    const durationRow = document.createElement("div");
    durationRow.className = "filter-grid filter-time__sort-row";
    durationRow.appendChild(ascChip.chip);
    durationRow.appendChild(descChip.chip);

    sortButtons.appendChild(releaseRow);
    sortButtons.appendChild(durationRow);

    const rangeTitle = document.createElement("div");
    rangeTitle.className = "filter-section__subtitle";
    rangeTitle.textContent = "Zakres czasu trwania (min)";

    const rangeRow = document.createElement("div");
    rangeRow.className = "duration-range";

    const minWrap = document.createElement("label");
    minWrap.className = "duration-range__field";
    minWrap.textContent = "Od";
    const minControls = document.createElement("div");
    minControls.className = "duration-range__controls";
    const minLeftBtn = document.createElement("button");
    minLeftBtn.type = "button";
    minLeftBtn.className = "menu-chip pagination__btn filter-arrow-btn";
    const minLeftInner = document.createElement("span");
    minLeftInner.className = "menu-chip__inner";
    minLeftInner.textContent = "<<";
    minLeftBtn.appendChild(minLeftInner);
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.min = "0";
    minInput.placeholder = "np. 10";
    minInput.addEventListener("input", () => this.updateDurationRange());
    minLeftBtn.addEventListener("click", () => this.adjustDurationRangeInput(minInput, -1));
    const minRightBtn = document.createElement("button");
    minRightBtn.type = "button";
    minRightBtn.className = "menu-chip pagination__btn filter-arrow-btn";
    const minRightInner = document.createElement("span");
    minRightInner.className = "menu-chip__inner";
    minRightInner.textContent = ">>";
    minRightBtn.appendChild(minRightInner);
    minRightBtn.addEventListener("click", () => this.adjustDurationRangeInput(minInput, 1));
    minControls.appendChild(minLeftBtn);
    minControls.appendChild(minInput);
    minControls.appendChild(minRightBtn);
    minWrap.appendChild(minControls);

    const maxWrap = document.createElement("label");
    maxWrap.className = "duration-range__field";
    maxWrap.textContent = "Do";
    const maxControls = document.createElement("div");
    maxControls.className = "duration-range__controls";
    const maxLeftBtn = document.createElement("button");
    maxLeftBtn.type = "button";
    maxLeftBtn.className = "menu-chip pagination__btn filter-arrow-btn";
    const maxLeftInner = document.createElement("span");
    maxLeftInner.className = "menu-chip__inner";
    maxLeftInner.textContent = "<<";
    maxLeftBtn.appendChild(maxLeftInner);
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.placeholder = "np. 60";
    maxInput.addEventListener("input", () => this.updateDurationRange());
    maxLeftBtn.addEventListener("click", () => this.adjustDurationRangeInput(maxInput, -1));
    const maxRightBtn = document.createElement("button");
    maxRightBtn.type = "button";
    maxRightBtn.className = "menu-chip pagination__btn filter-arrow-btn";
    const maxRightInner = document.createElement("span");
    maxRightInner.className = "menu-chip__inner";
    maxRightInner.textContent = ">>";
    maxRightBtn.appendChild(maxRightInner);
    maxRightBtn.addEventListener("click", () => this.adjustDurationRangeInput(maxInput, 1));
    maxControls.appendChild(maxLeftBtn);
    maxControls.appendChild(maxInput);
    maxControls.appendChild(maxRightBtn);
    maxWrap.appendChild(maxControls);

    rangeRow.appendChild(minWrap);
    rangeRow.appendChild(maxWrap);

    this.dom.durationRangeMinInput = minInput;
    this.dom.durationRangeMaxInput = maxInput;
    
    const timeActions = this.createActionsRow([
      {
        label: "CLEAR",
        handler: () => this.resetTimeFiltersAndRender()
      }
    ]);

    wrapper.appendChild(heardRow);
    wrapper.appendChild(sortTitle);
    wrapper.appendChild(sortButtons);
    wrapper.appendChild(rangeTitle);
    wrapper.appendChild(rangeRow);
    wrapper.appendChild(timeActions);
    return wrapper;
  }

  async bootstrapDataPaths() {
    try {
      this.uiState.appDirectory = await getAppDirectory();
    } catch (error) {
      console.warn("Nie udało się ustalić katalogu aplikacji:", error);
    } finally {
      this.updateAllDataDirectoryHints();
    }
  }

  getOperationMode(operationKey) {
    return this.uiState.dataPaths?.[operationKey]?.mode || "AUTO";
  }

  getOperationState(operationKey) {
    return this.uiState.dataPaths?.[operationKey] || { mode: "AUTO", manualDirectory: "" };
  }

  getDefaultDirectory(operationKey) {
    const segments = DATA_DIRECTORIES[operationKey] || [];
    const basePath = this.uiState.appDirectory || "";
    return buildPath(basePath, ...segments);
  }

  updateDataDirectoryHint(operationKey) {
    const hint = this.dom.dataDirectoryHints?.[operationKey];
    const toggle = this.dom.dataModeToggles?.[operationKey];
    const labels = this.dom.dataModeLabels?.[operationKey];
    if (!hint) return;

    const mode = this.getOperationMode(operationKey);
    const state = this.getOperationState(operationKey);
    const defaultPath = this.getDefaultDirectory(operationKey);
    const manualPath = state.manualDirectory;
    const defaultLabel = defaultPath || "brak";
    const manualLabel = manualPath || "brak";
    const currentLabel = mode === "AUTO" ? defaultLabel : manualLabel;
    hint.innerHTML = "";

    const currentRow = document.createElement("div");
    currentRow.className = "data-mode-hint__row";
    const currentSpan = document.createElement("span");
    currentSpan.textContent = currentLabel;
    currentRow.appendChild(currentSpan);

    hint.appendChild(currentRow);
    this.updateSwitchLabels(toggle, labels?.left, labels?.right);
  }

  updateAllDataDirectoryHints() {
    Object.keys(DATA_DIRECTORIES).forEach((operationKey) => this.updateDataDirectoryHint(operationKey));
  }

  async handleDataModeToggle(operationKey) {
    const toggle = this.dom.dataModeToggles?.[operationKey];
    const labels = this.dom.dataModeLabels?.[operationKey];
    const state = this.getOperationState(operationKey);
    const useAuto = toggle ? toggle.checked : true;
    state.mode = useAuto ? "AUTO" : "MANUAL";
    if (!useAuto) {
      const chosen = await this.pickManualDirectory(state.manualDirectory);
      if (!chosen) {
        state.mode = "AUTO";
        if (toggle) toggle.checked = true;
      } else {
        state.manualDirectory = chosen;
      }
    }
    this.updateSwitchLabels(toggle, labels?.left, labels?.right);
    this.updateDataDirectoryHint(operationKey);
  }

  async pickManualDirectory(defaultPath = "") {
    try {
      const selected = await selectDirectory({ defaultPath });
      if (selected) {
        return selected;
      }
    } catch (error) {
      this.showStatusMessage(error.message || error);
    }
    return null;
  }

  async getActiveDataDirectory(operationKey) {
    const state = this.getOperationState(operationKey);
    if (this.getOperationMode(operationKey) === "AUTO") {
      if (!this.uiState.appDirectory) {
        try {
          this.uiState.appDirectory = await getAppDirectory();
        } catch (error) {
          console.warn("Nie udało się pobrać ścieżki aplikacji:", error);
        }
      }
      return this.getDefaultDirectory(operationKey);
    }

    if (state.manualDirectory) return state.manualDirectory;
    const picked = await this.pickManualDirectory();
    if (picked) {
      state.manualDirectory = picked;
      this.updateDataDirectoryHint(operationKey);
      return picked;
    }
    this.showStatusMessage("Wybierz folder dla operacji importu/eksportu.");
    return null;
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
      btn.className = "option-chip option-chip--action";
      btn.textContent = label;
      btn.addEventListener("click", () => handler?.());
      wrapper.appendChild(btn);
    });
    return wrapper;
  }

  setCycleButtonValue(button, value, options) {
    if (!button) return;
    if (typeof button.setValue === "function") {
      button.setValue(value, options);
    } else {
      button.value = value;
    }
  }

  setYearControlValue(control, value, options) {
    if (!control || typeof control.setValue !== "function") return;
    control.setValue(value, options);
  }

  createSwitch({ id, leftLabel, rightLabel, defaultRight = true, compact = false } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "toggle-wrapper";

    const left = document.createElement("span");
    left.className = "toggle-label";
    left.textContent = leftLabel;

    const label = document.createElement("label");
    label.className = `switch${compact ? " switch--compact" : ""}`;

    const input = document.createElement("input");
    input.type = "checkbox";
    if (id) input.id = id;
    input.checked = defaultRight;
    const slider = document.createElement("span");
    slider.className = "slider";
    label.appendChild(input);
    label.appendChild(slider);

    const right = document.createElement("span");
    right.className = "toggle-label";
    right.textContent = rightLabel;

    wrapper.appendChild(left);
    wrapper.appendChild(label);
    wrapper.appendChild(right);

    return { wrapper, input, leftLabel: left, rightLabel: right };
  }

  updateSwitchLabels(input, leftEl, rightEl) {
    if (!input || !leftEl || !rightEl) return;
    const rightActive = Boolean(input.checked);
    leftEl.classList.toggle("muted", rightActive);
    rightEl.classList.toggle("muted", !rightActive);
  }

  formatTimestampForFileName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}_${pad(date.getHours())}-${pad(
      date.getMinutes()
    )}-${pad(date.getSeconds())}`;
  }

  buildTimestampedFileName(prefix, extension = "xlsx") {
    return `${prefix}_${this.formatTimestampForFileName()}.${extension}`;
  }

  buildFilterFolderName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `FILTR_${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}-${pad(
      date.getHours()
    )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  async selectDataFile(defaultPath = "") {
    try {
      return await selectFile({
        defaultPath,
        filters: [{ name: "Arkusze Excel", extensions: ["xlsx"] }]
      });
    } catch (error) {
      this.showStatusMessage(error.message || error);
      return null;
    }
  }

  async resolveImportSource({ operationKey, prefix }) {
    const directory = await this.getActiveDataDirectory(operationKey);
    if (!directory) return null;

    const useManual = this.getOperationMode(operationKey) === "MANUAL";
    let chosenPath = null;
    if (useManual) {
      chosenPath = await this.selectDataFile(directory);
      if (!chosenPath) return null;
    }

    const resolved = await resolveImportFile({
      directory,
      filePath: chosenPath,
      prefix
    });

    return { directory, filePath: resolved.filePath, fileName: resolved.fileName };
  }

  createFilterChip({ value, label, selectionSet, onChange }) {
    const wrapper = document.createElement("label");
    wrapper.className = "filter-chip filter-chip--selection";

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

  updateHeardRangeDisplay() {
    const { min, max } = this.uiState.heardRange;
    if (this.dom.heardMinDisplay) {
      this.dom.heardMinDisplay.textContent = Number.isInteger(min) ? min.toString() : "A";
    }
    if (this.dom.heardMaxDisplay) {
      this.dom.heardMaxDisplay.textContent = Number.isInteger(max) ? max.toString() : "A";
    }
  }

  computeNextHeardValue(current, direction) {
    let next = current;
    if (direction < 0) {
      if (current === null) next = 0;
      else if (current === 0) next = 0;
      else if (current === 1) next = null;
      else if (current > 1) next = current - 1;
    } else if (direction > 0) {
      if (current === 0) next = null;
      else if (current === null) next = 1;
      else if (current >= 1 && current < 999) next = current + 1;
      else next = 999;
    }
    return next;
  }

  normalizeHeardRange() {
    const { min, max } = this.uiState.heardRange;
    if (min !== null && max !== null && min > max) {
      this.uiState.heardRange = { min: max, max: min };
    }
  }

  shiftHeardRange(boundary, direction) {
    const current = Number.isInteger(this.uiState.heardRange[boundary]) ? this.uiState.heardRange[boundary] : null;
    const next = this.computeNextHeardValue(current, direction);
    if (next === current) return;
    this.uiState.heardRange = {
      ...this.uiState.heardRange,
      [boundary]: next
    };
    this.normalizeHeardRange();
    this.resetCurrentPage();
    this.updateHeardRangeDisplay();
    this.processAndRender();
  }

  resetHeardRange() {
    this.uiState.heardRange = { min: null, max: null };
    this.updateHeardRangeDisplay();
  }

  setTimeSortMode(mode) {
    const next = this.uiState.sortMode === mode ? "release_desc" : mode;
    if (this.uiState.sortMode !== next) {
      this.uiState.sortMode = next;
      this.store.setSortMode(next);
      this.resetCurrentPage();
      this.renderAlbumsPage();
    }
    this.updateTimeSortButtons();
    this.updateFilterTabIndicators();
  }

  updateTimeSortButtons() {
    const { sortDurationAscBtn, sortDurationDescBtn, sortReleaseAscBtn, sortReleaseDescBtn } = this.dom;
    const active = this.uiState.sortMode;
    if (sortDurationAscBtn) {
      sortDurationAscBtn.checked = active === "duration_asc";
    }
    if (sortDurationDescBtn) {
      sortDurationDescBtn.checked = active === "duration_desc";
    }
    if (sortReleaseDescBtn) {
      sortReleaseDescBtn.checked = active === "release_desc";
    }
    if (sortReleaseAscBtn) {
      sortReleaseAscBtn.checked = active === "release_asc";
    }
  }

  resetTimeFiltersAndRender() {
    const isHeardDefault = this.uiState.heardRange.min === null && this.uiState.heardRange.max === null;
    const isDurationDefault = this.uiState.durationRange.min === null && this.uiState.durationRange.max === null;
    const isSortDefault = this.uiState.sortMode === "release_desc";
    if (isHeardDefault && isDurationDefault && isSortDefault) return;
    this.resetHeardRange();
    this.uiState.durationRange = { min: null, max: null };
    this.uiState.sortMode = "release_desc";
    this.store.setSortMode("release_desc");
    if (this.dom.durationRangeMinInput) this.dom.durationRangeMinInput.value = "";
    if (this.dom.durationRangeMaxInput) this.dom.durationRangeMaxInput.value = "";
    this.updateTimeSortButtons();
    this.resetCurrentPage();
    this.processAndRender();
  }

  updateDurationRange() {
    const { durationRangeMinInput, durationRangeMaxInput } = this.dom;
    const parseValue = (input) => {
      if (!input) return null;
      const raw = input.value.trim();
      if (!raw) return null;
      const num = Number(raw);
      return Number.isFinite(num) && num >= 0 ? Math.floor(num) : null;
    };
    let minVal = parseValue(durationRangeMinInput);
    let maxVal = parseValue(durationRangeMaxInput);
    if (minVal !== null && maxVal !== null && minVal > maxVal) {
      [minVal, maxVal] = [maxVal, minVal];
      if (durationRangeMinInput) durationRangeMinInput.value = String(minVal);
      if (durationRangeMaxInput) durationRangeMaxInput.value = String(maxVal);
    }
    this.uiState.durationRange = { min: minVal, max: maxVal };
    this.resetCurrentPage();
    this.processAndRender();
  }

  adjustDurationRangeInput(input, delta) {
    if (!input) return;
    const current = Number.parseInt(input.value || "0", 10);
    const safeCurrent = Number.isNaN(current) ? 0 : current;
    const nextValue = Math.max(0, safeCurrent + delta);
    input.value = String(nextValue);
    this.updateDurationRange();
  }

  resetDurationRangeAndRender() {
    if (this.dom.durationRangeMinInput) this.dom.durationRangeMinInput.value = "";
    if (this.dom.durationRangeMaxInput) this.dom.durationRangeMaxInput.value = "";
    this.uiState.durationRange = { min: null, max: null };
    this.resetCurrentPage();
    this.processAndRender();
  }

  isLabelsDefault() {
    if (this.uiState.selectedLabels.size !== LABEL_MAP.size) return false;
    for (const label of LABEL_MAP.keys()) {
      if (!this.uiState.selectedLabels.has(label)) return false;
    }
    return true;
  }

  isSelectorDefault() {
    if (!this.uiState.showFavorites) return false;
    if (this.uiState.selectedSelectors.size !== SELECTOR_VALUES.length) return false;
    return SELECTOR_VALUES.every((value) => this.uiState.selectedSelectors.has(value));
  }

  isSearchDefault() {
    const { releaseMonthFrom, releaseYearFrom, releaseMonthTo, releaseYearTo, searchInput } = this.dom;
    if (searchInput?.value?.trim()) return false;
    const isAll = (select) => !select || select.value === "__all__";
    return (
      isAll(releaseYearFrom) &&
      isAll(releaseMonthFrom) &&
      isAll(releaseYearTo) &&
      isAll(releaseMonthTo) &&
      this.uiState.skipFolderFiltering &&
      this.uiState.foldersRefreshMode === "AUTO"
    );
  }

  isTimeDefault() {
    return (
      this.uiState.heardRange.min === null &&
      this.uiState.heardRange.max === null &&
      this.uiState.sortMode === "release_desc" &&
      this.uiState.durationRange.min === null &&
      this.uiState.durationRange.max === null
    );
  }

  isAnyFilterActive() {
    return (
      !this.isLabelsDefault() ||
      !this.isSelectorDefault() ||
      !this.isSearchDefault() ||
      !this.isTimeDefault()
    );
  }

  updateFilterTabIndicators() {
    const indicators = this.dom.filterTabIndicators;
    const state = {
      label: !this.isLabelsDefault(),
      selector: !this.isSelectorDefault(),
      search: !this.isSearchDefault(),
      time: !this.isTimeDefault()
    };
    if (indicators) {
      Object.entries(state).forEach(([key, active]) => {
        const dot = indicators.get(key);
        if (dot) dot.classList.toggle("active", active);
      });
    }
    const filterActive = this.isAnyFilterActive();
    if (this.dom.filterBtnDot) {
      this.dom.filterBtnDot.classList.toggle("active", filterActive);
    }
    if (this.dom.filterClearBtn) {
      this.dom.filterClearBtn.classList.toggle("active", filterActive);
    }
  }

  clearAllFilters() {
  const { filterPanel, releaseMonthFrom, releaseMonthTo, searchInput } = this.dom;

    // NIE podmieniaj Setów (bo listenery chipów trzymają referencję do starych)
    this.uiState.selectedLabels.clear();
    for (const name of LABEL_MAP.keys()) this.uiState.selectedLabels.add(name);

    this.uiState.selectedSelectors.clear();
    for (const sel of SELECTOR_VALUES) this.uiState.selectedSelectors.add(sel);
    this.uiState.showFavorites = true;
    if (this.dom.showFavoritesInput) {
      this.dom.showFavoritesInput.checked = true;
    }

    this.resetHeardRange();
    this.uiState.sortMode = "release_desc";
    this.uiState.durationRange = { min: null, max: null };
    this.store.setSortMode("release_desc");
    this.updateTimeSortButtons();

    if (searchInput) searchInput.value = "";
    this.setYearControlValue(this.dom.releaseYearFromControl, "__all__", { silent: true });
    this.setCycleButtonValue(releaseMonthFrom, "__all__", { silent: true });
    this.setYearControlValue(this.dom.releaseYearToControl, "__all__", { silent: true });
    this.setCycleButtonValue(releaseMonthTo, "__all__", { silent: true });
    if (this.dom.durationRangeMinInput) this.dom.durationRangeMinInput.value = "";
    if (this.dom.durationRangeMaxInput) this.dom.durationRangeMaxInput.value = "";
    this.uiState.skipFolderFiltering = true;
    if (this.dom.skipFolderFilteringInput) {
      this.dom.skipFolderFilteringInput.checked = true;
      this.updateSwitchLabels(
        this.dom.skipFolderFilteringInput,
        this.dom.skipFolderFilteringLabels?.left,
        this.dom.skipFolderFilteringLabels?.right
      );
    }
    this.toggleFoldersRefreshMode(true);
    if (this.dom.foldersRefreshModeInput) {
      this.dom.foldersRefreshModeInput.checked = true;
      this.updateSwitchLabels(
        this.dom.foldersRefreshModeInput,
        this.dom.foldersRefreshModeLabels?.left,
        this.dom.foldersRefreshModeLabels?.right
      );
    }
    this.setActiveFilterPreset("__none__", { silent: true });

    if (filterPanel) {
      filterPanel.querySelectorAll('.filter-chip--selection input[type="checkbox"]').forEach((cb) => {
        const shouldCheck =
          this.uiState.selectedSelectors.has(cb.value) || this.uiState.selectedLabels.has(cb.value);
        cb.checked = shouldCheck;
      });
    }

    this.resetCurrentPage();
    this.processAndRender();
  }

  async loadFilterPresets() {
    try {
      const presets = await fetchFilterPresets();
      this.uiState.filterPresets = Array.isArray(presets) ? presets : [];
    } catch (error) {
      console.warn("Nie udało się wczytać zapisanych filtrów:", error);
      this.uiState.filterPresets = [];
    }
    this.updateFilterPresetOptions();
    this.applyStoredFilterPresetOnce();
  }

  updateFilterPresetOptions() {
    const select = this.dom.filterPresetSelect;
    if (!select) return;
    select.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "__none__";
    defaultOption.textContent = "brak filtrowania";
    defaultOption.title = "brak filtrowania";
    select.appendChild(defaultOption);
    this.uiState.filterPresets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.name;
      option.textContent = preset.name;
      option.title = preset.name;
      select.appendChild(option);
    });
    const available = new Set([
      "__none__",
      ...this.uiState.filterPresets.map((preset) => preset.name)
    ]);
    if (!available.has(this.uiState.activeFilterPreset)) {
      this.uiState.activeFilterPreset = "__none__";
    }
    this.setActiveFilterPreset(this.uiState.activeFilterPreset, { silent: true });
  }

  setActiveFilterPreset(name, { silent = false } = {}) {
    this.uiState.activeFilterPreset = name || "__none__";
    if (this.dom.filterPresetSelect) {
      this.dom.filterPresetSelect.value = this.uiState.activeFilterPreset;
      const selectedLabel =
        this.uiState.activeFilterPreset === "__none__" ? "brak filtrowania" : this.uiState.activeFilterPreset;
      this.dom.filterPresetSelect.title = selectedLabel;
    }
    const disablePresetActions = this.uiState.activeFilterPreset === "__none__";
    if (this.dom.filterPresetEditBtn) {
      this.dom.filterPresetEditBtn.disabled = disablePresetActions;
    }
    if (this.dom.filterPresetDeleteBtn) {
      this.dom.filterPresetDeleteBtn.disabled = disablePresetActions;
    }
    if (!silent) {
      this.updateFilterTabIndicators();
    }
  }

  readStoredFilterPreset() {
    try {
      return localStorage.getItem("qobuzActiveFilterPreset") || "__none__";
    } catch (error) {
      console.warn("Nie udało się odczytać zapisanego filtra:", error);
      return "__none__";
    }
  }

  persistActiveFilterPreset() {
    const value = this.uiState.activeFilterPreset || "__none__";
    this.uiState.storedFilterPreset = value;
    try {
      localStorage.setItem("qobuzActiveFilterPreset", value);
    } catch (error) {
      console.warn("Nie udało się zapisać aktywnego filtra:", error);
    }
  }

  readStoredSelections() {
    try {
      const raw = localStorage.getItem("qobuzStoredSelections");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        collection: parsed?.collection || "__all__",
        container: parsed?.container || "__all__",
        folder: parsed?.folder || "__all__"
      };
    } catch (error) {
      console.warn("Nie udało się odczytać zapisanych wyborów:", error);
      return null;
    }
  }

  persistStoredSelections() {
    const payload = {
      collection: this.uiState.activeCollection || "__all__",
      container: this.dom.containerSelect?.value || "__all__",
      folder: this.dom.folderSelect?.value || "__all__"
    };
    this.uiState.storedSelections = payload;
    try {
      localStorage.setItem("qobuzStoredSelections", JSON.stringify(payload));
    } catch (error) {
      console.warn("Nie udało się zapisać wyborów:", error);
    }
  }

  applyStoredSelectionsOnce() {
    if (this.uiState.storedSelectionsApplied) return false;
    const stored = this.uiState.storedSelections;
    if (!stored) return false;
    this.uiState.storedSelectionsApplied = true;
    let collection = stored.collection || "__all__";
    if (collection !== "__all__" && !this.store.collectionsList.has(collection)) {
      collection = "__all__";
    }
    this.uiState.activeCollection = collection;
    this.rebuildCollectionSelect();

    this.rebuildContainerSelect();
    if (this.dom.containerSelect) {
      const desiredContainer = stored.container;
      const containerOption = Array.from(this.dom.containerSelect.options).some(
        (opt) => opt.value === desiredContainer
      );
      this.dom.containerSelect.value = containerOption ? desiredContainer : "__all__";
    }

    this.rebuildFolderSelect();
    if (this.dom.folderSelect) {
      const desiredFolder = stored.folder;
      const folderOption = Array.from(this.dom.folderSelect.options).some((opt) => opt.value === desiredFolder);
      this.dom.folderSelect.value = folderOption ? desiredFolder : "__all__";
    }
    return true;
  }

  applyStoredFilterPresetOnce() {
    if (this.uiState.storedFilterPresetApplied) return;
    this.uiState.storedFilterPresetApplied = true;
    const stored = this.uiState.storedFilterPreset || "__none__";
    if (stored === "__none__") {
      this.setActiveFilterPreset("__none__", { silent: true });
      return;
    }
    const preset = this.uiState.filterPresets.find((item) => item.name === stored);
    if (preset) {
      this.applyFilterPreset(preset);
    } else {
      this.setActiveFilterPreset("__none__", { silent: true });
    }
  }

  serializeCurrentFilters() {
    const { releaseMonthFrom, releaseYearFrom, releaseMonthTo, releaseYearTo, searchInput } = this.dom;
    return {
      labels: Array.from(this.uiState.selectedLabels),
      selectors: Array.from(this.uiState.selectedSelectors),
      searchTerm: searchInput?.value || "",
      releaseYearFrom: releaseYearFrom?.value || "__all__",
      releaseMonthFrom: releaseMonthFrom?.value || "__all__",
      releaseYearTo: releaseYearTo?.value || "__all__",
      releaseMonthTo: releaseMonthTo?.value || "__all__",
      heardMin: this.uiState.heardRange.min,
      heardMax: this.uiState.heardRange.max,
      durationMin: this.uiState.durationRange.min,
      durationMax: this.uiState.durationRange.max,
      sortMode: this.uiState.sortMode,
      showFavorites: this.uiState.showFavorites,
      containerFilter: this.dom.containerSelect?.value || "__all__",
      folderFilter: this.dom.folderSelect?.value || "__all__",
      currentPage: this.uiState.currentPage,
      skipFolderFiltering: this.uiState.skipFolderFiltering,
      foldersRefreshMode: this.uiState.foldersRefreshMode
    };
  }

  promptForPresetName({ title, defaultValue = "" }) {
    return new Promise((resolve) => {
      document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const card = document.createElement("div");
      card.className = "modal-card";

      const heading = document.createElement("h4");
      heading.className = "modal-title";
      heading.textContent = title;

      const input = document.createElement("input");
      const maxLength = 30;
      input.type = "text";
      input.className = "modal-input";
      input.maxLength = maxLength;
      input.value = (defaultValue || "").slice(0, maxLength);
      input.placeholder = "np. moje_filtry1";
      input.autocomplete = "off";
      input.spellcheck = false;

      const actions = document.createElement("div");
      actions.className = "modal-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "modal-btn modal-btn--cancel";
      cancelBtn.textContent = "ANULUJ";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "modal-btn modal-btn--confirm";
      confirmBtn.textContent = "ZAPISZ";

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);

      card.appendChild(heading);
      card.appendChild(input);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const cleanup = (value) => {
        overlay.remove();
        resolve(value);
      };

      cancelBtn.addEventListener("click", () => cleanup(null));
      confirmBtn.addEventListener("click", () => cleanup(input.value));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) cleanup(null);
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          cleanup(input.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }
      });

      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  infoModal({ title = "Informacja", message = "", confirmText = "OK" } = {}) {
    return new Promise((resolve) => {
      document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());

      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const card = document.createElement("div");
      card.className = "modal-card";

      const heading = document.createElement("h4");
      heading.className = "modal-title";
      heading.textContent = title;

      const body = document.createElement("div");
      body.className = "modal-body";
      body.textContent = message;

      const actions = document.createElement("div");
      actions.className = "modal-actions";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "modal-btn modal-btn--confirm";
      confirmBtn.textContent = confirmText;

      actions.appendChild(confirmBtn);

      card.appendChild(heading);
      card.appendChild(body);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const cleanup = () => {
        overlay.remove();
        resolve(true);
      };

      confirmBtn.addEventListener("click", cleanup);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) cleanup();
      });

      const onKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          cleanup();
        }
      };
      overlay.addEventListener("keydown", onKeyDown);
      confirmBtn.addEventListener("keydown", onKeyDown);

      setTimeout(() => {
        confirmBtn.focus();
      }, 0);
    });
  }

  confirmModal({ title = "Potwierdź", message = "", confirmText = "OK", cancelText = "ANULUJ" } = {}) {
    return new Promise((resolve) => {
      document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());

      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const card = document.createElement("div");
      card.className = "modal-card";

      const heading = document.createElement("h4");
      heading.className = "modal-title";
      heading.textContent = title;

      const body = document.createElement("div");
      body.className = "modal-body";
      body.textContent = message;

      const actions = document.createElement("div");
      actions.className = "modal-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "modal-btn modal-btn--cancel";
      cancelBtn.textContent = cancelText;

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "modal-btn modal-btn--confirm";
      confirmBtn.textContent = confirmText;

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);

      card.appendChild(heading);
      card.appendChild(body);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const cleanup = (value) => {
        overlay.remove();
        resolve(value);
      };

      cancelBtn.addEventListener("click", () => cleanup(false));
      confirmBtn.addEventListener("click", () => cleanup(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) cleanup(false);
      });

      // Klawiatura: ESC=anuluj, ENTER=potwierdź
      const onKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(false);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          cleanup(true);
        }
      };
      overlay.addEventListener("keydown", onKeyDown);
      cancelBtn.addEventListener("keydown", onKeyDown);
      confirmBtn.addEventListener("keydown", onKeyDown);

      setTimeout(() => {
        // Focus na przycisk POTWIERDŹ – szybciej się klika Enterem.
        confirmBtn.focus();
      }, 0);
    });
  }

  async handleSaveFilterPreset() {
    const activeName = this.uiState.activeFilterPreset;
    const payload = this.serializeCurrentFilters();
    if (activeName && activeName !== "__none__") {
      try {
        await saveFilterPreset(activeName, payload);
        await this.loadFilterPresets();
        this.setActiveFilterPreset(activeName);
        this.showTransientStatus(`${activeName} został zapisany ${formatStatusDate(new Date())}`);
        await this.createAutoFilterFolder();
      } catch (error) {
        this.showStatusMessage(error.message || "Nie udało się zapisać filtrów.");
      }
      return;
    }

    if (this.uiState.filterPresets.length >= 30) {
      this.showStatusMessage("Osiągnięto maksymalną ilość zapisanych filtrów.");
      return;
    }

    const name = await this.promptForPresetName({ title: "Wpisz nazwę zestawu filtrów" });
    const trimmedName = name?.trim();
    if (!trimmedName) return;
    if (trimmedName.length > 30) {
      this.showStatusMessage("Nazwa filtra może mieć maksymalnie 30 znaków.");
      return;
    }
    try {
      await saveFilterPreset(trimmedName, payload);
      await this.loadFilterPresets();
      this.setActiveFilterPreset(trimmedName);
      this.showTransientStatus(`${trimmedName} został zapisany ${formatStatusDate(new Date())}`);
      await this.createAutoFilterFolder();
    } catch (error) {
      this.showStatusMessage(error.message || "Nie udało się zapisać filtrów.");
    }
  }

  async createAutoFilterFolder() {
    if (!this.uiState.autoFilterFolder) return;
    const context = this.getFilteredExportContext();
    if (!context.list.length) {
      this.showStatusMessage("Brak albumów do zapisania w automatycznym folderze.");
      return;
    }
    const containerName = this.dom.containerSelect?.value;
    if (!containerName || containerName === "__all__") {
      this.showStatusMessage("Wybierz konkretny kontener, aby zapisać folder z filtrem.");
      return;
    }

    let collectionName = this.uiState.activeCollection || "__all__";
    if (collectionName === "__all__") {
      collectionName = this.store.containerMeta.get(containerName)?.collection || "brak";
    }
    this.store.ensureContainerEntry(containerName, collectionName);

    const baseName = this.buildFilterFolderName();
    let folderName = baseName;
    let counter = 1;
    while (this.store.foldersList.has(folderName)) {
      folderName = `${baseName}_${counter}`;
      counter += 1;
    }

    this.store.ensureFolderEntry(folderName, containerName);
    const { added } = this.store.addAlbumsToFolder(context.list, folderName);
    if (!added) {
      this.showStatusMessage("Nie dodano albumów do folderu filtrów.");
      return;
    }
    this.markFoldersPending();
    this.processAndRender();
    this.showTransientStatus(`☑ Utworzono folder: ${folderName}`);
  }

  handlePresetSelectionChange(event) {
    const selected = event.target.value;
    this.uiState.activeFilterPreset = selected;
    if (selected === "__none__") {
      this.clearAllFilters();
      return;
    }
    const preset = this.uiState.filterPresets.find((item) => item.name === selected);
    if (preset) {
      this.applyFilterPreset(preset);
    }
  }

  applyFilterPreset(preset) {
    let payload = preset.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (error) {
        console.warn("Nie udało się odczytać zapisanych filtrów:", error);
        return;
      }
    }
    if (!payload || typeof payload !== "object") return;

    const { filterPanel } = this.dom;
    const labels = Array.isArray(payload.labels) ? payload.labels : Array.from(LABEL_MAP.keys());
    const selectors = Array.isArray(payload.selectors) ? payload.selectors : [...SELECTOR_VALUES];

    this.uiState.selectedLabels.clear();
    labels.forEach((label) => this.uiState.selectedLabels.add(label));
    this.uiState.selectedSelectors.clear();
    selectors.forEach((selector) => this.uiState.selectedSelectors.add(selector));

    if (filterPanel) {
      filterPanel.querySelectorAll('.filter-chip--selection input[type="checkbox"]').forEach((cb) => {
        const shouldCheck =
          this.uiState.selectedSelectors.has(cb.value) || this.uiState.selectedLabels.has(cb.value);
        cb.checked = shouldCheck;
      });
    }

    if (this.dom.searchInput) {
      this.dom.searchInput.value = payload.searchTerm || "";
    }

    this.setYearControlValue(this.dom.releaseYearFromControl, payload.releaseYearFrom || "__all__", { silent: true });
    this.setCycleButtonValue(this.dom.releaseMonthFrom, payload.releaseMonthFrom || "__all__", { silent: true });
    this.setYearControlValue(this.dom.releaseYearToControl, payload.releaseYearTo || "__all__", { silent: true });
    this.setCycleButtonValue(this.dom.releaseMonthTo, payload.releaseMonthTo || "__all__", { silent: true });

    const parseNullableNumber = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const parseNullableInt = (value) => {
      const parsed = parseNullableNumber(value);
      return Number.isInteger(parsed) ? parsed : null;
    };
    const parsedHeardMin = parseNullableInt(payload.heardMin);
    const parsedHeardMax = parseNullableInt(payload.heardMax);
    this.uiState.heardRange = {
      min: parsedHeardMin,
      max: parsedHeardMax
    };
    this.normalizeHeardRange();
    this.updateHeardRangeDisplay();

    const parsedDurationMin = parseNullableNumber(payload.durationMin);
    const parsedDurationMax = parseNullableNumber(payload.durationMax);
    this.uiState.durationRange = {
      min: Number.isFinite(parsedDurationMin) ? parsedDurationMin : null,
      max: Number.isFinite(parsedDurationMax) ? parsedDurationMax : null
    };
    if (this.dom.durationRangeMinInput) {
      this.dom.durationRangeMinInput.value = this.uiState.durationRange.min ?? "";
    }
    if (this.dom.durationRangeMaxInput) {
      this.dom.durationRangeMaxInput.value = this.uiState.durationRange.max ?? "";
    }

    const allowedSort = new Set(["release_desc", "release_asc", "duration_asc", "duration_desc"]);
    this.uiState.sortMode = allowedSort.has(payload.sortMode) ? payload.sortMode : "release_desc";
    this.store.setSortMode(this.uiState.sortMode);
    this.updateTimeSortButtons();

    this.uiState.skipFolderFiltering = payload.skipFolderFiltering ?? true;
    if (this.dom.skipFolderFilteringInput) {
      this.dom.skipFolderFilteringInput.checked = this.uiState.skipFolderFiltering;
      this.updateSwitchLabels(
        this.dom.skipFolderFilteringInput,
        this.dom.skipFolderFilteringLabels?.left,
        this.dom.skipFolderFilteringLabels?.right
      );
    }

    this.uiState.showFavorites = payload.showFavorites ?? true;
    if (this.dom.showFavoritesInput) {
      this.dom.showFavoritesInput.checked = this.uiState.showFavorites;
    }
    const refreshMode = payload.foldersRefreshMode === "MANUAL" ? "MANUAL" : "AUTO";
    this.toggleFoldersRefreshMode(refreshMode === "AUTO");
    if (this.dom.foldersRefreshModeInput) {
      this.dom.foldersRefreshModeInput.checked = refreshMode === "AUTO";
      this.updateSwitchLabels(
        this.dom.foldersRefreshModeInput,
        this.dom.foldersRefreshModeLabels?.left,
        this.dom.foldersRefreshModeLabels?.right
      );
    }

    if (this.dom.containerSelect) {
      this.dom.containerSelect.value = payload.containerFilter || "__all__";
    }
    if (this.dom.folderSelect) {
      this.dom.folderSelect.value = payload.folderFilter || "__all__";
    }

    this.setActiveFilterPreset(preset.name, { silent: true });
    const parsedPage = Number(payload.currentPage);
    if (Number.isInteger(parsedPage) && parsedPage >= 0) {
      this.setCurrentPage(parsedPage);
    } else {
      this.resetCurrentPage();
    }
    this.processAndRender();
  }

  async handlePresetRename() {
    const currentName = this.uiState.activeFilterPreset;
    if (!currentName || currentName === "__none__") return;
    const nextName = await this.promptForPresetName({
      title: "Podaj nową nazwę zestawu filtrów",
      defaultValue: currentName
    });
    const trimmedNext = nextName?.trim();
    if (!trimmedNext || trimmedNext === currentName) return;
    if (trimmedNext.length > 30) {
      this.showStatusMessage("Nazwa filtra może mieć maksymalnie 30 znaków.");
      return;
    }
    try {
      await renameFilterPreset(currentName, trimmedNext);
      await this.loadFilterPresets();
      this.setActiveFilterPreset(trimmedNext);
      this.showTransientStatus(
        `${trimmedNext} zapisano edycję nazwy filtrów ${formatStatusDate(new Date())}`
      );
    } catch (error) {
      this.showStatusMessage(error.message || "Nie udało się zmienić nazwy filtrów.");
    }
  }

  async handlePresetDelete() {
    const currentName = this.uiState.activeFilterPreset;
    if (!currentName || currentName === "__none__") return;

    // UWAGA: nie używamy native `confirm()` w Electronie, bo potrafi rozwalić focus/klawiaturę
    // (objaw: w modalu da się tylko backspace, a pisanie wraca dopiero po wciśnięciu ALT).
    // Usuwamy filtr od razu – zgodnie z założeniem UI: DELETE = DELETE.
    try {
      await deleteFilterPreset(currentName);
      await this.loadFilterPresets();
      this.setActiveFilterPreset("__none__");
      this.showTransientStatus(`${currentName} został usunięty ${formatStatusDate(new Date())}`);
    } catch (error) {
      this.showStatusMessage(error.message || "Nie udało się usunąć filtrów.");
    }
  }

  async loadInitialData() {
  try {
      this.startOperation("🔌 Łączenie z SQLite / bazą danych i wczytywanie danych...");
      this.startProgress("Wczytywanie danych z SQLite / bazy danych...");
      const response = await this.reloadFromDatabase(false);
      if (response?.records) {
        this.finishProgress(`🔄 Wczytano ${response.records.length} rekordów z SQLite / bazy danych.`);
      } else {
        this.finishProgress("🔄 Wczytano dane z SQLite / bazy danych.");
      }
      this.uiState.autoDataLoaded = true;
    } catch (error) {
      console.warn("Nie udało się pobrać danych z API:", error);
      if (!this.uiState.loadRetryTimer) {
        this.uiState.loadRetryTimer = setTimeout(() => {
          this.uiState.loadRetryTimer = null;
          this.loadInitialData();
        }, 6000);
      }
      this.stopProgress();
    } finally {
      this.finishOperation();
    }
  }

  async reloadFromDatabase(showFeedback = true) {
    const response = await fetchWorkbook();
    if (!response || !Array.isArray(response.records)) {
      throw new Error("API nie zwróciło poprawnej listy rekordów");
    }
    this.applyRecordsList(
      {
        records: response.records,
        collections: response.collections || [],
        containers: response.containers || [],
        folders: response.folders || [],
        albumFolders: response.albumFolders || []
      },
      {
        sheetName: response.sheet_name,
        fileName: response.file_name,
        timestamp: response.updated_at || Date.now()
      }
    );
    this.uiState.autoDataLoaded = true;
    if (showFeedback) {
      this.uiState.pendingStatusMessage = `🔄 Odświeżono ${response.records.length} rekordów z SQLite / bazy danych.`;
    }
    return response;
  }

  applyRecordsList(payload, meta = {}) {
    this.store.loadFromPayload(payload, meta);
    const appliedStored = this.applyStoredSelectionsOnce();
    if (!appliedStored) {
      this.rebuildCollectionSelect();
      this.rebuildContainerSelect();
      this.rebuildFolderSelect();
    }
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
    const { releaseMonthFrom, releaseYearFrom, releaseMonthTo, releaseYearTo, searchInput } = this.dom;

    const buildRangeTimestamp = (yearSelect, monthSelect, isEnd) => {
      if (!yearSelect || yearSelect.value === "__all__") return null;
      const year = parseInt(yearSelect.value, 10);
      if (!Number.isInteger(year)) return null;
      const monthValue = monthSelect && monthSelect.value !== "__all__" ? parseInt(monthSelect.value, 10) : null;
      if (Number.isInteger(monthValue)) {
        if (isEnd) {
          return Math.floor(new Date(year, monthValue, 0, 23, 59, 59).getTime() / 1000);
        }
        return Math.floor(new Date(year, monthValue - 1, 1).getTime() / 1000);
      }
      if (isEnd) {
        return Math.floor(new Date(year, 11, 31, 23, 59, 59).getTime() / 1000);
      }
      return Math.floor(new Date(year, 0, 1).getTime() / 1000);
    };

    let releaseStartTs = buildRangeTimestamp(releaseYearFrom, releaseMonthFrom, false);
    let releaseEndTs = buildRangeTimestamp(releaseYearTo, releaseMonthTo, true);
    if (releaseStartTs !== null && releaseEndTs !== null && releaseStartTs > releaseEndTs) {
      [releaseStartTs, releaseEndTs] = [releaseEndTs, releaseStartTs];
    }
    const filters = {
      releaseStartTs,
      releaseEndTs,
      searchTerm: searchInput?.value || "",
      labels: this.uiState.selectedLabels,
      selectors: this.uiState.selectedSelectors,
      heardMin: this.uiState.heardRange.min,
      heardMax: this.uiState.heardRange.max,
      durationMin: this.uiState.durationRange.min,
      durationMax: this.uiState.durationRange.max,
      showFavorites: this.uiState.showFavorites
    };
    this.store.setLabelSelection(this.uiState.selectedLabels);
    this.store.setSelectorSelection(this.uiState.selectedSelectors);
    this.store.setSortMode(this.uiState.sortMode);
    const filtersChanged = this.store.applyFilters(filters);
    const skipToggleChanged = this.uiState.lastSkipFolderFiltering !== this.uiState.skipFolderFiltering;
    if (filtersChanged || this.store.indexesDirty || skipToggleChanged) {
      this.store.rebuildCategories();
    }
    if (this.uiState.skipFolderFiltering) {
      this.store.rebuildFolderView({ ignoreFilters: true });
    }
    this.uiState.lastSkipFolderFiltering = this.uiState.skipFolderFiltering;
    this.updateNavCounts();
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    if (this.uiState.currentCategory !== "FD" || !this.uiState.foldersNeedRefresh) {
      this.renderAlbumsPage();
    }
    this.updateFilterTabIndicators();
  }

  updateNavCounts() {
    const { countDB, newCounter, originalCounter, copyCounter } = this.dom;
    if (countDB) countDB.textContent = `(${this.store.categorized.DB.length})`;
    const newCount = this.store.categorized.NR.length;
    const updateCount = this.store.categorized.DB.reduce(
      (acc, album) => acc + (this.uiState.updateDbLinks?.has(album.link) ? 1 : 0),
      0
    );
    if (newCounter) {
      if (newCount && updateCount) {
        newCounter.textContent = `NEW / UPDATE ${newCount + updateCount}`;
      } else if (newCount) {
        newCounter.textContent = `NEW ${newCount}`;
      } else if (updateCount) {
        newCounter.textContent = `UPDATE ${updateCount}`;
      } else {
        newCounter.textContent = "NEW / UPDATE 0";
      }
    }
    const assignmentCounts = this.store.getAssignmentCounts();
    if (originalCounter) originalCounter.textContent = `Z ${assignmentCounts.assigned}`;
    if (copyCounter) copyCounter.textContent = `B ${assignmentCounts.unassigned}`;
  }

  renderCategory(category) {
    this.uiState.pageByCategory[this.uiState.currentCategory] = this.uiState.currentPage;
    this.uiState.currentCategory = category;
    this.setCurrentPage(this.getStoredPage(category));
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
    const {
      folderSelect,
      containerSelect,
      albumsContainer,
      pagination
    } = this.dom;
    const folderFilter = folderSelect?.value;
    const containerFilter = containerSelect?.value;
    const { pageItems, total, totalPages, currentPage } = this.store.getPagedCategory(
      this.uiState.currentCategory,
      this.uiState.currentPage,
      { folderFilter, containerFilter }
    );

    this.setCurrentPage(currentPage);
    if (albumsContainer) {
      albumsContainer.innerHTML = "";
      pageItems.forEach((album) => {
        const card = this.createAlbumCard(album);
        albumsContainer.appendChild(card);
      });
    }

    this.renderPagination(totalPages, currentPage);
  }

  buildPaginationPages(totalPages, currentPage) {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, idx) => idx);
    }

    const pages = [];
    const firstPage = 0;
    const lastPage = totalPages - 1;
    const windowStart = Math.max(currentPage - 2, 1);
    const windowEnd = Math.min(currentPage + 2, lastPage - 1);

    pages.push(firstPage);

    if (windowStart > 1) {
      pages.push("ellipsis");
    } else {
      for (let i = 1; i < windowStart; i += 1) {
        pages.push(i);
      }
    }

    for (let i = windowStart; i <= windowEnd; i += 1) {
      pages.push(i);
    }

    if (windowEnd < lastPage - 1) {
      pages.push("ellipsis");
    } else {
      for (let i = windowEnd + 1; i < lastPage; i += 1) {
        pages.push(i);
      }
    }

    pages.push(lastPage);
    return pages;
  }

  renderPagination(totalPages, currentPage) {
    const { pagination, pageInfo } = this.dom;
    if (!pagination) return;

    if (pageInfo) {
      pageInfo.textContent = totalPages
        ? `Strona ${currentPage + 1} z ${totalPages}`
        : "Strona 0 z 0";
    }

    pagination.dataset.actpage = totalPages ? currentPage + 1 : 0;
    pagination.dataset.totalpages = String(totalPages);

    const fragment = document.createDocumentFragment();
    const createButton = ({ label, page, disabled = false }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-chip pagination__btn";
      btn.dataset.page = String(page);
      const span = document.createElement("span");
      span.className = "menu-chip__inner";
      span.textContent = label;
      btn.appendChild(span);
      if (disabled) btn.disabled = true;
      return btn;
    };

    fragment.appendChild(
      createButton({ label: "<<", page: "first", disabled: currentPage <= 0 || totalPages === 0 })
    );
    fragment.appendChild(
      createButton({ label: "< PREV", page: "prev", disabled: currentPage <= 0 || totalPages === 0 })
    );

    const center = document.createElement("div");
    center.className = "pagination__center";
    const count = document.createElement("span");
    count.className = "pagination__count";
    count.textContent = totalPages ? `${currentPage + 1} z ${totalPages}` : "0 z 0";

    const selectWrap = document.createElement("div");
    selectWrap.className = "menu-select pagination__select";
    const select = document.createElement("select");
    select.className = "pagination__pages";
    select.disabled = totalPages <= 1;
    if (totalPages === 0) {
      select.appendChild(new Option("0", "0"));
    } else {
      for (let i = 0; i < totalPages; i += 1) {
        const option = new Option(`Strona ${i + 1}`, String(i));
        select.appendChild(option);
      }
      select.value = String(currentPage);
    }
    selectWrap.appendChild(select);

    center.appendChild(count);
    center.appendChild(selectWrap);
    fragment.appendChild(center);

    fragment.appendChild(
      createButton({
        label: "NEXT >",
        page: "next",
        disabled: currentPage >= totalPages - 1 || totalPages === 0
      })
    );
    fragment.appendChild(
      createButton({
        label: ">>",
        page: "last",
        disabled: currentPage >= totalPages - 1 || totalPages === 0
      })
    );

    pagination.innerHTML = "";
    if (pageInfo) {
      pagination.appendChild(pageInfo);
    }
    pagination.appendChild(fragment);
  }

  buildAlbumEmbedLink(link) {
    if (!link) return "";
    try {
      const url = new URL(link);
      const host = url.hostname.replace(/^www\./, "");
      const path = url.pathname.replace(/\/+$/, "");
      if (host === "tidal.com") {
        const match = path.match(/\/(?:browse\/)?album\/(\d+)/i);
        if (match) {
          return `https://embed.tidal.com/albums/${match[1]}`;
        }
      }
    } catch (error) {
      return link;
    }
    return link;
  }

  buildTidalProtocolLink(link) {
    if (!link) return "";
    try {
      const url = new URL(link);
      const host = url.hostname.replace(/^www\./, "");
      const path = url.pathname.replace(/\/+$/, "");
      if (host === "tidal.com") {
        const match = path.match(/\/(?:browse\/)?album\/(\d+)/i);
        if (match) {
          return `tidal://browse/album/${match[1]}`;
        }
      }
    } catch (error) {
      return "";
    }
    return "";
  }

  createAlbumCard(entry) {
    const { folderSelect } = this.dom;
    const album = entry.album || entry;
    const card = document.createElement("a");
    card.href = this.buildAlbumEmbedLink(album.link) || "#";
    card.target = "_blank";
    card.className = "album-card";
    card.title = `${album.title} — ${album.artist}`;

    const favoriteCorner = document.createElement("span");
    favoriteCorner.className = "album-favorite-corner";
    if (album.favorite && this.uiState.showFavoriteCorners) {
      favoriteCorner.classList.add("active");
    }

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
    titleText.textContent = album.title;

    const isUpdateImport = this.uiState.updateDbLinks?.has(album.link);
    const isNewRelease = this.store.isNewRelease(album);
    if (isUpdateImport || isNewRelease) {
      const badge = document.createElement("span");
      badge.className = "album-new-flag";
      if (isUpdateImport && !isNewRelease) {
        badge.classList.add("album-new-flag--update");
        badge.textContent = "UPDATE";
      } else {
        badge.textContent = "NEW";
      }
      titleRow.appendChild(badge);
    }

    titleRow.appendChild(titleText);

    const artist = document.createElement("div");
    artist.className = "album-artist";
    artist.textContent = album.artist;

    const meta = document.createElement("div");
    meta.className = "album-meta";
    const dot = document.createElement("span");
    dot.className = "folder-dot";
    const folderList = this.store.getAlbumFolderList(album);
    const selectedFolder = folderSelect?.value;
    const hasSelectedFolder = selectedFolder && selectedFolder !== "__all__";
    const isAssigned = hasSelectedFolder ? folderList.includes(selectedFolder) : folderList.length > 0;
    dot.classList.add(isAssigned ? "assigned" : "unassigned");
    if (hasSelectedFolder) {
      dot.title = isAssigned ? `Folder: ${selectedFolder}` : `Brak w folderze: ${selectedFolder}`;
    } else {
      dot.title = isAssigned ? `Foldery: ${folderList.join(", ")}` : "Brak folderu";
    }
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
    metaParts.push(String(album.heard ?? 0));

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

    const idBadge = document.createElement("span");
    idBadge.className = "album-id-badge";
    idBadge.textContent = `ID: ${album.id_albumu ?? "brak"}`;
    info.appendChild(idBadge);

    const code = LABEL_MAP.get(album.label) || "00A";
    const icon = document.createElement("img");
    icon.className = "album-label-icon";
    icon.src = `LABELS/${code}.svg`;
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
      if (
        this.uiState.keyModifiers.delete &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey &&
        event.button === 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        await this.handleDeleteAlbum(album);
        return;
      }
      if (
        this.uiState.keyModifiers.favorite &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey &&
        event.button === 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.store.setAlbumFavorite(album, true);
        this.processAndRender();
        return;
      }
      if (
        this.uiState.keyModifiers.copy &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey &&
        event.button === 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        await this.copyAlbumDetails(album);
        return;
      }
      if (event.ctrlKey && !event.shiftKey && !event.metaKey && event.button === 0) {
        event.preventDefault();
        const { changed } = this.store.adjustHeard(album, 1);
        if (changed) {
          this.processAndRender();
        }
        return;
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.button === 0) {
        event.preventDefault();
        if (this.uiState.operationInProgress) return;
        const target = folderSelect?.value;
        if (target && target !== "__all__") {
          const folderList = this.store.getAlbumFolderList(album);
          if (folderList.includes(target)) {
            const albumLabel = truncateForStatus(album.title || "album", 15);
            const folderLabel = truncateForStatus(target, 15);
            this.showStatusMessage(`Album ${albumLabel} znajduje się już w folderze ${folderLabel}.`);
            return;
          }
          await this.performAlbumOperation("assign", () => {
            this.store.addAlbumToFolder(album, target);
            this.markFoldersPending();
            // bez processAndRender – zajmie się tym performAlbumOperation + scheduler
          });
        } else {
          this.showStatusMessage('Wybierz konkretny folder z listy (nie "wszystkie").');
        }
      }
    });

    card.addEventListener("contextmenu", async (event) => {
      if (
        this.uiState.keyModifiers.favorite &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.store.setAlbumFavorite(album, false);
        this.processAndRender();
        return;
      }
      if (event.ctrlKey && !event.shiftKey && !event.metaKey) {
        event.preventDefault();
        const { changed } = this.store.adjustHeard(album, -1);
        if (changed) {
          this.processAndRender();
        }
        return;
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (this.uiState.operationInProgress) return;
        const removalTarget =
          entry.folder ||
          (folderSelect?.value && folderSelect.value !== "__all__" ? folderSelect.value : null);
        if (removalTarget && removalTarget !== "brak") {
          await this.performAlbumOperation("remove", () => {
            this.store.removeAlbumFromFolder(album, removalTarget);
            this.markFoldersPending();
          });
        }
        return;
      }

      const tidalProtocolLink = this.buildTidalProtocolLink(album.link);
      if (tidalProtocolLink) {
        event.preventDefault();
        if (window.electronAPI?.openExternal) {
          await window.electronAPI.openExternal(tidalProtocolLink);
        } else {
          window.open(tidalProtocolLink);
        }
      }
    });

    card.appendChild(img);
    card.appendChild(info);
    card.appendChild(icon);
    card.appendChild(favoriteCorner);
    return card;
  }

  cycleSelector(album, image, card) {
    const current = album.selector || "N";
    const idx = SELECTOR_VALUES.indexOf(current);
    const next = SELECTOR_VALUES[(idx + 1) % SELECTOR_VALUES.length];
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

  async copyAlbumDetails(album) {
    if (!album) return;
    const title = String(album.title || "").trim();
    const artist = String(album.artist || "").trim();
    const text = [title, artist].filter(Boolean).join(" ").trim();
    if (!text) {
      this.showStatusMessage("Brak danych do skopiowania.");
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      this.showStatusMessage("Skopiowano nazwę albumu i wykonawcę.");
    } catch (error) {
      this.showStatusMessage("Nie udało się skopiować danych albumu.");
      console.warn("Clipboard error:", error);
    }
  }

  async handleDeleteAlbum(album) {
    if (!album) return;
    if (this.uiState.operationInProgress) return;
    const title = album.title || "brak";
    const artist = album.artist || "brak";
    const albumId = album.id_albumu ?? "brak";
    const confirmed = await this.confirmModal({
      title: "Usuń album z bazy danych",
      message: `Czy na pewno usunąć album?\n${title} ${artist}\nID: ${albumId}`,
      confirmText: "USUŃ",
      cancelText: "ANULUJ"
    });
    if (!confirmed) return;
    const result = this.store.removeAlbumFromDatabase(album);
    if (result.changed) {
      if (album.link && this.uiState.updateDbLinks?.has(album.link)) {
        this.uiState.updateDbLinks.delete(album.link);
      }
      this.markFoldersPending();
      this.processAndRender();
      this.showStatusMessage("Usunięto album z bazy danych.");
    }
  }

  rebuildContainerSelect() {
    const { containerSelect } = this.dom;
    if (!containerSelect) return;
    const selected = containerSelect.value;
    containerSelect.innerHTML = "";
    const counts = this.store.getContainerCounts();
    const collectionFilter = this.uiState.activeCollection;
    const containers =
      collectionFilter && collectionFilter !== "__all__"
        ? this.store.getContainersForCollection(collectionFilter)
        : Array.from(this.store.containersList);
    const sorted = containers.sort((a, b) => a.localeCompare(b, "pl"));
    const createOption = (value, label, color) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${label} (${counts[value] || 0})`;
      option.style.color = color;
      return option;
    };
    containerSelect.appendChild(createOption("__all__", "wszystkie kontenery", "#1e1e1e"));
    sorted.forEach((name) => {
      const color = name === "brak" ? "#7a7a7a" : "#1e1e1e";
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

  rebuildCollectionSelect() {
    const { collectionSelect } = this.dom;
    if (!collectionSelect) return;
    const current = this.uiState.activeCollection || "__all__";
    collectionSelect.innerHTML = "";
    const sorted = Array.from(this.store.collectionsList).sort((a, b) => a.localeCompare(b, "pl"));
    const createOption = (value, label, color) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.style.color = color;
      return option;
    };
    collectionSelect.appendChild(createOption("__all__", "wszystkie kolekcje", "#1e1e1e"));
    sorted.forEach((name) => {
      const color = name === "brak" ? "#7a7a7a" : "#1e1e1e";
      const option = createOption(name, truncateName(name, 32), color);
      option.title = name;
      collectionSelect.appendChild(option);
    });
    if (current && Array.from(collectionSelect.options).some((opt) => opt.value === current)) {
      collectionSelect.value = current;
    } else {
      collectionSelect.value = "__all__";
      this.uiState.activeCollection = "__all__";
    }
  }

  rebuildFolderSelect() {
    const { folderSelect, containerSelect } = this.dom;
    if (!folderSelect) return;
    const selected = folderSelect.value;
    folderSelect.innerHTML = "";
    const containerFilter = containerSelect?.value && containerSelect.value !== "__all__" ? containerSelect.value : null;
    const counts = this.store.getFolderCounts(containerFilter);
    const collectionFilter = this.uiState.activeCollection;
    const folderNames = containerFilter
      ? this.store.getFoldersForContainer(containerFilter)
      : collectionFilter && collectionFilter !== "__all__"
        ? this.store.getFoldersForCollection(collectionFilter)
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
      const color = name === "brak" ? "#7a7a7a" : "#1e1e1e";
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
    if (this.uiState.foldersRefreshMode === "AUTO" && !this.uiState.operationInProgress) {
      this.refreshFoldersView({ auto: true });
    }
  }

  clearFoldersPending() {
    const { foldersRefreshBtn } = this.dom;
    this.uiState.foldersNeedRefresh = false;
    foldersRefreshBtn?.classList.remove("needs-refresh");
  }

  toggleFoldersRefreshMode(forceAuto = null) {
    if (typeof forceAuto === "boolean") {
      this.uiState.foldersRefreshMode = forceAuto ? "AUTO" : "MANUAL";
    } else {
      this.uiState.foldersRefreshMode = this.uiState.foldersRefreshMode === "AUTO" ? "MANUAL" : "AUTO";
    }
    if (this.uiState.foldersRefreshMode === "AUTO" && this.uiState.foldersNeedRefresh) {
      this.refreshFoldersView({ auto: true });
    }
  }

  async refreshFoldersView({ auto = false } = {}) {
    if (!this.uiState.foldersNeedRefresh && !auto) return;
    if (this.uiState.operationInProgress) return;
    this.clearFoldersPending();
    this.startOperation("🔁 Przeliczanie folderów i kontenerów...");
    try {
      this.processAndRender();
    } finally {
      this.finishOperation();
    }
  }

  startProgress(label = "") {
    const { progressContainer, progressFill, progressLabel } = this.dom;
    if (!progressContainer || !progressFill) return;
    clearInterval(this.progressInterval);
    this.progressValue = 0;
    progressFill.style.width = "0%";
    progressContainer.classList.remove("hidden");
    if (progressLabel) progressLabel.textContent = label;
    this.progressInterval = setInterval(() => {
      const increment = Math.random() * 12 + 4;
      this.progressValue = Math.min(this.progressValue + increment, 94);
      progressFill.style.width = `${this.progressValue}%`;
    }, 220);
  }

  finishProgress(message = "") {
    const { progressContainer, progressFill, progressLabel } = this.dom;
    if (!progressContainer || !progressFill) return;
    clearInterval(this.progressInterval);
    this.progressInterval = null;
    this.progressValue = 100;
    progressFill.style.width = "100%";
    if (progressLabel && message) progressLabel.textContent = message;
    setTimeout(() => {
      progressContainer.classList.add("hidden");
      progressFill.style.width = "0%";
    }, 450);
    if (message) {
      this.uiState.pendingStatusMessage = message;
    }
  }

  stopProgress() {
    const { progressContainer, progressFill } = this.dom;
    clearInterval(this.progressInterval);
    this.progressInterval = null;
    this.progressValue = 0;
    if (progressContainer) progressContainer.classList.add("hidden");
    if (progressFill) progressFill.style.width = "0%";
  }

  startOperation(message) {
    const { fileStatus } = this.dom;
    this.uiState.operationInProgress = true;
    if (fileStatus) {
      this.uiState.fileStatusBackup = fileStatus.textContent || "";
      fileStatus.classList.remove("hidden");
      fileStatus.textContent = message;
      fileStatus.classList.remove("status-success");
      fileStatus.classList.add("busy");
    }
  }

  finishOperation() {
    const { fileStatus } = this.dom;
    this.uiState.operationInProgress = false;
    if (fileStatus) {
      fileStatus.classList.remove("busy");
      if (this.uiState.pendingStatusMessage) {
        this.showTransientStatus(this.uiState.pendingStatusMessage);
        this.uiState.pendingStatusMessage = "";
      } else {
        this.refreshFileStatus();
        if (!fileStatus.textContent && this.uiState.fileStatusBackup) {
          fileStatus.textContent = this.uiState.fileStatusBackup;
        }
      }
    }
    this.uiState.fileStatusBackup = "";
    if (this.uiState.foldersRefreshMode === "AUTO" && this.uiState.foldersNeedRefresh) {
      this.refreshFoldersView({ auto: true });
    }
  }

  showStatusMessage(message, duration = 3000) {
    if (!message) return;
    if (this.uiState.operationInProgress) {
      this.uiState.pendingStatusMessage = message;
      return;
    }
    this.showTransientStatus(message, duration);
  }

  async performAlbumOperation(type, fn) {
  const message =
      type === "remove"
        ? "Trwa usuwanie albumu z folderu, proszę czekać..."
        : "Trwa przypisywanie albumu do folderu, proszę czekać...";
    try {
      this.startOperation(message);
      await Promise.resolve(fn());
      this.scheduleProcessAndRender();
    } catch (err) {
      this.showStatusMessage(err.message || err);
    } finally {
      this.finishOperation();
    }
  }

  async handleSave() {
  if (!this.store.records.length) {
    this.showStatusMessage("📂 Brak danych do zapisania! Najpierw pobierz dane z SQLite / bazy danych.");
    return;
  }

  try {
    this.startOperation("💾 Zapisuję dane do SQLite / bazy danych...");
    this.startProgress("Zapisywanie danych do SQLite / bazy danych...");

    const payload = {
      records: this.store.getSerializableRecords(),
      collections: this.store.getSerializableCollections(),
      containers: this.store.getSerializableContainers(),
      folders: this.store.getSerializableFolders(),
      albumFolders: this.store.getSerializableAlbumFolders(),
      sheetName: this.store.currentSheetName || "Sheet1"
    };
    const response = await updateWorkbook(payload);

    const message = response?.message || "✅ Zapisano dane w SQLite / bazie danych.";
    this.finishProgress(message);

    if (response?.updated_at) {
      this.store.setFileMeta({
        name: response.file_name || this.store.currentFileName,
        timestamp: response.updated_at || Date.now()
      });
      this.refreshFileStatus();
    }

    this.persistStoredSelections();
    this.persistActiveFilterPreset();
    this.flashFileUpdated();
  } catch (error) {
    this.showStatusMessage(`❌ Nie udało się zapisać danych: ${error.message}`);
    console.error("Błąd zapisu", error);
    this.stopProgress();
  } finally {
    this.finishOperation();
  }
  }

  async handleDatabaseBackup() {
    if (this.uiState.operationInProgress) return;
    let modalMessage = "";
    try {
      this.startOperation("🗄️ Tworzę kopię bazy danych SQLite...");

      const response = await backupDatabase();
      const fileName = response?.backupFileName || "music_database.sqlite";

      this.uiState.pendingStatusMessage = `✅ Zapisano backup bazy danych: ${fileName}.`;
      modalMessage = `✅ Backup bazy danych gotowy.\n📄 Plik: ${fileName}\n📂 Folder: ${response?.backupPath || ""}`;
    } catch (error) {
      this.showStatusMessage(`❌ Nie udało się wykonać backupu bazy danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
    if (modalMessage) {
      await this.infoModal({ title: "Backup bazy danych", message: modalMessage });
    }
  }

  async exportToXlsx() {
    let modalMessage = "";
    try {
       this.startOperation("📤 Eksportuję dane z SQLite / bazy danych do XLSX...");

      const directory = await this.getActiveDataDirectory("exportDb");
      if (!directory) {
        this.finishOperation();
        return;
      }

      const response = await exportWorkbookToFile({ directory });
      const summary = response?.summary || "✅ Eksport zakończony.";
      const fileName = response?.fileName || response?.filePath?.split(/[/\\]/).pop();

      this.uiState.pendingStatusMessage = summary.split("\n")[0];
      modalMessage = `${summary}\n📄 Plik: ${fileName || "music_database.xlsx"}\n📂 Zapisano w: ${response?.filePath || directory}`;
    } catch (error) {
      this.showStatusMessage(`❌ Nie udało się wyeksportować danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
    if (modalMessage) {
      await this.infoModal({ title: "Eksport danych", message: modalMessage });
    }
  }

  async importFromXlsx() {
    let modalMessage = "";
    try {
      this.startOperation("📥 Importuję dane z XLSX do SQLite / bazy danych...");

      const source = await this.resolveImportSource({ operationKey: "importDb", prefix: DATA_PREFIXES.importDb });
      if (!source) {
        this.finishOperation();
        return;
      }
      const confirmed = await this.confirmModal({
        title: "Potwierdź import",
        message: `Czy na pewno wczytać plik ${source.fileName} do bazy?`,
        confirmText: "TAK",
        cancelText: "NIE"
      });
      if (!confirmed) {
        this.finishOperation();
        return;
      }

      const response = await importWorkbookFromFile({
        directory: source.directory,
        filePath: source.filePath,
        prefix: DATA_PREFIXES.importDb
      });
      const summary = response?.summary || "✅ Import zakończony.";
      this.uiState.updateDbLinks = new Set();

      await this.reloadFromDatabase(false);
      this.uiState.pendingStatusMessage = summary.split("\n")[0];
      modalMessage = `${summary}\n📄 Plik: ${source.fileName}\n📂 Folder: ${source.directory}`;
    } catch (error) {
      this.showStatusMessage(`❌ Nie udało się zaimportować danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
    if (modalMessage) {
      await this.infoModal({ title: "Import danych", message: modalMessage });
    }
  }

  async importNewsFromXlsx() {
    let modalMessage = "";
    let skipReload = false;
    try {
      this.startOperation("📥 Importuję nowe rekordy z XLSX do SQLite / bazy danych...");

      const source = await this.resolveImportSource({ operationKey: "updateDb", prefix: DATA_PREFIXES.updateDb });
      if (!source) {
        this.finishOperation();
        return;
      }
      const confirmed = await this.confirmModal({
        title: "Potwierdź import",
        message: `Czy na pewno wczytać plik ${source.fileName} do bazy?`,
        confirmText: "TAK",
        cancelText: "NIE"
      });
      if (!confirmed) {
        this.finishOperation();
        return;
      }

      const response = await importNewsWorkbookFromFile({
        directory: source.directory,
        filePath: source.filePath,
        prefix: DATA_PREFIXES.updateDb
      });
      const summary = response?.summary || "✅ Dodano nowe rekordy.";
      this.uiState.updateDbLinks = new Set(response?.insertedLinks || []);
      const duplicateFileName = response?.duplicatesFileName;
      const duplicateFilePath = response?.duplicatesFilePath;
      const duplicateNote = duplicateFileName
        ? `\n📄 Duplikaty zapisano w: ${duplicateFileName}\n📂 Folder: ${duplicateFilePath || source.directory}`
        : "";

      const inserted = Number(response?.total ?? 0);
      if (inserted === 0) {
        this.uiState.pendingStatusMessage = summary.split("\n")[0];
        modalMessage = `${summary}\nℹ️ Dodano 0: wszystko było duplikatem (LINK) albo wiersze nie miały LINK.\n📂 Użyto pliku: ${source.fileName}\n📁 Folder: ${source.directory}${duplicateNote}`;
        skipReload = true;
      }

      if (!skipReload) {
        await this.reloadFromDatabase(false);
        this.uiState.pendingStatusMessage = summary.split("\n")[0];
        modalMessage = `${summary}\n📄 Plik: ${source.fileName}\n📂 Folder: ${source.directory}${duplicateNote}`;
      }
    } catch (error) {
      this.showStatusMessage(`❌ Nie udało się zaimportować nowych danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
    if (modalMessage) {
      await this.infoModal({ title: "Import nowych danych", message: modalMessage });
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

  getCustomCollectionCount() {
    let count = 0;
    this.store.collectionsList.forEach((name) => {
      if (name !== "brak") count += 1;
    });
    return count;
  }

  handleOperationsScopeChange(scope) {
    this.uiState.operationsScope = scope || "folders";
  }

  handleCollectionChange(value) {
    this.uiState.activeCollection = value || "__all__";
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    this.markFoldersPending();
    this.processAndRender();
  }

  async handleEntityAction(action) {
    const scope = this.uiState.operationsScope || "folders";
    if (scope === "collections") {
      if (action === "add") return this.handleCreateCollection();
      if (action === "edit") return this.handleEditCollection();
      if (action === "delete") return this.handleDeleteCollection();
    } else if (scope === "containers") {
      if (action === "add") return this.handleCreateContainer();
      if (action === "edit") return this.handleEditContainer();
      if (action === "delete") return this.handleDeleteContainer();
    }
    if (action === "add") return this.handleCreateFolder();
    if (action === "edit") return this.handleEditFolder();
    if (action === "delete") return this.handleDeleteFolder();
  }

  async handleCreateFolder() {
    if (this.getCustomFolderCount() >= 1000) {
      this.showStatusMessage("Osiągnięto limit 1000 folderów. Usuń istniejący folder, aby dodać nowy.");
      return;
    }
    const suggestedContainer =
      this.dom.containerSelect?.value && this.dom.containerSelect.value !== "__all__"
        ? this.dom.containerSelect.value
        : "brak";
    const dialog = await this.openEntityDialog({
      mode: "folder",
      title: "Nowy folder",
      defaultContainer: suggestedContainer,
      collectionFilter: this.uiState.activeCollection
    });
    if (!dialog) return;
    const name = dialog.name;
    if (!this.isValidEntityName(name)) {
      this.showStatusMessage("Nieprawidłowa nazwa folderu. Dozwolone maks. 50 znaków (w tym spacje).");
      return;
    }
    if (this.store.foldersList.has(name)) {
      this.showStatusMessage("Folder o takiej nazwie już istnieje.");
      return;
    }
    const container = dialog.container || "brak";
    this.store.ensureFolderEntry(name, container);
    this.store.ensureContainerEntry(container).folders.add(name);
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = name;
    this.markFoldersPending();   // tylko flaga
    this.showTransientStatus(`☑ Utworzono folder: ${name}`);
  }

  async handleEditFolder() {
    const selected = this.dom.folderSelect?.value;
    if (!selected || selected === "__all__") {
      this.showStatusMessage("Wybierz folder do edycji.");
      return;
    }
    const entry = this.store.ensureFolderEntry(selected, "brak");
    const dialog = await this.openEntityDialog({
      mode: "folder",
      title: `Edytuj folder: ${selected}`,
      defaultName: selected,
      defaultContainer: entry.container,
      collectionFilter: this.uiState.activeCollection
    });
    if (!dialog) return;
    if (!this.isValidEntityName(dialog.name)) {
      this.showStatusMessage("Nieprawidłowa nazwa folderu.");
      return;
    }
    if (dialog.name !== selected && this.store.foldersList.has(dialog.name)) {
      this.showStatusMessage("Folder o takiej nazwie już istnieje.");
      return;
    }
     this.renameFolder(selected, dialog.name, dialog.container);
    this.processAndRender();
    this.showStatusMessage("Zaktualizowano folder.");
  }

  async handleDeleteFolder() {
    const selected = this.dom.folderSelect?.value;
    if (!selected || selected === "__all__") {
      this.showStatusMessage("Wybierz folder do usunięcia.");
      return;
    }
    if (!(await this.confirmModal({ title: "Potwierdź", message: `Czy na pewno usunąć folder "${selected}"?`, confirmText: "TAK", cancelText: "NIE" }))) return;
    this.removeFolder(selected);
    this.processAndRender();
    this.showStatusMessage("Folder usunięty.");
  }

  async handleCreateContainer() {
    if (this.getCustomContainerCount() >= 1000) {
      this.showStatusMessage("Osiągnięto limit 1000 kontenerów. Usuń istniejący, aby dodać nowy.");
      return;
    }
    const suggestedCollection =
      this.uiState.activeCollection && this.uiState.activeCollection !== "__all__"
        ? this.uiState.activeCollection
        : "brak";
    const dialog = await this.openEntityDialog({
      mode: "container",
      title: "Nowy kontener",
      defaultCollection: suggestedCollection
    });
    if (!dialog) return;
    const name = dialog.name;
    if (!this.isValidEntityName(name)) {
      this.showStatusMessage("Nieprawidłowa nazwa kontenera. Dozwolone maks. 50 znaków (w tym spacje).");
      return;
    }
    if (this.store.containersList.has(name)) {
      this.showStatusMessage("Kontener o takiej nazwie już istnieje.");
      return;
    }
    this.store.ensureContainerEntry(name, dialog.collection || "brak");
    if (dialog.collection && dialog.collection !== this.uiState.activeCollection) {
      this.uiState.activeCollection = dialog.collection;
      this.rebuildCollectionSelect();
    }
    this.rebuildContainerSelect();
    this.dom.containerSelect.value = name;
    this.rebuildFolderSelect();
    this.dom.folderSelect.value = "__all__";
    this.markFoldersPending();
    this.showTransientStatus(`☑ Utworzono kontener: ${name}`);
  }

  async handleEditContainer() {
    const selected = this.dom.containerSelect?.value;
    if (!selected || selected === "__all__" || selected === "brak") {
      this.showStatusMessage("Wybierz kontener do edycji.");
      return;
    }
    const currentCollection = this.store.containerMeta.get(selected)?.collection || "brak";
    const dialog = await this.openEntityDialog({
      mode: "container",
      title: `Edytuj kontener: ${selected}`,
      defaultName: selected,
      defaultCollection: currentCollection
    });
    if (!dialog) return;
    if (!this.isValidEntityName(dialog.name)) {
      this.showStatusMessage("Nieprawidłowa nazwa kontenera.");
      return;
    }
    if (dialog.name !== selected && this.store.containersList.has(dialog.name)) {
      this.showStatusMessage("Kontener o takiej nazwie już istnieje.");
      return;
    }
    this.renameContainer(selected, dialog.name);
    const collectionUpdate = dialog.collection
      ? this.store.setContainerCollection(dialog.name, dialog.collection)
      : { changed: false };
    if (collectionUpdate.changed) {
      this.markFoldersPending();
    }
    if (dialog.collection && dialog.collection !== this.uiState.activeCollection) {
      this.uiState.activeCollection = dialog.collection;
      this.rebuildCollectionSelect();
      this.rebuildContainerSelect();
      this.rebuildFolderSelect();
    }
    this.processAndRender();
    this.showStatusMessage("Zaktualizowano kontener.");
  }

  async handleDeleteContainer() {
    const selected = this.dom.containerSelect?.value;
    if (!selected || selected === "__all__" || selected === "brak") {
      this.showStatusMessage("Wybierz kontener do usunięcia.");
      return;
    }
    if (!(await this.confirmModal({ title: "Potwierdź", message: `Czy na pewno usunąć kontener "${selected}"?`, confirmText: "TAK", cancelText: "NIE" }))) return;
    this.removeContainer(selected);
    this.processAndRender();
    this.showStatusMessage("Kontener usunięty.");
  }

  async handleCreateCollection() {
    if (this.getCustomCollectionCount() >= 1000) {
      this.showStatusMessage("Osiągnięto limit 1000 kolekcji. Usuń istniejącą kolekcję, aby dodać nową.");
      return;
    }
    const dialog = await this.openEntityDialog({
      mode: "collection",
      title: "Nowa kolekcja"
    });
    if (!dialog) return;
    const name = dialog.name;
    if (!this.isValidEntityName(name)) {
      this.showStatusMessage("Nieprawidłowa nazwa kolekcji. Dozwolone maks. 50 znaków (w tym spacje).");
      return;
    }
    if (this.store.collectionsList.has(name)) {
      this.showStatusMessage("Kolekcja o takiej nazwie już istnieje.");
      return;
    }
    this.store.ensureCollectionEntry(name);
    this.rebuildCollectionSelect();
    if (this.dom.collectionSelect) {
      this.dom.collectionSelect.value = name;
      this.uiState.activeCollection = name;
    }
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    this.markFoldersPending();
    this.showTransientStatus(`☑ Utworzono kolekcję: ${name}`);
  }

  async handleEditCollection() {
    const selected = this.dom.collectionSelect?.value;
    if (!selected || selected === "__all__" || selected === "brak") {
      this.showStatusMessage("Wybierz kolekcję do edycji.");
      return;
    }
    const dialog = await this.openEntityDialog({
      mode: "collection",
      title: `Edytuj kolekcję: ${selected}`,
      defaultName: selected
    });
    if (!dialog) return;
    if (!this.isValidEntityName(dialog.name)) {
      this.showStatusMessage("Nieprawidłowa nazwa kolekcji.");
      return;
    }
    if (dialog.name !== selected && this.store.collectionsList.has(dialog.name)) {
      this.showStatusMessage("Kolekcja o takiej nazwie już istnieje.");
      return;
    }
    this.store.renameCollectionRecords(selected, dialog.name);
    this.rebuildCollectionSelect();
    if (this.dom.collectionSelect) {
      this.dom.collectionSelect.value = dialog.name;
      this.uiState.activeCollection = dialog.name;
    }
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    this.markFoldersPending();
    this.processAndRender();
    this.showStatusMessage("Zaktualizowano kolekcję.");
  }

  async handleDeleteCollection() {
    const selected = this.dom.collectionSelect?.value;
    if (!selected || selected === "__all__" || selected === "brak") {
      this.showStatusMessage("Wybierz kolekcję do usunięcia.");
      return;
    }
    if (!(await this.confirmModal({ title: "Potwierdź", message: `Czy na pewno usunąć kolekcję "${selected}"?`, confirmText: "TAK", cancelText: "NIE" }))) return;
    this.store.clearCollectionAssignments(selected);
    this.uiState.activeCollection = "__all__";
    this.rebuildCollectionSelect();
    this.rebuildContainerSelect();
    this.rebuildFolderSelect();
    this.markFoldersPending();
    this.processAndRender();
    this.showStatusMessage("Kolekcja usunięta.");
  }

  getFilteredExportContext() {
    const { folderSelect, containerSelect } = this.dom;
    const category = this.uiState.currentCategory || "DB";
    const folderFilter = folderSelect?.value;
    const containerFilter = containerSelect?.value;
    const list = this.store.getFilteredCategoryList(category, { folderFilter, containerFilter });

    const slugify = (value, fallback = "wyniki") => {
      if (!value) return fallback;
      const cleaned = String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "");
      return cleaned || fallback;
    };

    let scopeLabel = category;
    if (category === "FD") {
      if (folderFilter && folderFilter !== "__all__") scopeLabel = folderFilter;
      else if (containerFilter && containerFilter !== "__all__") scopeLabel = containerFilter;
      else scopeLabel = "folders";
    }

    const activeSelectors = Array.from(this.uiState.selectedSelectors || []).sort().join("");
    const selectorsLabel = activeSelectors && activeSelectors.length ? activeSelectors : "wszyscy";

    return { list, folderFilter, containerFilter, category, scopeLabel, selectorsLabel, slugify };
  }

  async exportFilteredSelection() {
    const context = this.getFilteredExportContext();

    if (!context.list.length) {
      this.showStatusMessage("Brak albumów do wyeksportowania dla wybranych filtrów.");
      return;
    }

    const headers = [
      "ID_ALBUMU",
      "SELECTOR",
      "HEARD",
      "FAVORITE",
      "LABEL",
      "LINK",
      "PICTURE",
      "ARTIST",
      "TITLE",
      "DURATION",
      "RELEASE_DATE"
    ];

    const data = context.list.map((rec) => {
      const album = rec.album || rec;
      return {
        ID_ALBUMU: album.id_albumu ?? "",
        SELECTOR: album.selector,
        HEARD: album.heard,
        FAVORITE: album.favorite ? 1 : 0,
        LABEL: album.label,
        LINK: album.link,
        PICTURE: album.picture,
        ARTIST: album.artist,
        TITLE: album.title,
        DURATION: album.duration,
        RELEASE_DATE: album.release_original ?? album.release_date
      };
    });

    const sheet = window.XLSX.utils.json_to_sheet(data, { header: headers, skipHeader: false });
    const workbook = window.XLSX.utils.book_new();
    const safeSheet = context.slugify(context.scopeLabel).slice(0, 25) || "wyniki";
    window.XLSX.utils.book_append_sheet(workbook, sheet, safeSheet);

    const directory = await this.getActiveDataDirectory("download");
    if (!directory) return;

    const filename = this.buildTimestampedFileName(DATA_PREFIXES.importDb, "xlsx");
    try {
      const buffer = window.XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const filePath = await saveBinaryFile(filename, buffer, directory);
      await this.infoModal({
        title: "Eksport albumów",
        message: `✅ Wyeksportowano ${context.list.length} albumów.\n📂 ${filePath}`
      });
    } catch (error) {
      this.showStatusMessage(`❌ Nie udało się zapisać pliku XLSX: ${error.message}`);
    }
  }

  async exportFilteredLinks() {
    const context = this.getFilteredExportContext();
    const links = context.list.map((rec) => (rec.album || rec).link).filter(Boolean);
    
    if (!links.length) {
      this.showStatusMessage("Brak linków do zapisania dla wybranych filtrów.");
      return;
    }

    const directory = await this.getActiveDataDirectory("download");
    if (!directory) return;

    const filename = this.buildTimestampedFileName(DATA_PREFIXES.importDb, "txt");
    try {
      const filePath = await saveTextFile(filename, links.join("\n"), directory);
      await this.infoModal({
        title: "Eksport linków",
        message: `✅ Zapisano ${links.length} linków.\n📂 ${filePath}`
      });
    } catch (error) {
      this.showStatusMessage(`❌ Nie udało się zapisać pliku TXT: ${error.message}`);
    }
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

  openEntityDialog({
    mode = "folder",
    title = "",
    defaultName = "",
    defaultContainer = "brak",
    defaultCollection = "brak",
    collectionFilter = "__all__"
  } = {}) {
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
      nameLabel.textContent =
        mode === "folder" ? "Nazwa folderu" : mode === "container" ? "Nazwa kontenera" : "Nazwa kolekcji";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = defaultName || "";
      nameInput.placeholder =
        mode === "folder" ? "np. Moje ulubione" : mode === "container" ? "np. Kontener A" : "np. Kolekcja 1";
      dialog.appendChild(nameLabel);
      dialog.appendChild(nameInput);

      let containerSelectEl = null;
      let collectionSelectEl = null;
      if (mode === "folder") {
        const containerLabel = document.createElement("label");
        containerLabel.textContent = "Kontener";
        containerSelectEl = document.createElement("select");
        const containers =
          collectionFilter && collectionFilter !== "__all__"
            ? this.store.getContainersForCollection(collectionFilter)
            : Array.from(this.store.containersList);
        containers
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
        } else if (mode === "container") {
        const collectionLabel = document.createElement("label");
        collectionLabel.textContent = "Kolekcja";
        collectionSelectEl = document.createElement("select");
        Array.from(this.store.collectionsList)
          .sort((a, b) => a.localeCompare(b, "pl"))
          .forEach((collection) => {
            const option = document.createElement("option");
            option.value = collection;
            option.textContent = collection;
            if (collection === defaultCollection) option.selected = true;
            collectionSelectEl.appendChild(option);
          });
        dialog.appendChild(collectionLabel);
        dialog.appendChild(collectionSelectEl);
      }

      if (mode === "folder") {
        const info = document.createElement("small");
        info.textContent = "SHIFT + klik przypisuje album do wybranego folderu, SHIFT + PPM usuwa przypisanie.";
        dialog.appendChild(info);
      }

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
        const collectionValue = collectionSelectEl ? collectionSelectEl.value : undefined;
        close({ name: nameValue, container: containerValue, collection: collectionValue });
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

  showTransientStatus(message, duration = 3000) {
      const { fileStatus } = this.dom;
      if (!fileStatus || !message) return;
      if (this.uiState.operationInProgress) return;
      clearTimeout(this.uiState.statusTimeout);
      this.uiState.statusTimeout = null;
      fileStatus.classList.remove("status-updated");
      fileStatus.classList.remove("busy");
      fileStatus.classList.add("status-success");
      fileStatus.classList.remove("hidden");
      fileStatus.textContent = message;
      this.uiState.statusTimeout = setTimeout(() => {
        fileStatus.classList.remove("status-updated");
        fileStatus.classList.remove("status-success");
        this.refreshFileStatus();
      }, duration);
    }
  refreshFileStatus() {
    const { fileStatus } = this.dom;
    if (!fileStatus) return;
    if (this.uiState.operationInProgress) return;

    clearTimeout(this.uiState.statusTimeout);
    this.uiState.statusTimeout = null;
    fileStatus.classList.remove("status-updated");
    fileStatus.classList.remove("status-success");

    const name = this.store.currentFileName;

    if (name) {
      fileStatus.textContent = name;
    } else {
      fileStatus.textContent = "";
    }
    fileStatus.classList.toggle("hidden", !fileStatus.textContent);
  }

  flashFileUpdated() {
    const { fileStatus } = this.dom;
    if (!fileStatus) return;
    if (this.uiState.operationInProgress) return;
    clearTimeout(this.uiState.statusTimeout);
    fileStatus.classList.add("status-updated");
    fileStatus.classList.remove("hidden");
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
    fileStatus.classList.remove("status-success");
    fileStatus.classList.remove("busy");
    fileStatus.textContent = "";
    fileStatus.classList.add("hidden");
  }
}

export { UiController };