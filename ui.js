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
  saveTextFile
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
  X: "SŁUCHANY",
  F: "PROPOZYCJA",
  K: "WYSŁUCHANY"
};

const SELECTOR_VALUES = Object.keys(SELECTOR_LABELS);

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
      heardFilter: null,
      durationSort: null,
      durationRange: { min: null, max: null },
      statusTimeout: null,
      pendingStatusMessage: "",
      loadRetryTimer: null,
      updateDbLinks: new Set()
    };
    this.dom = {};
    this.renderScheduled = false;
    this.progressInterval = null;
    this.progressValue = 0;
  }

  init() {
    this.cacheDom();
    if (this.dom.foldersRefreshModeInput) {
      this.dom.foldersRefreshModeInput.checked = this.uiState.foldersRefreshMode === "AUTO";
      this.updateSwitchLabels(
        this.dom.foldersRefreshModeInput,
        this.dom.foldersRefreshModeLabels?.left,
        this.dom.foldersRefreshModeLabels?.right
      );
    }
    this.buildFilterPanel();
    this.buildOptionsPanel();
    this.updateAllDataDirectoryHints();
    this.bootstrapDataPaths();
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
      searchInput: null,
      filterBtn: document.getElementById("filterBtn"),
      optionsBtn: document.getElementById("optionsBtn"),
      filterPanel: document.getElementById("filter-panel"),
      optionsPanel: document.getElementById("options-panel"),
      newFolderBtn: document.getElementById("newFolderBtn"),
      deleteFolderBtn: document.getElementById("deleteFolderBtn"),
      editFolderBtn: document.getElementById("editFolderBtn"),
      newContainerBtn: document.getElementById("newContainerBtn"),
      deleteContainerBtn: document.getElementById("deleteContainerBtn"),
      editContainerBtn: document.getElementById("editContainerBtn"),
      foldersRefreshBtn: document.getElementById("foldersRefreshBtn"),
      foldersRefreshModeInput: document.getElementById("foldersRefreshMode"),
      foldersRefreshModeLabels: {
        left: document.getElementById("foldersRefreshManualLabel"),
        right: document.getElementById("foldersRefreshAutoLabel")
      },
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
      heardDisplay: null,
      heardLeftBtn: null,
      heardRightBtn: null,
      sortDurationAscBtn: null,
      sortDurationDescBtn: null,
      durationRangeMinInput: null,
      durationRangeMaxInput: null,
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
      optionsBtn,
      filterPanel,
      optionsPanel,
      newFolderBtn,
      deleteFolderBtn,
      editFolderBtn,
      newContainerBtn,
      deleteContainerBtn,
      editContainerBtn,
      foldersRefreshBtn,
      foldersRefreshModeInput,
      foldersRefreshModeLabels,
      downloadDbBtn,
      downloadTxtBtn,
      importDbBtn,
      updateDbBtn,
      exportDbBtn,
      releaseMonthFrom,
      releaseYearFrom,
      releaseMonthTo,
      releaseYearTo,
      searchInput,
      navItems,
      pagination
    } = this.dom;

    updateBtn?.addEventListener("click", () => this.handleSave());
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

    const handleMonthChange = () => {
      this.resetCurrentPage();
      this.processAndRender();
    };

    const handleYearChange = (yearSelect, monthSelect) => {
      if (yearSelect?.value === "__all__" && monthSelect) {
        monthSelect.value = "__all__";
      }
      this.resetCurrentPage();
      this.processAndRender();
    };

    releaseMonthFrom?.addEventListener("change", handleMonthChange);
    releaseYearFrom?.addEventListener("change", () => handleYearChange(releaseYearFrom, releaseMonthFrom));
    releaseMonthTo?.addEventListener("change", handleMonthChange);
    releaseYearTo?.addEventListener("change", () => handleYearChange(releaseYearTo, releaseMonthTo));
    searchInput?.addEventListener("input", () => {
      this.resetCurrentPage();
      this.processAndRender();
    });

    filterBtn?.addEventListener("click", () => this.toggleFilterPanel());
    optionsBtn?.addEventListener("click", () => this.toggleOptionsPanel());

    document.addEventListener("click", (event) => {
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

    newFolderBtn?.addEventListener("click", () => {
      this.flashOptionButton(newFolderBtn);
      this.handleCreateFolder();
    });
    editFolderBtn?.addEventListener("click", () => {
      this.flashOptionButton(editFolderBtn);
      this.handleEditFolder();
    });
    deleteFolderBtn?.addEventListener("click", () => {
      this.flashOptionButton(deleteFolderBtn);
      this.handleDeleteFolder();
    });
    newContainerBtn?.addEventListener("click", () => {
      this.flashOptionButton(newContainerBtn);
      this.handleCreateContainer();
    });
    editContainerBtn?.addEventListener("click", () => {
      this.flashOptionButton(editContainerBtn);
      this.handleEditContainer();
    });
    deleteContainerBtn?.addEventListener("click", () => {
      this.flashOptionButton(deleteContainerBtn);
      this.handleDeleteContainer();
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

    foldersRefreshModeInput?.addEventListener("change", () => {
      this.toggleFoldersRefreshMode(foldersRefreshModeInput.checked);
      this.updateSwitchLabels(
        foldersRefreshModeInput,
        foldersRefreshModeLabels?.left,
        foldersRefreshModeLabels?.right
      );
    });
    Object.entries(this.dom.dataModeToggles || {}).forEach(([operationKey, input]) => {
      input?.addEventListener("change", () => this.handleDataModeToggle(operationKey));
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
  }

  toggleFilterPanel() {
    const { filterPanel } = this.dom;
    if (!filterPanel) return;
    const shouldOpen = filterPanel.style.display !== "block";
    filterPanel.style.display = shouldOpen ? "block" : "none";
    if (shouldOpen) {
      this.hideOptionsPanel();
    }
  }

  hideFilterPanel() {
    const { filterPanel } = this.dom;
    if (filterPanel) filterPanel.style.display = "none";
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

    const backupBtn = document.createElement("button");
    backupBtn.type = "button";
    backupBtn.className = "filter-backup-btn";
    backupBtn.textContent = "BACKUP DB";
    backupBtn.addEventListener("click", () => this.handleDatabaseBackup());


    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "filter-clear-btn";
    clearBtn.textContent = "CLEAR FILTERS";
    clearBtn.addEventListener("click", () => this.clearAllFilters());

    const closeBtn = document.createElement("button");
    closeBtn.className = "filter-panel__close";
    closeBtn.setAttribute("aria-label", "Zamknij panel filtrów");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hideFilterPanel());

    actions.appendChild(backupBtn);
    actions.appendChild(clearBtn);
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

    const sections = new Map();

    const activateTab = (id) => {
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
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => activateTab(tab.id));
      tabsBar.appendChild(btn);

      const section = tab.builder();
      section.classList.add("filter-tab__panel");
      section.hidden = true;
      tabsContent.appendChild(section);
      sections.set(tab.id, section);
    });

    filterPanel.appendChild(header);
    filterPanel.appendChild(tabsBar);
    filterPanel.appendChild(tabsContent);

    this.updateHeardFilterDisplay();
    this.updateDurationSortButtons();
    activateTab(this.uiState.activeFilterTab);
    }

  buildOptionsPanel() {
    const { optionsPanel } = this.dom;
    if (!optionsPanel) return;

    optionsPanel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "filter-panel__header";

    const spacer = document.createElement("div");

    const actions = document.createElement("div");
    actions.className = "filter-panel__actions";
    const closeBtn = document.createElement("button");
    closeBtn.className = "filter-panel__close";
    closeBtn.setAttribute("aria-label", "Zamknij panel opcji");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hideOptionsPanel());
    actions.appendChild(closeBtn);

    header.appendChild(spacer);
    header.appendChild(actions);

    optionsPanel.appendChild(header);
    optionsPanel.appendChild(this.createOperationsSection());
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

    searchSection.appendChild(this.createSectionTitle("DATA"));

    const dateRange = document.createElement("div");
    dateRange.className = "filter-date-range";
    const months = [
      "wszystkie miesiące",
      "styczeń",
      "luty",
      "marzec",
      "kwiecień",
      "maj",
      "czerwiec",
      "lipiec",
      "sierpień",
      "wrzesień",
      "październik",
      "listopad",
      "grudzień"
    ];
    
    const buildDateBlock = ({ labelText, yearId, monthId, clearLabel, onClear }) => {
      const block = document.createElement("div");
      block.className = "filter-date-block";

      const label = document.createElement("div");
      label.className = "filter-date-label";
      label.textContent = labelText;

      const selectsWrap = document.createElement("div");
      selectsWrap.className = "filter-date-selects";

      const yearSelect = document.createElement("select");
      yearSelect.id = yearId;
      yearSelect.title = "Rok wydania";
      yearSelect.appendChild(new Option("wszystkie lata", "__all__"));

      const monthSelect = document.createElement("select");
      monthSelect.id = monthId;
      monthSelect.title = "Miesiąc wydania";
      months.forEach((monthLabel, index) => {
        const value = index === 0 ? "__all__" : `${index}`;
        monthSelect.appendChild(new Option(monthLabel, value));
      });

      selectsWrap.appendChild(yearSelect);
      selectsWrap.appendChild(monthSelect);

      const actions = document.createElement("div");
      actions.className = "filter-actions filter-actions--inline";
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.textContent = clearLabel;
      clearBtn.addEventListener("click", onClear);
      actions.appendChild(clearBtn);

      block.appendChild(label);
      block.appendChild(selectsWrap);
      block.appendChild(actions);

      return { block, yearSelect, monthSelect };
    };

    const fromBlock = buildDateBlock({
      labelText: "Od",
      yearId: "releaseYearFrom",
      monthId: "releaseMonthFrom",
      clearLabel: "CLEAR FROM",
      onClear: () => {
        if (this.dom.releaseYearFrom) this.dom.releaseYearFrom.value = "__all__";
        if (this.dom.releaseMonthFrom) this.dom.releaseMonthFrom.value = "__all__";
        this.resetCurrentPage();
        this.processAndRender();
      }
    });
    const toBlock = buildDateBlock({
      labelText: "Do",
      yearId: "releaseYearTo",
      monthId: "releaseMonthTo",
      clearLabel: "CLEAR TO",
      onClear: () => {
        if (this.dom.releaseYearTo) this.dom.releaseYearTo.value = "__all__";
        if (this.dom.releaseMonthTo) this.dom.releaseMonthTo.value = "__all__";
        this.resetCurrentPage();
        this.processAndRender();
      }
    });

    dateRange.appendChild(fromBlock.block);
    dateRange.appendChild(toBlock.block);
    searchSection.appendChild(dateRange);

    this.dom.searchInput = searchInput;
    this.dom.releaseYearFrom = fromBlock.yearSelect;
    this.dom.releaseMonthFrom = fromBlock.monthSelect;
    this.dom.releaseYearTo = toBlock.yearSelect;
    this.dom.releaseMonthTo = toBlock.monthSelect;
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
    wrapper.className = "filter-section filter-ops";

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

    const makeGrid = (entries) => {
      const grid = document.createElement("div");
      grid.className = "option-grid";
      const makeBtn = (id, label) => {
        const btn = document.createElement("button");
        btn.id = id;
        btn.type = "button";
        btn.className = "option-chip";
        btn.textContent = label;
        grid.appendChild(btn);
        return btn;
      };
      entries.forEach(({ id, label, ref }) => {
        this.dom[ref] = makeBtn(id, label);
      });
      return grid;
    };

    const folderGrid = makeGrid([
      { id: "newFolderBtn", label: "ADD FOLDER", ref: "newFolderBtn" },
      { id: "editFolderBtn", label: "EDIT FOLDER", ref: "editFolderBtn" },
      { id: "deleteFolderBtn", label: "DELETE FOLDER", ref: "deleteFolderBtn" }
    ]);

    const containerGrid = makeGrid([
      { id: "newContainerBtn", label: "ADD CONTAINER", ref: "newContainerBtn" },
      { id: "editContainerBtn", label: "EDIT CONTAINER", ref: "editContainerBtn" },
      { id: "deleteContainerBtn", label: "DELETE CONTAINER", ref: "deleteContainerBtn" }
    ]);

    wrapper.appendChild(folderGrid);
    wrapper.appendChild(containerGrid);
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
    const leftBtn = document.createElement("button");
    leftBtn.type = "button";
    leftBtn.className = "heard-filter__btn";
    leftBtn.textContent = "←";
    leftBtn.addEventListener("click", () => this.shiftHeardFilter(-1));
    this.dom.heardLeftBtn = leftBtn;

    const heardValue = document.createElement("div");
    heardValue.className = "heard-filter__value";
    heardValue.textContent = "A";
    this.dom.heardDisplay = heardValue;

    const rightBtn = document.createElement("button");
    rightBtn.type = "button";
    rightBtn.className = "heard-filter__btn";
    rightBtn.textContent = "→";
    rightBtn.addEventListener("click", () => this.shiftHeardFilter(1));
    this.dom.heardRightBtn = rightBtn;

    heardControls.appendChild(leftBtn);
    heardControls.appendChild(heardValue);
    heardControls.appendChild(rightBtn);

    heardRow.appendChild(heardLabel);
    heardRow.appendChild(heardControls);

    const sortTitle = document.createElement("div");
    sortTitle.className = "filter-section__subtitle";
    sortTitle.textContent = "Sortowanie czasu trwania";

    const sortButtons = document.createElement("div");
    sortButtons.className = "filter-actions filter-actions--wrap filter-time__sort";

    const sortAsc = document.createElement("button");
    sortAsc.type = "button";
    sortAsc.textContent = "SORTUJ OD NAJKRÓTSZYCH ALBUMÓW";
    sortAsc.addEventListener("click", () => this.setDurationSort("asc"));
    this.dom.sortDurationAscBtn = sortAsc;

    const sortDesc = document.createElement("button");
    sortDesc.type = "button";
    sortDesc.textContent = "SORTUJ OD NAJDŁUŻSZYCH ALBUMÓW";
    sortDesc.addEventListener("click", () => this.setDurationSort("desc"));
    this.dom.sortDurationDescBtn = sortDesc;

    sortButtons.appendChild(sortAsc);
    sortButtons.appendChild(sortDesc);

    const rangeTitle = document.createElement("div");
    rangeTitle.className = "filter-section__subtitle";
    rangeTitle.textContent = "Zakres czasu trwania (min)";

    const rangeRow = document.createElement("div");
    rangeRow.className = "duration-range";

    const minWrap = document.createElement("label");
    minWrap.className = "duration-range__field";
    minWrap.textContent = "Od";
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.min = "0";
    minInput.placeholder = "np. 10";
    minInput.addEventListener("input", () => this.updateDurationRange());
    minWrap.appendChild(minInput);

    const maxWrap = document.createElement("label");
    maxWrap.className = "duration-range__field";
    maxWrap.textContent = "Do";
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.placeholder = "np. 60";
    maxInput.addEventListener("input", () => this.updateDurationRange());
    maxWrap.appendChild(maxInput);

    rangeRow.appendChild(minWrap);
    rangeRow.appendChild(maxWrap);

    this.dom.durationRangeMinInput = minInput;
    this.dom.durationRangeMaxInput = maxInput;

    wrapper.appendChild(heardRow);
    wrapper.appendChild(sortTitle);
    wrapper.appendChild(sortButtons);
    wrapper.appendChild(rangeTitle);
    wrapper.appendChild(rangeRow);
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
      alert(error.message || error);
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
    alert("Wybierz folder dla operacji importu/eksportu.");
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

  async selectDataFile(defaultPath = "") {
    try {
      return await selectFile({
        defaultPath,
        filters: [{ name: "Arkusze Excel", extensions: ["xlsx"] }]
      });
    } catch (error) {
      alert(error.message || error);
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

  updateHeardFilterDisplay() {
    const value = this.uiState.heardFilter;
    if (this.dom.heardDisplay) {
      this.dom.heardDisplay.textContent = Number.isInteger(value) ? value.toString() : "A";
    }
  }

  shiftHeardFilter(direction) {
    const current = Number.isInteger(this.uiState.heardFilter) ? this.uiState.heardFilter : null;
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

    if (next !== current) {
      this.uiState.heardFilter = next;
      this.resetCurrentPage();
      this.updateHeardFilterDisplay();
      this.processAndRender();
    }
  }

  resetHeardFilter() {
    this.uiState.heardFilter = null;
    this.updateHeardFilterDisplay();
  }

  setDurationSort(direction) {
    const normalized = direction === "asc" || direction === "desc" ? direction : null;
    const next = this.uiState.durationSort === normalized ? null : normalized;
    if (this.uiState.durationSort !== next) {
      this.uiState.durationSort = next;
      this.store.setDurationSort(next);
      this.resetCurrentPage();
      this.renderAlbumsPage();
    }
    this.updateDurationSortButtons();
  }

  updateDurationSortButtons() {
    const { sortDurationAscBtn, sortDurationDescBtn } = this.dom;
    const active = this.uiState.durationSort;
    if (sortDurationAscBtn) {
      sortDurationAscBtn.classList.toggle("active", active === "asc");
    }
    if (sortDurationDescBtn) {
      sortDurationDescBtn.classList.toggle("active", active === "desc");
    }
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

  clearAllFilters() {
  const { filterPanel, releaseMonthFrom, releaseYearFrom, releaseMonthTo, releaseYearTo, searchInput } = this.dom;

  // NIE podmieniaj Setów (bo listenery chipów trzymają referencję do starych)
  this.uiState.selectedLabels.clear();
  for (const name of LABEL_MAP.keys()) this.uiState.selectedLabels.add(name);

  this.uiState.selectedSelectors.clear();
  for (const sel of SELECTOR_VALUES) this.uiState.selectedSelectors.add(sel);

  this.resetHeardFilter();
  this.uiState.durationSort = null;
  this.uiState.durationRange = { min: null, max: null };
  this.store.setDurationSort(null);
  this.updateDurationSortButtons();

  if (searchInput) searchInput.value = "";
  if (releaseYearFrom) releaseYearFrom.value = "__all__";
  if (releaseMonthFrom) releaseMonthFrom.value = "__all__";
  if (releaseYearTo) releaseYearTo.value = "__all__";
  if (releaseMonthTo) releaseMonthTo.value = "__all__";
  if (this.dom.durationRangeMinInput) this.dom.durationRangeMinInput.value = "";
  if (this.dom.durationRangeMaxInput) this.dom.durationRangeMaxInput.value = "";

  if (filterPanel) {
    filterPanel.querySelectorAll('.filter-chip input[type="checkbox"]').forEach((cb) => {
      const shouldCheck =
        this.uiState.selectedSelectors.has(cb.value) || this.uiState.selectedLabels.has(cb.value);
      cb.checked = shouldCheck;
    });
  }

  this.resetCurrentPage();
  this.processAndRender();
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
    this.applyRecordsList(response.records, {
      sheetName: response.sheet_name,
      fileName: response.file_name,
      timestamp: response.updated_at || Date.now()
    });
    this.uiState.autoDataLoaded = true;
    if (showFeedback) {
      this.uiState.pendingStatusMessage = `🔄 Odświeżono ${response.records.length} rekordów z SQLite / bazy danych.`;
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
      heardValue: this.uiState.heardFilter,
      durationMin: this.uiState.durationRange.min,
      durationMax: this.uiState.durationRange.max
    };
    this.store.setLabelSelection(this.uiState.selectedLabels);
    this.store.setSelectorSelection(this.uiState.selectedSelectors);
    this.store.setDurationSort(this.uiState.durationSort);
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
    const copyCounts = this.store.getCopyCounts();
    if (originalCounter) originalCounter.textContent = `O ${copyCounts.originals}`;
    if (copyCounter) copyCounter.textContent = `C ${copyCounts.copies}`;
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

  rebuildReleaseYearSelect() {
    const availableYears = this.store.getReleaseYears();
    const desired = ["__all__", ...availableYears.map((year) => String(year))];
    const syncSelect = (releaseYear) => {
      if (!releaseYear) return;
      const currentValue = releaseYear.value || "__all__";
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
    };

    syncSelect(this.dom.releaseYearFrom);
    syncSelect(this.dom.releaseYearTo);
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
      fileStatus.textContent = message;
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

  async handleSave() {
  if (!this.store.records.length) {
    alert("📂 Brak danych do zapisania! Najpierw pobierz dane z SQLite / bazy danych.");
    return;
  }

  try {
    this.startOperation("💾 Zapisuję dane do SQLite / bazy danych...");
    this.startProgress("Zapisywanie danych do SQLite / bazy danych...");

    const payload = this.store.getSerializableRecords();
    const response = await updateWorkbook(payload, this.store.currentSheetName || "Sheet1");

    const message = response?.message || "✅ Zapisano dane w SQLite / bazie danych.";
    this.finishProgress(message);

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
    this.stopProgress();
  } finally {
    this.finishOperation();
  }
  }

  async handleDatabaseBackup() {
    if (this.uiState.operationInProgress) return;
    try {
      this.startOperation("🗄️ Tworzę kopię bazy danych SQLite...");

      const response = await backupDatabase();
      const fileName = response?.backupFileName || "music_database.sqlite";

      this.uiState.pendingStatusMessage = `✅ Zapisano backup bazy danych: ${fileName}.`;
      alert(`✅ Backup bazy danych gotowy.\n📄 Plik: ${fileName}\n📂 Folder: ${response?.backupPath || ""}`);
    } catch (error) {
      alert(`❌ Nie udało się wykonać backupu bazy danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
  }

  async exportToXlsx() {
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
      alert(
        `${summary}\n📄 Plik: ${fileName || "music_database.xlsx"}\n📂 Zapisano w: ${response?.filePath || directory}`
      );
    } catch (error) {
      alert(`❌ Nie udało się wyeksportować danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
  }

  async importFromXlsx() {
    try {
      this.startOperation("📥 Importuję dane z XLSX do SQLite / bazy danych...");

      const source = await this.resolveImportSource({ operationKey: "importDb", prefix: DATA_PREFIXES.importDb });
      if (!source) {
        this.finishOperation();
        return;
      }

      const confirmed = confirm(`Czy na pewno wczytać plik ${source.fileName} do bazy?`);
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
      alert(`${summary}\n📄 Plik: ${source.fileName}\n📂 Folder: ${source.directory}`);
    } catch (error) {
      alert(`❌ Nie udało się zaimportować danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
    }
  }

  async importNewsFromXlsx() {
    try {
      this.startOperation("📥 Importuję nowe rekordy z XLSX do SQLite / bazy danych...");

      const source = await this.resolveImportSource({ operationKey: "updateDb", prefix: DATA_PREFIXES.updateDb });
      if (!source) {
        this.finishOperation();
        return;
      }

      const confirmed = confirm(`Czy na pewno wczytać plik ${source.fileName} do bazy?`);
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
        alert(
          `${summary}\nℹ️ Dodano 0: wszystko było duplikatem (LINK) albo wiersze nie miały LINK.\n📂 Użyto pliku: ${source.fileName}\n📁 Folder: ${source.directory}${duplicateNote}`
        );
        return;
      }

      await this.reloadFromDatabase(false);
      this.uiState.pendingStatusMessage = summary.split("\n")[0];
      alert(`${summary}\n📄 Plik: ${source.fileName}\n📂 Folder: ${source.directory}${duplicateNote}`);
    } catch (error) {
      alert(`❌ Nie udało się zaimportować nowych danych: ${error.message}`);
      console.error(error);
    } finally {
      this.finishOperation();
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

  async handleCreateFolder() {
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

  async handleEditFolder() {
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

  async handleDeleteFolder() {
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

  async handleCreateContainer() {
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
    this.markFoldersPending();
    alert(`Utworzono kontener: ${name}`);
  }

  async handleEditContainer() {
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
  }

  async handleDeleteContainer() {
    const selected = this.dom.containerSelect?.value;
    if (!selected || selected === "__all__" || selected === "brak") {
      alert("Wybierz kontener do usunięcia.");
      return;
    }
    if (!confirm(`Czy na pewno usunąć kontener "${selected}"?`)) return;
    this.removeContainer(selected);
    this.processAndRender();
    alert("Kontener usunięty.");
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
      alert("Brak albumów do wyeksportowania dla wybranych filtrów.");
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

    const data = context.list.map((rec) => ({
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
    const safeSheet = context.slugify(context.scopeLabel).slice(0, 25) || "wyniki";
    window.XLSX.utils.book_append_sheet(workbook, sheet, safeSheet);

    const directory = await this.getActiveDataDirectory("download");
    if (!directory) return;

    const filename = this.buildTimestampedFileName(DATA_PREFIXES.importDb, "xlsx");
    try {
      const buffer = window.XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const filePath = await saveBinaryFile(filename, buffer, directory);
      alert(`✅ Wyeksportowano ${context.list.length} albumów.\n📂 ${filePath}`);
    } catch (error) {
      alert(`❌ Nie udało się zapisać pliku XLSX: ${error.message}`);
    }
  }

  async exportFilteredLinks() {
    const context = this.getFilteredExportContext();
    const links = context.list.map((rec) => rec.link).filter(Boolean);
    if (!links.length) {
      alert("Brak linków do zapisania dla wybranych filtrów.");
      return;
    }

    const directory = await this.getActiveDataDirectory("download");
    if (!directory) return;

    const filename = this.buildTimestampedFileName(DATA_PREFIXES.importDb, "txt");
    try {
      const filePath = await saveTextFile(filename, links.join("\n"), directory);
      alert(`✅ Zapisano ${links.length} linków.\n📂 ${filePath}`);
    } catch (error) {
      alert(`❌ Nie udało się zapisać pliku TXT: ${error.message}`);
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

  showTransientStatus(message, duration = 3000) {
      const { fileStatus } = this.dom;
      if (!fileStatus || !message) return;
      if (this.uiState.operationInProgress) return;
      clearTimeout(this.uiState.statusTimeout);
      this.uiState.statusTimeout = null;
      fileStatus.classList.remove("status-updated");
      fileStatus.textContent = message;
      this.uiState.statusTimeout = setTimeout(() => {
        fileStatus.classList.remove("status-updated");
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

    const timestamp = this.store.currentFileTimestamp;
    const name = this.store.currentFileName;

    if (timestamp) {
      // Główna informacja: kiedy ostatni raz gadałeś z SQLite / bazą danych
      fileStatus.textContent = `SQLite / baza danych – ostatnia aktualizacja: ${timestamp}`;
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