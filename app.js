let store = {
  activeNodeId: null,
  nodes: [],
};
let storageInfo = null;
let activityOverview = null;
let lowTokenContext = null;
let dashboardState = {
  workspacePath: null,
  loadedAt: 0,
  loading: false,
  error: null,
};
let lowTokenReloadTimer = null;
let graphSelectionLoadTimer = null;
let graphSelectionAbortController = null;
let graphSelectionRequestVersion = 0;
let graphLayout = {};
let graphRenderFrame = null;
let graphRenderFrameOptions = null;
let graphPhysicsFrame = null;
let graphPhysicsTicksRemaining = 0;
let viewState = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};
let graphFocusNodeId = null;
let focusedContextGraph = null;
let currentDisplayGraph = null;
let dragState = null;
let panState = null;
let minimapDragState = null;
let suppressMinimapClickUntil = 0;
let graphOverviewSyncMuted = false;
let graphSyncHintTimer = null;
let selectedGraphNodeId = null;
let expandedGraphNodeId = null;
let selectedGraphNodeIds = new Set();
let expandedClusterIds = new Set();
let promotedGraphNodeIds = new Set();
let graphInteractionMode = "select";
let graphUiState = {
  scope: "auto",
  depth: 1,
  labelMode: "smart",
  layoutMode: "balanced",
  revealMode: "priority",
  hideIsolated: false,
  typeFilters: new Set(),
};

const GRAPH_SCENE_WIDTH = 1600;
const GRAPH_SCENE_HEIGHT = 1100;
const GRAPH_LAYOUT_VERSION = "v7";
const GRAPH_LAYOUT_STORAGE_KEY = "graph-memory-layout-v3";
const GRAPH_UI_STORAGE_KEY = "graph-memory-ui-v3";

const searchInput = document.getElementById("searchInput");
const nodeList = document.getElementById("nodeList");
const graphViewport = document.getElementById("graphViewport");
const graphScene = document.getElementById("graphScene");
const graphOrbitGuides = document.getElementById("graphOrbitGuides");
const graphEdges = document.getElementById("graphEdges");
const graphNodes = document.getElementById("graphNodes");
const nodeCount = document.getElementById("nodeCount");
const activeNodeName = document.getElementById("activeNodeName");
const activeNodeSummary = document.getElementById("activeNodeSummary");
const metricSeverity = document.getElementById("metricSeverity");
const metricIssues = document.getElementById("metricIssues");
const metricContext = document.getElementById("metricContext");
const contextWindowCount = document.getElementById("contextWindowCount");
const contextWindow = document.getElementById("contextWindow");
const debugSignals = document.getElementById("debugSignals");
const chatHistory = document.getElementById("chatHistory");
const noteForm = document.getElementById("noteForm");
const noteInput = document.getElementById("noteInput");
const storageStatus = document.getElementById("storageStatus");
const storageDbPath = document.getElementById("storageDbPath");
const storageExportsDir = document.getElementById("storageExportsDir");
const storageBackupsDir = document.getElementById("storageBackupsDir");
const storageFeedback = document.getElementById("storageFeedback");
const exportButton = document.getElementById("exportButton");
const backupButton = document.getElementById("backupButton");
const openExportsButton = document.getElementById("openExportsButton");
const openBackupsButton = document.getElementById("openBackupsButton");
const restoreLatestBackupButton = document.getElementById("restoreLatestBackupButton");
const repairGraphButton = document.getElementById("repairGraphButton");
const importForm = document.getElementById("importForm");
const importPathInput = document.getElementById("importPathInput");
const importModeInput = document.getElementById("importModeInput");
const crawlProjectsButton = document.getElementById("crawlProjectsButton");
const crawlForm = document.getElementById("crawlForm");
const crawlRootInput = document.getElementById("crawlRootInput");
const crawlDepthInput = document.getElementById("crawlDepthInput");
const recentExportsList = document.getElementById("recentExportsList");
const recentBackupsList = document.getElementById("recentBackupsList");
const graphZoomIn = document.getElementById("graphZoomIn");
const graphZoomOut = document.getElementById("graphZoomOut");
const graphRecenter = document.getElementById("graphRecenter");
const graphResetView = document.getElementById("graphResetView");
const graphReleasePins = document.getElementById("graphReleasePins");
const graphSelectMode = document.getElementById("graphSelectMode");
const graphPanMode = document.getElementById("graphPanMode");
const graphPinMode = document.getElementById("graphPinMode");
const graphClearSelection = document.getElementById("graphClearSelection");
const graphAutoArrange = document.getElementById("graphAutoArrange");
const graphFitScreen = document.getElementById("graphFitScreen");
const graphScope = document.getElementById("graphScope");
const graphDepth = document.getElementById("graphDepth");
const graphLabelMode = document.getElementById("graphLabelMode");
const graphLayoutMode = document.getElementById("graphLayoutMode");
const graphRevealMode = document.getElementById("graphRevealMode");
const graphHideIsolated = document.getElementById("graphHideIsolated");
const graphTypeFilters = document.getElementById("graphTypeFilters");
const graphHint = document.getElementById("graphHint");
const graphSyncHint = document.getElementById("graphSyncHint");
const graphMinimap = document.getElementById("graphMinimap");
const activityStatus = document.getElementById("activityStatus");
const activityRunningList = document.getElementById("activityRunningList");
const activityRecentList = document.getElementById("activityRecentList");
const activityProjectsList = document.getElementById("activityProjectsList");
const commandCenterStatus = document.getElementById("commandCenterStatus");
const workspaceSpotlightTitle = document.getElementById("workspaceSpotlightTitle");
const workspaceSpotlightCopy = document.getElementById("workspaceSpotlightCopy");
const resumeSpotlightTitle = document.getElementById("resumeSpotlightTitle");
const resumeSpotlightCopy = document.getElementById("resumeSpotlightCopy");
const moduleSpotlightTitle = document.getElementById("moduleSpotlightTitle");
const moduleSpotlightCopy = document.getElementById("moduleSpotlightCopy");
const verificationSpotlightTitle = document.getElementById("verificationSpotlightTitle");
const verificationSpotlightCopy = document.getElementById("verificationSpotlightCopy");
const resumeTaskMeta = document.getElementById("resumeTaskMeta");
const resumeTaskPanel = document.getElementById("resumeTaskPanel");
const moduleMatchesMeta = document.getElementById("moduleMatchesMeta");
const moduleMatchesList = document.getElementById("moduleMatchesList");
const verificationMeta = document.getElementById("verificationMeta");
const verificationMemoryList = document.getElementById("verificationMemoryList");
const recommendedFilesMeta = document.getElementById("recommendedFilesMeta");
const recommendedFilesList = document.getElementById("recommendedFilesList");
const recommendationsMeta = document.getElementById("recommendationsMeta");
const recommendationsList = document.getElementById("recommendationsList");
const brainModeTitle = document.getElementById("brainModeTitle");
const brainModeSummary = document.getElementById("brainModeSummary");
const brainBreadcrumbs = document.getElementById("brainBreadcrumbs");
const brainStatsLabel = document.getElementById("brainStatsLabel");
const brainInsights = document.getElementById("brainInsights");
const brainTrace = document.getElementById("brainTrace");
const brainLegend = document.getElementById("brainLegend");

searchInput.addEventListener("input", () => {
  render();
  scheduleLowTokenContextRefresh({ force: true, delayMs: 350 });
});
noteForm.addEventListener("submit", handleNoteSubmit);
exportButton.addEventListener("click", handleExport);
backupButton.addEventListener("click", handleBackup);
openExportsButton.addEventListener("click", () => handleOpenFolder("exports"));
openBackupsButton.addEventListener("click", () => handleOpenFolder("backups"));
restoreLatestBackupButton.addEventListener("click", handleRestoreLatestBackup);
repairGraphButton.addEventListener("click", handleRepairGraph);
importForm.addEventListener("submit", handleImport);
crawlProjectsButton.addEventListener("click", seedDefaultCrawlRoot);
crawlForm.addEventListener("submit", handleCrawlProjects);
graphZoomIn.addEventListener("click", () => zoomGraph(0.12));
graphZoomOut.addEventListener("click", () => zoomGraph(-0.12));
graphRecenter.addEventListener("click", recenterGraphView);
graphResetView.addEventListener("click", resetGraphView);
graphReleasePins.addEventListener("click", releasePinnedNodes);
graphSelectMode.addEventListener("click", () => setGraphInteractionMode("select"));
graphPanMode.addEventListener("click", () => setGraphInteractionMode("pan"));
graphPinMode.addEventListener("click", () => setGraphInteractionMode("pin"));
graphClearSelection.addEventListener("click", clearGraphSelection);
graphAutoArrange.addEventListener("click", autoArrangeGraph);
graphFitScreen.addEventListener("click", fitGraphToScreen);
graphScope.addEventListener("change", handleGraphUiChange);
graphDepth.addEventListener("change", handleGraphUiChange);
graphLabelMode.addEventListener("change", handleGraphUiChange);
graphLayoutMode.addEventListener("change", handleGraphUiChange);
graphRevealMode.addEventListener("change", handleGraphUiChange);
graphHideIsolated.addEventListener("change", handleGraphUiChange);
graphViewport.addEventListener("wheel", handleGraphWheel, { passive: false });
graphViewport.addEventListener("pointerdown", handleViewportPointerDown);
graphMinimap.addEventListener("pointerdown", handleMinimapPointerDown);
graphMinimap.addEventListener("click", (event) => {
  void handleMinimapClick(event);
});
graphMinimap.addEventListener("dblclick", (event) => {
  void handleMinimapDoubleClick(event);
});
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);

const graphFullscreen = document.getElementById("graphFullscreen");
graphFullscreen.addEventListener("click", () => toggleCanvasFullscreen("graph"));

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".is-fullscreen").forEach((el) => {
      el.classList.remove("is-fullscreen");
    });
    document.querySelectorAll(".btn-fullscreen").forEach((btn) => {
      btn.textContent = "⛶ Fullscreen";
    });
  }
});

function toggleCanvasFullscreen(target) {
  let panel, btn;
  if (target === "graph") {
    panel = document.querySelector(".canvas-panel");
    btn = graphFullscreen;
  } else if (target === "pipeline") {
    panel = document.getElementById("pipelinePanel");
    btn = document.getElementById("pipelineFullscreen");
  }
  if (!panel) return;

  const isNowFull = panel.classList.toggle("is-fullscreen");
  btn.textContent = isNowFull ? "✕ Exit Fullscreen" : "⛶ Fullscreen";
}

/* expose for pipeline.js */
window.toggleCanvasFullscreen = toggleCanvasFullscreen;

/* ── Tab Switching ───────────────────────────────────────────── */
const tabButtons = document.querySelectorAll(".ws-tab");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetTab = btn.getAttribute("data-tab");

    tabButtons.forEach((b) => b.classList.remove("is-active"));
    tabContents.forEach((tc) => tc.classList.remove("is-active"));

    btn.classList.add("is-active");

    if (targetTab === "graph") {
      document.getElementById("tabContentGraph").classList.add("is-active");
    } else if (targetTab === "pipeline") {
      document.getElementById("tabContentPipeline").classList.add("is-active");
    }
  });
});

/* expose for pipeline.js graph reload */
window.syncGraphState = syncGraphState;
window.getGraphMemorySnapshot = function () {
  return {
    activeNodeId: store.activeNodeId,
    nodes: store.nodes,
  };
};
window.selectGraphNode = selectNode;
window.focusGraphOverview = focusGraphOverview;
window.__graphE2E = {
  getVisibleDisplayNodeIds() {
    return (currentDisplayGraph?.nodes || []).map((node) => node.id);
  },
  clickDisplayNode(nodeId, options = {}) {
    if (!nodeId) {
      return false;
    }
    if (options.expand) {
      handleGraphNodeExpand(nodeId);
      return true;
    }
    handleGraphNodeClick(nodeId, { shiftKey: Boolean(options.shiftKey) });
    return true;
  },
  dragDisplayNode(nodeId, deltaX = 120, deltaY = 80) {
    const layout = graphLayout[nodeId];
    if (!layout) {
      return false;
    }

    layout.x = clamp(layout.x + deltaX / Math.max(viewState.scale, 0.55), 40, GRAPH_SCENE_WIDTH - 40);
    layout.y = clamp(layout.y + deltaY / Math.max(viewState.scale, 0.55), 40, GRAPH_SCENE_HEIGHT - 40);
    layout.vx = 0;
    layout.vy = 0;
    layout.pinned = true;
    renderGraphMap(currentDisplayGraph, store.activeNodeId, { skipSimulation: true });
    persistGraphPreferences();
    return true;
  },
  getNodeTransform(nodeId) {
    return document.querySelector(`.graph-node-wrap[data-node-id="${nodeId}"]`)?.getAttribute("style") || null;
  },
  isPinned(nodeId) {
    return Boolean(graphLayout[nodeId]?.pinned);
  },
};

bootstrap();

async function bootstrap() {
  hydrateGraphPreferences();
  setGraphInteractionMode(graphInteractionMode);
  await Promise.all([loadGraph(), loadStorageInfo(), loadActivityOverview()]);
  seedDefaultCrawlRoot();
  render();
  renderStorage();
  renderActivityOverview();
  renderCommandCenter();
  void hydrateDashboardContextAfterInitialRender();
  window.setInterval(syncGraphState, 3000);
}

async function hydrateDashboardContextAfterInitialRender() {
  scheduleLowTokenContextRefresh({ force: true, delayMs: 2500 });
  if (store.activeNodeId) {
    graphFocusNodeId = store.activeNodeId;
  }
  renderCommandCenter();
}

function hydrateGraphPreferences() {
  try {
    const savedUi = JSON.parse(window.localStorage.getItem(GRAPH_UI_STORAGE_KEY) || "null");
    if (savedUi) {
      graphUiState = {
        scope: savedUi.scope || "auto",
        depth: clamp(Number(savedUi.depth || 1), 1, 3),
        labelMode: savedUi.labelMode || "smart",
        layoutMode: savedUi.layoutMode || "balanced",
        revealMode: savedUi.revealMode || "priority",
        hideIsolated: Boolean(savedUi.hideIsolated),
        typeFilters: new Set(Array.isArray(savedUi.typeFilters) ? savedUi.typeFilters : []),
      };
    }

    const savedLayout = JSON.parse(window.localStorage.getItem(GRAPH_LAYOUT_STORAGE_KEY) || "null");
    if (savedLayout?.graphLayout && typeof savedLayout.graphLayout === "object") {
      graphLayout = savedLayout.graphLayout;
    }
    if (savedLayout?.viewState) {
      viewState = {
        scale: clamp(Number(savedLayout.viewState.scale || 1), 0.55, 1.85),
        offsetX: Number(savedLayout.viewState.offsetX || 0),
        offsetY: Number(savedLayout.viewState.offsetY || 0),
      };
    }
  } catch (error) {
    console.warn("Khong the nap graph preferences.", error);
  }

  syncGraphUiControls();
}

function syncGraphUiControls() {
  graphScope.value = graphUiState.scope;
  graphDepth.value = String(graphUiState.depth);
  graphLabelMode.value = graphUiState.labelMode;
  graphLayoutMode.value = graphUiState.layoutMode;
  graphRevealMode.value = graphUiState.revealMode;
  graphHideIsolated.checked = graphUiState.hideIsolated;
}

function persistGraphPreferences() {
  const serializableLayout = Object.fromEntries(
    Object.entries(graphLayout).map(([nodeId, layout]) => [
      nodeId,
      {
        x: Math.round(layout.x || GRAPH_SCENE_WIDTH / 2),
        y: Math.round(layout.y || GRAPH_SCENE_HEIGHT / 2),
        vx: 0,
        vy: 0,
        pinned: Boolean(layout.pinned),
        mode: layout.mode || "global",
      },
    ])
  );

  window.localStorage.setItem(
    GRAPH_UI_STORAGE_KEY,
    JSON.stringify({
      ...graphUiState,
      typeFilters: [...graphUiState.typeFilters],
    })
  );
  window.localStorage.setItem(
    GRAPH_LAYOUT_STORAGE_KEY,
    JSON.stringify({
      graphLayout: serializableLayout,
      viewState,
    })
  );
}

function handleGraphUiChange(event) {
  graphUiState.scope = graphScope.value;
  graphUiState.depth = clamp(Number(graphDepth.value || 1), 1, 3);
  graphUiState.labelMode = graphLabelMode.value;
  graphUiState.layoutMode = graphLayoutMode.value;
  graphUiState.revealMode = graphRevealMode.value;
  graphUiState.hideIsolated = graphHideIsolated.checked;
  persistGraphPreferences();
  if (event?.target) {
    render();
  }
}

function setGraphInteractionMode(mode) {
  graphInteractionMode = mode;
  graphSelectMode.classList.toggle("is-active", mode === "select");
  graphPanMode.classList.toggle("is-active", mode === "pan");
  graphPinMode.classList.toggle("is-active", mode === "pin");
  graphViewport.classList.toggle("is-mode-pan", mode === "pan");
  graphViewport.classList.toggle("is-mode-pin", mode === "pin");
  graphViewport.classList.toggle("is-mode-select", mode === "select");
}

async function loadGraph() {
  const response = await fetch("/api/graph");

  if (!response.ok) {
    throw new Error(`Khong the tai graph: ${response.status}`);
  }

  store = await response.json();
}

async function loadStorageInfo() {
  const response = await fetch("/api/storage");

  if (!response.ok) {
    throw new Error(`Khong the tai storage info: ${response.status}`);
  }

  storageInfo = await response.json();
}

async function loadActivityOverview() {
  const response = await fetch("/api/activity/overview");

  if (!response.ok) {
    throw new Error(`Khong the tai activity overview: ${response.status}`);
  }

  activityOverview = await response.json();
}

async function loadLowTokenContext(options = {}) {
  const workspacePath = resolveDashboardWorkspacePath();
  if (!workspacePath) {
    lowTokenContext = null;
    dashboardState = {
      workspacePath: null,
      loadedAt: 0,
      loading: false,
      error: "No workspace context available.",
    };
    return null;
  }

  const shouldReuseCache =
    !options.force &&
    dashboardState.workspacePath === workspacePath &&
    lowTokenContext &&
    Date.now() - dashboardState.loadedAt < 15000;

  if (shouldReuseCache) {
    return lowTokenContext;
  }

  dashboardState = {
    workspacePath,
    loadedAt: dashboardState.loadedAt,
    loading: true,
    error: null,
  };

  try {
    const params = new URLSearchParams({
      workspacePath,
      moduleLimit: "5",
    });
    const query = searchInput.value.trim();
    if (query) {
      params.set("query", query);
    }
    const response = await fetch(`/api/low-token-context?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Khong the tai low-token context: ${response.status}`);
    }
    lowTokenContext = await response.json();
    dashboardState = {
      workspacePath,
      loadedAt: Date.now(),
      loading: false,
      error: null,
    };
    return lowTokenContext;
  } catch (error) {
    lowTokenContext = null;
    dashboardState = {
      workspacePath,
      loadedAt: Date.now(),
      loading: false,
      error: error.message,
    };
    return null;
  }
}

function scheduleLowTokenContextRefresh(options = {}) {
  if (lowTokenReloadTimer) {
    window.clearTimeout(lowTokenReloadTimer);
  }
  lowTokenReloadTimer = window.setTimeout(async () => {
    lowTokenReloadTimer = null;
    await loadLowTokenContext({ force: Boolean(options.force) });
    renderCommandCenter();
  }, options.delayMs ?? 1000);
}

async function syncGraphState() {
  try {
    const [graphResponse, activityResponse] = await Promise.all([
      fetch("/api/graph"),
      fetch("/api/activity/overview"),
    ]);

    if (graphResponse.ok) {
      const nextStore = await graphResponse.json();
      const hasChanged = JSON.stringify(nextStore) !== JSON.stringify(store);

      if (hasChanged) {
        store = nextStore;
        if (graphFocusNodeId) {
          await loadContextGraph(graphFocusNodeId);
        }
        render();
      }
    }

    if (activityResponse.ok) {
      activityOverview = await activityResponse.json();
      renderActivityOverview();
    }

    await loadLowTokenContext();
    renderCommandCenter();
  } catch (error) {
    console.warn("Khong the dong bo graph state.", error);
  }
}

function renderStorage() {
  if (!storageInfo) {
    storageStatus.textContent = "storage unavailable";
    return;
  }

  storageStatus.textContent = `${storageInfo.nodeCount} nodes · active ${storageInfo.activeNodeId || "-"}`;
  storageDbPath.textContent = storageInfo.dbPath || "-";
  storageExportsDir.textContent = storageInfo.exportsDir || "-";
  storageBackupsDir.textContent = storageInfo.backupsDir || "-";
  recentExportsList.innerHTML = renderStorageList(storageInfo.recentExports, "Chua co file export nao.");
  recentBackupsList.innerHTML = renderStorageList(storageInfo.recentBackups, "Chua co file backup nao.");
}

function renderActivityOverview() {
  if (!activityOverview) {
    activityStatus.textContent = "activity unavailable";
    activityRunningList.innerHTML = `<p class="empty-state">Khong tai duoc running sessions.</p>`;
    activityRecentList.innerHTML = `<p class="empty-state">Khong tai duoc session history.</p>`;
    activityProjectsList.innerHTML = `<p class="empty-state">Khong tai duoc project usage.</p>`;
    return;
  }

  activityStatus.textContent = `${activityOverview.runningCount} running · ${(activityOverview.projects || []).length} tracked projects`;
  activityRunningList.innerHTML = (activityOverview.running || []).length
    ? activityOverview.running.map((run) => renderActivityItem(run)).join("")
    : `<p class="empty-state">Chua co session nao dang chay.</p>`;
  activityRecentList.innerHTML = (activityOverview.recent || []).length
    ? activityOverview.recent.slice(0, 8).map((run) => renderActivityItem(run)).join("")
    : `<p class="empty-state">Chua co session nao duoc ghi.</p>`;
  activityProjectsList.innerHTML = (activityOverview.projects || []).length
    ? activityOverview.projects.map(renderProjectUsageItem).join("")
    : `<p class="empty-state">Chua co project nao duoc track.</p>`;
}

function renderStorageList(items, emptyMessage) {
  if (!items || !items.length) {
    return `<p class="empty-state">${emptyMessage}</p>`;
  }

  return items
    .map(
      (item) => `
        <article class="storage-list-item">
          <strong>${item.name}</strong>
          <small>${item.path}</small>
          <small>${item.modifiedAt} · ${item.sizeBytes} bytes</small>
        </article>
      `
    )
    .join("");
}

function renderActivityItem(run) {
  const statusClass =
    run.status === "running"
      ? "is-running"
      : run.status === "failed"
        ? "is-failed"
        : "";
  const title = run.projectName || compactPath(run.workspacePath);
  const summary = run.summary || run.currentFile || run.commandText || run.workspacePath;
  const note = run.latestError || run.currentFile || title;

  return `
    <article class="activity-item ${statusClass}">
      <header>
        <div>
          <strong>${title}</strong>
          <small>${run.toolSource} · ${formatRelativeTime(run.endedAt || run.lastHeartbeatAt || run.startedAt)}</small>
        </div>
        <span class="activity-badge ${statusClass}">${run.status}</span>
      </header>
      <p>${truncateText(summary, 140)}</p>
      <span>${truncateText(note, 120)}</span>
    </article>
  `;
}

function renderProjectUsageItem(project) {
  return `
    <article class="activity-item ${project.runningCount > 0 ? "is-running" : ""}">
      <header>
        <div>
          <strong>${project.projectName}</strong>
          <small>${formatRelativeTime(project.lastUsedAt)}</small>
        </div>
        <span class="activity-badge ${project.runningCount > 0 ? "is-running" : ""}">
          ${project.runningCount > 0 ? `${project.runningCount} live` : `${project.runCount} runs`}
        </span>
      </header>
      <p>${truncateText(compactPath(project.workspacePath), 150)}</p>
      <span>${project.projectId || "Unlinked project"}</span>
    </article>
  `;
}

function renderTypeFilters(nodes) {
  const typeCounts = nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});
  const types = Object.keys(typeCounts).sort((left, right) => typeCounts[right] - typeCounts[left] || left.localeCompare(right));

  graphTypeFilters.innerHTML = types
    .map((type) => {
      const active = !graphUiState.typeFilters.size || graphUiState.typeFilters.has(type);
      return `
        <button
          type="button"
          class="graph-filter-chip ${active ? "is-active" : ""}"
          data-graph-filter-type="${type}"
        >
          <span>${type}</span>
          <small>${typeCounts[type]}</small>
        </button>
      `;
    })
    .join("");

  graphTypeFilters.querySelectorAll("[data-graph-filter-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.getAttribute("data-graph-filter-type");
      if (graphUiState.typeFilters.has(type)) {
        graphUiState.typeFilters.delete(type);
      } else {
        graphUiState.typeFilters.add(type);
      }

      if (graphUiState.typeFilters.size === types.length) {
        graphUiState.typeFilters.clear();
      }

      persistGraphPreferences();
      render();
    });
  });
}

function renderTree(nodes, parentId, activeNodeId, depth = 0) {
  const children = nodes
    .filter((node) => (node.parentId || null) === parentId)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!children.length) return "";

  return children
    .map((child) => {
      const hasChildren = nodes.some((node) => node.parentId === child.id);
      return `
        <div class="tree-node" style="--tree-depth: ${depth};">
          ${renderNodeCard(child, activeNodeId, depth, hasChildren)}
          ${hasChildren ? `<div class="tree-children">${renderTree(nodes, child.id, activeNodeId, depth + 1)}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const filteredNodes = store.nodes.filter((node) => matchesQuery(node, query));
  const activeNode =
    filteredNodes.find((node) => node.id === store.activeNodeId) ??
    store.nodes.find((node) => node.id === store.activeNodeId) ??
    filteredNodes[0] ??
    store.nodes[0];

  nodeCount.textContent = `${filteredNodes.length} nodes`;
  renderTypeFilters(filteredNodes);

  if (filteredNodes.length === 0) {
    nodeList.innerHTML = `<p class="empty-state">Khong tim thay node phu hop voi truy van.</p>`;
  } else if (query) {
    nodeList.innerHTML = filteredNodes.map((node) => renderNodeCard(node, activeNode?.id)).join("");
  } else {
    const roots = filteredNodes.filter((n) => !n.parentId || !filteredNodes.some((p) => p.id === n.parentId));
    nodeList.innerHTML = roots
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((root) => {
        const hasChildren = filteredNodes.some((node) => node.parentId === root.id);
        return `
          <div class="tree-node tree-node--root" style="--tree-depth: 0;">
            ${renderNodeCard(root, activeNode?.id, 0, hasChildren)}
            ${hasChildren ? `<div class="tree-children">${renderTree(filteredNodes, root.id, activeNode?.id, 1)}</div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  const focusNodeId = graphFocusNodeId && filteredNodes.some((node) => node.id === graphFocusNodeId)
    ? graphFocusNodeId
    : null;
  currentDisplayGraph = buildDisplayGraph(filteredNodes, activeNode?.id, focusNodeId, Boolean(query));
  if (selectedGraphNodeId && !currentDisplayGraph.nodes.some((node) => node.id === selectedGraphNodeId)) {
    selectedGraphNodeId = null;
  }
  if (expandedGraphNodeId && !currentDisplayGraph.nodes.some((node) => node.id === expandedGraphNodeId)) {
    expandedGraphNodeId = null;
  }
  selectedGraphNodeIds = new Set(
    [...selectedGraphNodeIds].filter((nodeId) => currentDisplayGraph.nodes.some((node) => node.id === nodeId))
  );
  const inspectedNode =
    currentDisplayGraph.nodes.find((node) => node.id === selectedGraphNodeId) ||
    activeNode;
  renderGraphMap(currentDisplayGraph, activeNode?.id);
  renderBrainPanel(currentDisplayGraph, inspectedNode, filteredNodes);
  bindNodeSelection();
  renderActiveNode(inspectedNode);
  renderCommandCenter();
}

function renderActiveNode(node) {
  if (!node) {
    activeNodeName.textContent = "Khong co node";
    activeNodeSummary.textContent = "Hay tao node dau tien de bat dau luu bo nho debug.";
    metricSeverity.textContent = "-";
    metricIssues.textContent = "0";
    metricContext.textContent = "0";
    contextWindowCount.textContent = "0 muc";
    contextWindow.innerHTML = `<p class="empty-state">Chua co du lieu context.</p>`;
    debugSignals.innerHTML = `<p class="empty-state">Chua co debug signal.</p>`;
    chatHistory.innerHTML = `<p class="empty-state">Chua co chat history.</p>`;
    return;
  }

  if (node.isCluster) {
    renderClusterSummaryNode(node);
    return;
  }

  activeNodeName.textContent = node.name;
  activeNodeSummary.textContent = node.summary;
  metricSeverity.textContent = node.severity;
  metricIssues.textContent = String(node.openIssues);
  metricContext.textContent = String(node.contextWindow.length + node.notes.length);
  contextWindowCount.textContent = `${node.contextWindow.length + node.notes.length} muc`;

  const contextItems = [
    ...node.contextWindow.map((item) => ({ label: item.label, detail: item.detail, type: "context" })),
    ...node.notes.map((note) => ({ label: "Note", detail: note, type: "note" })),
  ];

  contextWindow.innerHTML = contextItems.length
    ? contextItems
        .map(
          (item) => `
            <article class="context-item">
              <small>${item.type === "note" ? "Captured note" : item.label}</small>
              <p>${item.detail}</p>
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">Node nay chua co context window.</p>`;

  debugSignals.innerHTML = node.debugSignals.length
    ? node.debugSignals
        .map(
          (signal) => `
            <article class="signal-card">
              <h3>${signal.title}</h3>
              <div class="node-meta">${signal.location}</div>
              <p>${signal.symptom}</p>
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">Chua co stack trace hoac symptom nao duoc luu.</p>`;

  chatHistory.innerHTML = node.chatHistory.length
    ? node.chatHistory
        .map(
          (entry) => `
            <article class="chat-entry" data-role="${entry.role}">
              <header>
                <span>${entry.role === "assistant" ? "Assistant" : "User"}</span>
                <span>${entry.timestamp}</span>
              </header>
              <p>${entry.message}</p>
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">Node nay chua co chat history.</p>`;
}

function renderClusterSummaryNode(node) {
  const typeSummary = node.memberTypeCounts || [];
  const topFiles = node.topHiddenFiles || [];
  const hotspots = node.hiddenHotspots || [];
  const previewMembers = node.previewMembers || [];
  const isExpanded = expandedClusterIds.has(node.id);
  const primaryHotspot = hotspots[0] || null;
  const primaryFile = topFiles[0] || null;

  activeNodeName.textContent = node.name;
  activeNodeSummary.textContent = node.summary;
  metricSeverity.textContent = node.severity || "low";
  metricIssues.textContent = String(node.openIssues || 0);
  metricContext.textContent = String((node.hiddenCount || node.memberIds?.length || 0));
  contextWindowCount.textContent = `${typeSummary.length + topFiles.length} muc`;

  contextWindow.innerHTML = [
    `
      <div class="cluster-action-row">
        <button type="button" class="cluster-action-btn" data-cluster-action="expand" data-cluster-id="${node.id}">
          ${isExpanded ? "Collapse cluster" : "Expand cluster"}
        </button>
        <button type="button" class="cluster-action-btn" data-cluster-action="pin" data-cluster-id="${node.id}">
          ${graphLayout[node.id]?.pinned ? "Unpin cluster" : "Pin cluster"}
        </button>
        ${primaryFile ? `<button type="button" class="cluster-action-btn" data-cluster-action="open-file" data-cluster-id="${node.id}" data-file-path="${escapeHtmlAttribute(primaryFile.path || primaryFile)}">Open top file</button>` : ""}
        ${primaryHotspot?.nodeId ? `<button type="button" class="cluster-action-btn is-primary" data-cluster-action="promote-hotspot" data-cluster-id="${node.id}" data-hotspot-id="${primaryHotspot.nodeId}">Promote hotspot</button>` : ""}
      </div>
    `,
    {
      label: "Collapsed members",
      detail: `${node.hiddenCount || node.memberIds?.length || 0} nodes are grouped here to keep the graph smooth.`,
    },
    ...typeSummary.map((entry) => ({
      label: `Type · ${entry.type}`,
      detail: `${entry.count} hidden nodes`,
    })),
    ...topFiles.map((fileEntry) => ({
      label: "Top hidden file",
      detail: compactPath(fileEntry.path || fileEntry),
    })),
  ]
    .map(
      (item) => typeof item === "string"
        ? item
        : `
        <article class="context-item">
          <small>${item.label}</small>
          <p>${item.detail}</p>
        </article>
      `
    )
    .join("");

  debugSignals.innerHTML = hotspots.length
    ? hotspots
        .map(
          (hotspot) => `
            <article class="signal-card">
              <h3>${hotspot.name}</h3>
              <div class="node-meta">${hotspot.type}${hotspot.location ? ` · ${hotspot.location}` : ""}</div>
              <p>${hotspot.detail}</p>
              ${hotspot.nodeId ? `<button type="button" class="cluster-inline-action" data-cluster-action="promote-hotspot" data-cluster-id="${node.id}" data-hotspot-id="${hotspot.nodeId}">Promote into graph</button>` : ""}
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">Cluster nay chua co hotspot nao dang canh bao. Neu can, bam cluster de bung chi tiet.</p>`;

  chatHistory.innerHTML = previewMembers.length
    ? previewMembers
        .map(
          (member) => `
            <article class="chat-entry" data-role="assistant">
              <header>
                <span>${member.name}</span>
                <span>${member.type}</span>
              </header>
              <p>${member.summary}</p>
              ${member.nodeId ? `<button type="button" class="cluster-inline-action" data-cluster-action="focus-member" data-member-id="${member.nodeId}">Open member</button>` : ""}
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">Bam vao cluster node tren graph de bung toan bo hidden members khi can.</p>`;

  bindClusterSummaryActions(node);
}

function bindClusterSummaryActions(clusterNode) {
  document.querySelectorAll("[data-cluster-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute("data-cluster-action");
      if (action === "expand") {
        toggleClusterExpansion(clusterNode.id);
        return;
      }
      if (action === "pin") {
        togglePinnedNode(clusterNode.id);
        render();
        return;
      }
      if (action === "open-file") {
        const filePath = button.getAttribute("data-file-path") || "";
        const targetNodeId = resolveGraphNodeIdForFile(filePath, clusterNode);
        if (targetNodeId) {
          await focusPromotedGraphNode(targetNodeId);
        }
        return;
      }
      if (action === "promote-hotspot") {
        const hotspotNodeId = button.getAttribute("data-hotspot-id") || "";
        if (hotspotNodeId) {
          await focusPromotedGraphNode(hotspotNodeId);
        }
        return;
      }
      if (action === "focus-member") {
        const memberNodeId = button.getAttribute("data-member-id") || "";
        if (memberNodeId) {
          await focusPromotedGraphNode(memberNodeId);
        }
      }
    });
  });
}

async function focusPromotedGraphNode(nodeId) {
  if (!nodeId) {
    return;
  }
  promotedGraphNodeIds.add(nodeId);
  selectedGraphNodeId = nodeId;
  selectedGraphNodeIds = new Set([nodeId]);
  render();
  await selectNode(nodeId);
}

function resolveGraphNodeIdForFile(filePath, clusterNode) {
  const normalized = normalizePathLike(filePath);
  if (!normalized) {
    return null;
  }
  const exactFileNode = store.nodes.find((node) =>
    node.type === "file" &&
    (node.files || []).some((entry) => normalizePathLike(entry) === normalized)
  );
  if (exactFileNode) {
    return exactFileNode.id;
  }
  return (clusterNode.memberIds || []).find((memberId) => {
    const memberNode = store.nodes.find((node) => node.id === memberId);
    return memberNode && (memberNode.files || []).some((entry) => normalizePathLike(entry) === normalized);
  }) || null;
}

function resolveGraphNodeIdForOverviewPayload(payload = {}) {
  const filePaths = Array.isArray(payload.filePaths) ? payload.filePaths : [];
  for (const filePath of filePaths) {
    const matchedId = resolveGraphNodeIdForFile(filePath, { memberIds: [] });
    if (matchedId) {
      return matchedId;
    }
  }

  const normalizedPaths = filePaths.map(normalizePathLike).filter(Boolean);
  if (normalizedPaths.length) {
    const broaderNode = store.nodes.find((node) =>
      (node.files || []).some((entry) => normalizedPaths.includes(normalizePathLike(entry)))
    );
    if (broaderNode) {
      return broaderNode.id;
    }
  }

  if (payload.nodeId && store.nodes.some((node) => node.id === payload.nodeId)) {
    return payload.nodeId;
  }

  return null;
}

function buildGraphOverviewPayload(nodeId) {
  const node = store.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return null;
  }
  const filePaths = (node.files || []).map(normalizePathLike).filter(Boolean);
  return {
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    filePaths,
    workspacePath: resolveDashboardWorkspacePath(),
  };
}

function showGraphSyncHint(message, target = "") {
  if (!graphSyncHint) {
    return;
  }
  graphSyncHint.innerHTML = `
    <span class="canvas-sync-label">${escapeHtml(message)}</span>
    ${target ? `<strong class="canvas-sync-target">${escapeHtml(target)}</strong>` : ""}
  `;
  graphSyncHint.classList.add("is-visible", "is-graph");
  if (graphSyncHintTimer) {
    window.clearTimeout(graphSyncHintTimer);
  }
  graphSyncHintTimer = window.setTimeout(() => {
    graphSyncHint.classList.remove("is-visible");
  }, 2200);
}

async function notifyPipelineOverviewSync(nodeId) {
  if (graphOverviewSyncMuted || typeof window.focusPipelineOverview !== "function") {
    return;
  }
  const payload = buildGraphOverviewPayload(nodeId);
  if (!payload) {
    return;
  }
  await window.focusPipelineOverview(payload, { source: "graph", silentBridge: true });
}

async function focusGraphOverview(payload = {}, options = {}) {
  const targetNodeId = resolveGraphNodeIdForOverviewPayload(payload);
  if (!targetNodeId) {
    return false;
  }

  const shouldMute = options.silentBridge !== false;
  if (shouldMute) {
    graphOverviewSyncMuted = true;
  }
  try {
    await selectNode(targetNodeId);
    const focusPoint =
      getGraphPointForNode(targetNodeId) ||
      getGraphPointForClusterMembers(
        currentDisplayGraph?.nodes?.find((node) => node.id === targetNodeId)?.memberIds || []
      );
    if (focusPoint) {
      panGraphToScenePoint(focusPoint.x, focusPoint.y);
    }
    const sourceLabel = options.source || payload.source;
    if (sourceLabel === "pipeline") {
      const targetLabel =
        compactPath(payload.filePaths?.[0] || "") ||
        payload.nodeName ||
        pathBaseName(payload.filePaths?.[0] || "");
      showGraphSyncHint("Focused from pipeline", targetLabel);
    }
    return true;
  } finally {
    if (shouldMute) {
      graphOverviewSyncMuted = false;
    }
  }
}

function renderNodeCard(node, activeNodeId, depth = 0, hasChildren = false) {
  const metaText = formatNodeMeta(node);
  const summaryText = truncateText(node.summary, 148);
  return `
    <article
      class="node-card ${node.id === activeNodeId ? "is-active" : ""} ${hasChildren ? "has-children" : ""}"
      data-node-id="${node.id}"
      data-select-node-id="${node.id}"
      data-node-depth="${depth}"
      title="${escapeHtmlAttribute([node.name, metaText, node.summary].filter(Boolean).join(" | "))}"
    >
      <div class="node-card-head">
        ${hasChildren ? `<span class="node-branch-indicator" aria-hidden="true"></span>` : `<span class="node-branch-indicator is-leaf" aria-hidden="true"></span>`}
        <div class="node-card-title">
      <h3>${node.name}</h3>
      <div class="node-meta">${metaText}</div>
        </div>
      </div>
      <p>${summaryText}</p>
      <div class="pill-row">
        <span class="pill">${node.severity}</span>
        <span class="pill ${node.openIssues > 0 ? "is-danger" : ""}">${node.openIssues} issues</span>
      </div>
    </article>
  `;
}

function formatNodeMeta(node) {
  const previewFiles = (node.files || []).slice(0, 2).map(compactPath);
  const fileSuffix = node.files.length > 2 ? ` +${node.files.length - 2}` : "";
  return previewFiles.length
    ? `${node.type} · ${previewFiles.join(", ")}${fileSuffix}`
    : node.type;
}

function compactPath(filePath) {
  const normalized = String(filePath || "").replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) {
    return normalized;
  }
  return `.../${segments.slice(-3).join("/")}`;
}

function pathBaseName(filePath) {
  const normalized = normalizePathLike(filePath);
  return normalized.split("/").filter(Boolean).pop() || filePath || "";
}

function formatRelativeTime(value) {
  if (!value) {
    return "-";
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return value;
  }

  const diffMs = Date.now() - target.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 1) {
    return "just now";
  }

  if (Math.abs(diffMinutes) < 60) {
    return `${Math.abs(diffMinutes)}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return `${Math.abs(diffHours)}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${Math.abs(diffDays)}d ago`;
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function renderGraphNode(node, activeNodeId) {
  const initials = shouldShowNodeGlyph(node) ? getNodeGlyph(node) : "";
  const selectNodeId = node.selectNodeId || node.id;
  const isPinned = graphLayout[node.id]?.pinned;
  const clusterBadge = node.isCluster
    ? `<span class="graph-cluster-badge">${formatClusterCount(node.hiddenCount || node.memberIds?.length || 0)}</span>`
    : "";
  return `
    <article
      class="graph-node ${selectNodeId === activeNodeId ? "is-active" : ""} ${isPinned ? "is-pinned" : ""} ${node.isCluster ? "is-cluster" : ""}"
      data-node-id="${node.id}"
      data-select-node-id="${selectNodeId}"
      data-node-type="${node.type}"
      data-graph-role="${node.graphRole || "global"}"
      data-testid="graph-node"
      style="--node-size: ${getNodeSize(node)}px;"
    >
      ${initials ? `<h3 class="graph-title">${initials}</h3>` : ""}
      ${clusterBadge}
    </article>
  `;
}

function renderCommandCenter() {
  if (!commandCenterStatus) {
    return;
  }

  const context = lowTokenContext;
  const project = context?.project || null;
  const primaryThread = context?.implementation?.primaryThread || null;
  const topMatch = context?.projectMatches?.[0] || null;
  const topVerification = (context?.verificationMemories || []).find((entry) =>
    (entry.verification?.passedCount || 0) > 0 || (entry.verification?.topFixPatterns || []).length
  ) || context?.verificationMemories?.[0] || null;

  if (dashboardState.loading) {
    commandCenterStatus.textContent = "loading workspace memory...";
  } else if (dashboardState.error) {
    commandCenterStatus.textContent = dashboardState.error;
  } else if (context) {
    const tokenEstimate = context.tokenEstimate ? ` · ~${context.tokenEstimate} tokens` : "";
    commandCenterStatus.textContent = `${context.projectMatches?.length || 0} module matches · ${context.debugContext?.recommendedFiles?.length || 0} recommended files${tokenEstimate}`;
  } else {
    commandCenterStatus.textContent = "No workspace context available.";
  }

  workspaceSpotlightTitle.textContent =
    project?.name ||
    primaryThread?.projectName ||
    pathBaseName(dashboardState.workspacePath) ||
    "Select a project workspace";
  workspaceSpotlightCopy.textContent = project?.summary
    || context?.implementation?.resumeHint
    || dashboardState.workspacePath
    || "Pick a node with project context to unlock the command center.";

  resumeSpotlightTitle.textContent = primaryThread?.title || "No resumable task yet";
  resumeSpotlightCopy.textContent = primaryThread
    ? (primaryThread.nextStep || primaryThread.currentStep || primaryThread.summary || "Resume the current implementation thread.")
    : "Implementation continuity will appear here so another IDE or CLI can keep going fast.";

  moduleSpotlightTitle.textContent = topMatch
    ? `${topMatch.name} · ${topMatch.recommendedAction || "review"}`
    : "No module match yet";
  moduleSpotlightCopy.textContent = topMatch
    ? (topMatch.summary || topMatch.rationale || topMatch.integrationHint || "Best reuse candidate for this workspace.")
    : "When the workspace exposes a clear capability, the strongest reusable module will show up here.";

  verificationSpotlightTitle.textContent = topVerification
    ? `${topVerification.moduleName} · ${topVerification.verification?.passedCount || 0} passes`
    : "No verified pattern yet";
  verificationSpotlightCopy.textContent = topVerification
    ? truncateText(
        [
          (topVerification.verification?.topPassedTests || []).slice(0, 2).join(", "),
          (topVerification.verification?.topFixPatterns || []).slice(0, 1).join(", "),
        ].filter(Boolean).join(" · ") || "Verification memory is available for this module.",
        180
      )
    : "Passed tests, integration errors, and successful fix patterns will accumulate here.";

  renderResumeTaskPanel(context?.implementation || null);
  renderModuleMatches(context?.projectMatches || []);
  renderVerificationMemory(context?.verificationMemories || []);
  renderRecommendedFiles(context?.debugContext || null);
  renderRecommendations(context?.recommendations || []);
}

function renderResumeTaskPanel(implementation) {
  const thread = implementation?.primaryThread || null;
  const events = implementation?.recentEvents || [];
  resumeTaskMeta.textContent = thread
    ? `${implementation.activeCount || 0} active · ${events.length} events`
    : "current thread";

  if (!thread) {
    resumeTaskPanel.innerHTML = `<p class="empty-state">No resumable thread yet. Start tracking implementation to see current step, next step, and blockers here.</p>`;
    return;
  }

  const touchedFiles = (thread.touchedFiles || []).slice(0, 4);
  resumeTaskPanel.innerHTML = `
    <article class="command-item command-item--resume">
      <div class="command-item-head">
        <strong>${escapeHtml(thread.title || "Implementation thread")}</strong>
        ${renderChip(thread.status || "active", getStatusBadgeClass(thread.status))}
      </div>
      ${renderKeyValueLine("Current", thread.currentStep || thread.summary || "No current step recorded yet.")}
      ${renderKeyValueLine("Next", thread.nextStep || "No next step recorded yet.")}
      ${thread.blocker ? renderKeyValueLine("Blocker", thread.blocker) : ""}
      ${thread.currentFile ? renderKeyValueLine("Current file", compactPath(thread.currentFile)) : ""}
      ${touchedFiles.length ? `
        <div class="command-chip-row">
          ${touchedFiles.map((filePath) => renderChip(compactPath(filePath), "is-info")).join("")}
        </div>
      ` : ""}
      ${events.length ? `
        <div class="command-meta-stack">
          ${events.slice(0, 3).map((event) => `
            <span class="command-meta-line">${escapeHtml(event.kind || "event")} · ${escapeHtml(truncateText(event.message || event.summary || event.currentStep || "Progress updated.", 88))}</span>
          `).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function renderModuleMatches(matches) {
  moduleMatchesMeta.textContent = matches.length ? `${matches.length} ranked matches` : "match ranking";

  if (!matches.length) {
    moduleMatchesList.innerHTML = `<p class="empty-state">No strong reusable module match yet. The system will surface copy-first candidates when the capability signal is clearer.</p>`;
    return;
  }

  moduleMatchesList.innerHTML = matches.slice(0, 4).map((match) => `
    <article class="command-item">
      <div class="command-item-head">
        <strong>${escapeHtml(match.name)}</strong>
        ${renderChip(match.recommendedAction || "review", getRecommendationBadgeClass(match.recommendedAction))}
      </div>
      <p>${escapeHtml(truncateText(match.summary || match.integrationHint || "Reusable module candidate.", 150))}</p>
      <div class="command-chip-row">
        ${match.reuseRecommendation ? renderChip(match.reuseRecommendation, "is-warning") : ""}
        ${match.adapterBoundary ? renderChip(`adapter ${match.adapterBoundary}`, "is-muted") : ""}
        ${renderChip(`score ${Math.round(match.score || 0)}`, "is-info")}
      </div>
      ${match.executionAssist?.startHere ? renderKeyValueLine("Start here", compactPath(match.executionAssist.startHere.filePath || match.executionAssist.startHere.targetPath || "")) : ""}
      ${match.adoptionRecipe?.checklist?.length ? renderKeyValueLine("Recipe", match.adoptionRecipe.checklist[0]) : ""}
    </article>
  `).join("");
}

function renderVerificationMemory(items) {
  verificationMeta.textContent = items.length ? `${items.length} tracked memories` : "trusted patterns";

  if (!items.length) {
    verificationMemoryList.innerHTML = `<p class="empty-state">Verification memory is empty for this workspace. The first passing tests and fix patterns will appear here once recorded.</p>`;
    return;
  }

  verificationMemoryList.innerHTML = items.slice(0, 3).map((entry) => {
    const verification = entry.verification || {};
    return `
      <article class="command-item">
        <div class="command-item-head">
          <strong>${escapeHtml(entry.moduleName || "Module verification")}</strong>
          ${renderChip(`${verification.passedCount || 0} pass`, "is-success")}
        </div>
        <div class="command-chip-row">
          ${renderChip(`${verification.failedCount || 0} fail`, verification.failedCount ? "is-danger" : "is-muted")}
          ${renderChip(`${verification.totalCount || 0} runs`, "is-info")}
        </div>
        ${(verification.topPassedTests || []).length ? renderKeyValueLine("Top test", verification.topPassedTests[0]) : ""}
        ${(verification.topIntegrationErrors || []).length ? renderKeyValueLine("Known issue", verification.topIntegrationErrors[0]) : ""}
        ${(verification.topFixPatterns || []).length ? renderKeyValueLine("Fix pattern", verification.topFixPatterns[0]) : ""}
      </article>
    `;
  }).join("");
}

function renderRecommendedFiles(debugContext) {
  const files = debugContext?.recommendedFiles || [];
  const topNodes = debugContext?.topContextNodes || [];
  recommendedFilesMeta.textContent = files.length ? `${files.length} next-file hints` : "open next";

  if (!files.length && !topNodes.length) {
    recommendedFilesList.innerHTML = `<p class="empty-state">Recommended files will appear here after the system ranks the smallest useful context window.</p>`;
    return;
  }

  const fileItems = files.slice(0, 4).map((fileEntry) => {
    const pathValue = typeof fileEntry === "string" ? fileEntry : fileEntry?.file || fileEntry?.path || "";
    const reason = typeof fileEntry === "object" ? fileEntry.reason || fileEntry.summary || fileEntry.label : "";
    return `
      <article class="command-item command-item--file">
        <strong>${escapeHtml(compactPath(pathValue))}</strong>
        ${reason ? `<p>${escapeHtml(truncateText(reason, 128))}</p>` : ""}
      </article>
    `;
  });

  const nodeItems = topNodes.slice(0, Math.max(0, 4 - fileItems.length)).map((node) => `
    <article class="command-item command-item--hint">
      <strong>${escapeHtml(node.name || "Context node")}</strong>
      <p>${escapeHtml(truncateText(node.summary || node.type || "High-signal context node.", 128))}</p>
    </article>
  `);

  recommendedFilesList.innerHTML = [...fileItems, ...nodeItems].join("");
}

function renderRecommendations(recommendations) {
  recommendationsMeta.textContent = recommendations.length ? `${recommendations.length} operator hints` : "operator hints";

  if (!recommendations.length) {
    recommendationsList.innerHTML = `<p class="empty-state">Strategy hints will appear here when workspace memory is available.</p>`;
    return;
  }

  recommendationsList.innerHTML = recommendations.slice(0, 6).map((item, index) => `
    <article class="command-item command-item--hint">
      <strong>Move ${index + 1}</strong>
      <p>${escapeHtml(item)}</p>
    </article>
  `).join("");
}

function renderKeyValueLine(label, value) {
  if (!value) {
    return "";
  }
  return `
    <div class="command-meta-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function renderChip(value, variant = "") {
  if (!value) {
    return "";
  }
  const variantClass = variant ? ` ${variant}` : "";
  return `<span class="command-chip${variantClass}">${escapeHtml(String(value))}</span>`;
}

function resolveDashboardWorkspacePath() {
  const nodesById = new Map((store.nodes || []).map((node) => [node.id, node]));
  const preferredNode =
    nodesById.get(selectedGraphNodeId) ||
    nodesById.get(graphFocusNodeId) ||
    nodesById.get(store.activeNodeId) ||
    store.nodes.find((node) => node.type === "project" || node.type === "workspace") ||
    null;
  const fromNode = resolveWorkspacePathFromNode(preferredNode, nodesById);
  if (fromNode) {
    return fromNode;
  }
  return normalizePathLike(
    activityOverview?.running?.[0]?.workspacePath ||
    activityOverview?.recent?.[0]?.workspacePath ||
    dashboardState.workspacePath ||
    ""
  );
}

function resolveWorkspacePathFromNode(node, nodesById) {
  let current = node;
  while (current) {
    const contextPath = (current.contextWindow || []).find((item) =>
      ["Root path", "Workspace root"].includes(item.label)
    )?.detail;
    const normalizedContext = normalizePathLike(contextPath);
    if (normalizedContext) {
      return normalizedContext;
    }

    const explicitPath = (current.files || []).map(normalizePathLike).find(Boolean);
    if ((current.type === "project" || current.type === "workspace") && explicitPath) {
      return explicitPath;
    }

    if (current.parentId && nodesById?.has(current.parentId)) {
      current = nodesById.get(current.parentId);
      continue;
    }

    if (explicitPath) {
      return explicitPath.replace(/[\\/][^\\/]+$/, "");
    }

    break;
  }

  return "";
}

function normalizePathLike(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim().replaceAll("\\", "/");
}

function getStatusBadgeClass(status) {
  if (!status) {
    return "is-muted";
  }
  if (status === "running" || status === "active") {
    return "is-success";
  }
  if (status === "blocked" || status === "failed") {
    return "is-danger";
  }
  if (status === "paused") {
    return "is-warning";
  }
  return "is-muted";
}

function getRecommendationBadgeClass(action) {
  if (!action) {
    return "is-muted";
  }
  if (action === "copy-first" || action === "ready-to-copy") {
    return "is-success";
  }
  if (action === "adapt-first" || action === "adapt-with-care") {
    return "is-warning";
  }
  return "is-muted";
}

function resolveGraphSelectionTarget(nodeId) {
  const displayNode = currentDisplayGraph?.nodes?.find((node) => node.id === nodeId);
  if (displayNode?.isCluster) {
    return null;
  }
  return displayNode?.selectNodeId || displayNode?.id || nodeId;
}

function bindNodeSelection() {
  document.querySelectorAll("[data-select-node-id]").forEach((element) => {
    if (element.classList.contains("graph-node")) {
      const nodeId = element.getAttribute("data-node-id");
      element.addEventListener("pointerdown", handleNodePointerDown);
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragState?.moved) {
          return;
        }
        handleGraphNodeClick(nodeId, event);
      });
      element.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragState?.moved) {
          return;
        }
        handleGraphNodeExpand(nodeId);
      });
      return;
    }

    if (element.classList.contains("graph-node-label")) {
      const nodeId = element.getAttribute("data-node-id");
      element.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragState?.moved) {
          return;
        }
        handleGraphNodeClick(nodeId, event);
      });
      element.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragState?.moved) {
          return;
        }
        handleGraphNodeExpand(nodeId);
      });
      return;
    }

    element.addEventListener("click", async (event) => {
      event.stopPropagation();

      if (dragState?.moved) {
        return;
      }

      const nodeId = element.getAttribute("data-select-node-id");
      await selectNode(nodeId);
    });
  });
}

function isPipelineTabActive() {
  return document.getElementById("tabContentPipeline")?.classList.contains("is-active");
}

function scheduleGraphNodeActivation(nodeId, options = {}) {
  if (!nodeId) {
    return Promise.resolve();
  }
  if (graphSelectionLoadTimer) {
    window.clearTimeout(graphSelectionLoadTimer);
    graphSelectionLoadTimer = null;
  }
  if (graphSelectionAbortController) {
    graphSelectionAbortController.abort();
    graphSelectionAbortController = null;
  }

  return new Promise((resolve) => {
    graphSelectionLoadTimer = window.setTimeout(async () => {
      graphSelectionLoadTimer = null;
      await selectNode(nodeId, { ...options, defer: false });
      resolve();
    }, options.delayMs ?? 90);
  });
}

function cancelPendingGraphSelection() {
  if (graphSelectionLoadTimer) {
    window.clearTimeout(graphSelectionLoadTimer);
    graphSelectionLoadTimer = null;
  }
  if (graphSelectionAbortController) {
    graphSelectionAbortController.abort();
    graphSelectionAbortController = null;
  }
}

function scheduleGraphMapRender(options = {}) {
  graphRenderFrameOptions = {
    skipSimulation: Boolean(options.skipSimulation),
  };
  if (graphRenderFrame) {
    return;
  }
  graphRenderFrame = window.requestAnimationFrame(() => {
    graphRenderFrame = null;
    const nextOptions = graphRenderFrameOptions || {};
    graphRenderFrameOptions = null;
    if (!currentDisplayGraph) {
      return;
    }
    renderGraphMap(currentDisplayGraph, store.activeNodeId, nextOptions);
    bindNodeSelection();
  });
}

function startGraphPhysicsAnimation(tickCount = 20) {
  if (!currentDisplayGraph?.nodes?.length || graphUiState.layoutMode === "performance") {
    return;
  }
  graphPhysicsTicksRemaining = Math.max(graphPhysicsTicksRemaining, tickCount);
  if (graphPhysicsFrame) {
    return;
  }
  const step = () => {
    graphPhysicsFrame = null;
    if (!currentDisplayGraph?.nodes?.length || graphPhysicsTicksRemaining <= 0 || dragState) {
      graphPhysicsTicksRemaining = 0;
      return;
    }
    graphPhysicsTicksRemaining -= 1;
    runGraphPhysicsTick(currentDisplayGraph);
    scheduleGraphMapRender({ skipSimulation: true });
    if (graphPhysicsTicksRemaining > 0) {
      graphPhysicsFrame = window.requestAnimationFrame(step);
    } else {
      persistGraphPreferences();
    }
  };
  graphPhysicsFrame = window.requestAnimationFrame(step);
}

function stopGraphPhysicsAnimation() {
  graphPhysicsTicksRemaining = 0;
  if (graphPhysicsFrame) {
    window.cancelAnimationFrame(graphPhysicsFrame);
    graphPhysicsFrame = null;
  }
}

function handleGraphNodeClick(nodeId, event) {
  const keepMultiSelect = Boolean(event?.shiftKey);
  const displayNode = currentDisplayGraph?.nodes?.find((node) => node.id === nodeId);

  if (displayNode?.isCluster) {
    toggleClusterExpansion(nodeId);
    return;
  }

  if (keepMultiSelect) {
    if (selectedGraphNodeIds.has(nodeId)) {
      selectedGraphNodeIds.delete(nodeId);
    } else {
      selectedGraphNodeIds.add(nodeId);
    }
  } else {
    selectedGraphNodeIds = new Set([nodeId]);
  }

  selectedGraphNodeId = nodeId;
  graphFocusNodeId = null;
  focusedContextGraph = null;
  cancelPendingGraphSelection();

  if (graphInteractionMode === "pin") {
    togglePinnedNode(nodeId, { skipRender: true });
  }

  render();
  const targetNodeId = resolveGraphSelectionTarget(nodeId);
  if (targetNodeId) {
    void scheduleGraphNodeActivation(targetNodeId, {
      clearGraphFocus: true,
      syncPipeline: isPipelineTabActive(),
    });
  }
}

function handleGraphNodeExpand(nodeId) {
  const displayNode = currentDisplayGraph?.nodes?.find((node) => node.id === nodeId);

  if (displayNode?.isCluster) {
    toggleClusterExpansion(nodeId);
    return;
  }

  selectedGraphNodeId = nodeId;
  selectedGraphNodeIds = new Set([nodeId]);
  expandedGraphNodeId = expandedGraphNodeId === nodeId ? null : nodeId;
  render();
  const targetNodeId = resolveGraphSelectionTarget(nodeId);
  if (targetNodeId) {
    void scheduleGraphNodeActivation(targetNodeId, {
      focusGraph: true,
      syncPipeline: isPipelineTabActive(),
      delayMs: 40,
    });
  }
}

function clearGraphSelection() {
  selectedGraphNodeId = null;
  expandedGraphNodeId = null;
  selectedGraphNodeIds = new Set();
  expandedClusterIds = new Set();
  promotedGraphNodeIds = new Set();
  persistGraphPreferences();
  render();
}

function toggleClusterExpansion(clusterNodeId) {
  if (expandedClusterIds.has(clusterNodeId)) {
    expandedClusterIds.delete(clusterNodeId);
  } else {
    expandedClusterIds.add(clusterNodeId);
  }
  selectedGraphNodeId = clusterNodeId;
  render();
}

function getGraphPointForNode(nodeId) {
  const layout = graphLayout[nodeId];
  if (!layout) {
    return null;
  }
  return { x: layout.x, y: layout.y };
}

function getGraphPointForClusterMembers(memberIds = []) {
  const positions = memberIds
    .map((memberId) => graphLayout[memberId])
    .filter(Boolean);
  if (!positions.length) {
    return null;
  }
  const totals = positions.reduce(
    (accumulator, position) => ({
      x: accumulator.x + position.x,
      y: accumulator.y + position.y,
    }),
    { x: 0, y: 0 }
  );
  return {
    x: totals.x / positions.length,
    y: totals.y / positions.length,
  };
}

function panGraphToScenePoint(x, y) {
  const rect = graphViewport.getBoundingClientRect();
  viewState.offsetX = rect.width / 2 - x * viewState.scale;
  viewState.offsetY = rect.height / 2 - y * viewState.scale;
  applyViewTransform();
  if (currentDisplayGraph) {
    renderMinimap(currentDisplayGraph);
  }
  persistGraphPreferences();
}

function panGraphToMinimapClientPoint(clientX, clientY) {
  const world = graphMinimap.querySelector(".graph-minimap-world");
  if (!world) {
    return;
  }
  const rect = world.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }
  const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
  panGraphToScenePoint(ratioX * GRAPH_SCENE_WIDTH, ratioY * GRAPH_SCENE_HEIGHT);
}

function panGraphViewportToMinimapClientPoint(clientX, clientY, anchorRatioX = 0.5, anchorRatioY = 0.5) {
  const world = graphMinimap.querySelector(".graph-minimap-world");
  if (!world) {
    return;
  }
  const rect = world.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }
  const worldRatioX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const worldRatioY = clamp((clientY - rect.top) / rect.height, 0, 1);
  const viewportWidth = Math.max(graphViewport.getBoundingClientRect().width / viewState.scale, 120);
  const viewportHeight = Math.max(graphViewport.getBoundingClientRect().height / viewState.scale, 90);
  const viewportX = clamp(worldRatioX * GRAPH_SCENE_WIDTH - viewportWidth * anchorRatioX, 0, GRAPH_SCENE_WIDTH - viewportWidth);
  const viewportY = clamp(worldRatioY * GRAPH_SCENE_HEIGHT - viewportHeight * anchorRatioY, 0, GRAPH_SCENE_HEIGHT - viewportHeight);
  viewState.offsetX = -viewportX * viewState.scale;
  viewState.offsetY = -viewportY * viewState.scale;
  applyViewTransform();
  if (currentDisplayGraph) {
    renderMinimap(currentDisplayGraph);
  }
  persistGraphPreferences();
}

function handleMinimapPointerDown(event) {
  const windowHandle = event.target.closest("[data-minimap-window]");
  if (!windowHandle) {
    return;
  }
  const windowRect = windowHandle.getBoundingClientRect();
  minimapDragState = {
    anchorRatioX: windowRect.width ? clamp((event.clientX - windowRect.left) / windowRect.width, 0, 1) : 0.5,
    anchorRatioY: windowRect.height ? clamp((event.clientY - windowRect.top) / windowRect.height, 0, 1) : 0.5,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  graphMinimap.classList.add("is-dragging-window");
  event.preventDefault();
  event.stopPropagation();
}

async function focusGraphNodeFromMinimap(nodeId, options = {}) {
  const { toggleCluster = false } = options;
  const displayNode = currentDisplayGraph?.nodes?.find((node) => node.id === nodeId);
  if (!displayNode) {
    return;
  }

  const fallbackPoint = getGraphPointForNode(nodeId)
    || (displayNode.isCluster ? getGraphPointForClusterMembers(displayNode.memberIds || []) : null);

  selectedGraphNodeId = nodeId;
  selectedGraphNodeIds = new Set([nodeId]);

  if (displayNode.isCluster) {
    if (toggleCluster) {
      toggleClusterExpansion(nodeId);
    } else {
      render();
    }

    const nextPoint = getGraphPointForClusterMembers(displayNode.memberIds || [])
      || getGraphPointForNode(nodeId)
      || fallbackPoint;
    if (nextPoint) {
      panGraphToScenePoint(nextPoint.x, nextPoint.y);
    }
    return;
  }

  render();
  const targetNodeId = resolveGraphSelectionTarget(nodeId);
  if (targetNodeId) {
    await selectNode(targetNodeId);
  }
  const nextPoint = getGraphPointForNode(nodeId) || fallbackPoint;
  if (nextPoint) {
    panGraphToScenePoint(nextPoint.x, nextPoint.y);
  }
}

async function handleMinimapClick(event) {
  if (Date.now() < suppressMinimapClickUntil) {
    event.preventDefault();
    return;
  }

  if (event.target.closest("[data-minimap-window]")) {
    return;
  }

  const marker = event.target.closest("[data-minimap-node-id]");
  if (marker) {
    event.preventDefault();
    event.stopPropagation();
    await focusGraphNodeFromMinimap(marker.getAttribute("data-minimap-node-id"));
    return;
  }

  const world = event.target.closest("[data-minimap-world]");
  if (!world) {
    return;
  }

  event.preventDefault();
  panGraphToMinimapClientPoint(event.clientX, event.clientY);
}

async function handleMinimapDoubleClick(event) {
  if (Date.now() < suppressMinimapClickUntil) {
    event.preventDefault();
    return;
  }

  const marker = event.target.closest("[data-minimap-node-id]");
  if (!marker) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (marker.getAttribute("data-minimap-cluster") === "true") {
    await focusGraphNodeFromMinimap(marker.getAttribute("data-minimap-node-id"), { toggleCluster: true });
  }
}

function matchesQuery(node, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    node.name,
    node.type,
    node.summary,
    ...node.files,
    ...node.relations,
    ...node.contextWindow.map((item) => item.detail),
    ...node.debugSignals.map((signal) => `${signal.title} ${signal.location} ${signal.symptom}`),
    ...node.chatHistory.map((entry) => entry.message),
    ...node.notes,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

async function selectNode(nodeId, options = {}) {
  if (!nodeId) {
    return;
  }

  selectedGraphNodeId = nodeId;
  cancelPendingGraphSelection();
  const requestVersion = ++graphSelectionRequestVersion;

  if (options.defer) {
    return scheduleGraphNodeActivation(nodeId, options);
  }

  if (options.clearGraphFocus) {
    graphFocusNodeId = null;
    focusedContextGraph = null;
  }

  const controller = new AbortController();
  graphSelectionAbortController = controller;

  try {
    let response;
    try {
      response = await fetch("/api/active-node", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nodeId }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      throw error;
    }

    if (!response.ok) {
      return;
    }

    const nextStore = await response.json();
    if (requestVersion !== graphSelectionRequestVersion || controller.signal.aborted) {
      return;
    }

    store = nextStore;
    if (options.focusGraph) {
      graphFocusNodeId = nodeId;
      await loadContextGraph(nodeId);
      if (requestVersion !== graphSelectionRequestVersion || controller.signal.aborted) {
        return;
      }
    }
    render();
    scheduleLowTokenContextRefresh({ delayMs: 2500 });
    if (options.syncPipeline) {
      await notifyPipelineOverviewSync(nodeId);
    }
  } finally {
    if (graphSelectionAbortController === controller) {
      graphSelectionAbortController = null;
    }
  }
}

async function handleNoteSubmit(event) {
  event.preventDefault();
  const note = noteInput.value.trim();

  if (!note || !store.activeNodeId) {
    return;
  }

  const response = await fetch(`/api/nodes/${store.activeNodeId}/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ note, role: "assistant" }),
  });

  if (!response.ok) {
    return;
  }

  store = await response.json();
  noteInput.value = "";
  if (graphFocusNodeId) {
    await loadContextGraph(graphFocusNodeId);
  }
  render();
}

async function handleExport() {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json();

  if (!response.ok) {
    storageFeedback.textContent = payload.message || "Export failed.";
    return;
  }

  storageFeedback.textContent = `Exported ${payload.nodeCount} nodes to ${payload.exportPath}`;
  await loadStorageInfo();
  renderStorage();
}

async function handleBackup() {
  const response = await fetch("/api/backup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json();

  if (!response.ok) {
    storageFeedback.textContent = payload.message || "Backup failed.";
    return;
  }

  storageFeedback.textContent = `Created DB backup at ${payload.backupPath}`;
  await loadStorageInfo();
  renderStorage();
}

async function handleOpenFolder(kind) {
  const response = await fetch("/api/open-folder", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ kind }),
  });

  const payload = await response.json();
  storageFeedback.textContent = response.ok
    ? `Opened folder ${payload.openedPath}`
    : payload.message || "Open folder failed.";
}

async function handleRestoreLatestBackup() {
  const response = await fetch("/api/restore-latest-backup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json();

  if (!response.ok) {
    storageFeedback.textContent = payload.message || "Restore failed.";
    return;
  }

  storageFeedback.textContent = `Restored latest backup from ${payload.restoredFrom}`;
  await Promise.all([loadGraph(), loadStorageInfo()]);
  graphFocusNodeId = store.activeNodeId || null;
  focusedContextGraph = null;
  if (graphFocusNodeId) {
    await loadContextGraph(graphFocusNodeId);
  }
  renderStorage();
  render();
}

async function handleRepairGraph() {
  const response = await fetch("/api/repair-graph", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json();
  if (!response.ok) {
    storageFeedback.textContent = payload.message || "Repair graph failed.";
    return;
  }

  storageFeedback.textContent = `Repaired graph topology. Updated ${payload.updated}/${payload.total} nodes.`;
  await Promise.all([loadGraph(), loadStorageInfo()]);
  if (graphFocusNodeId) {
    await loadContextGraph(graphFocusNodeId);
  }
  renderStorage();
  render();
}

async function handleCrawlProjects(event) {
  event.preventDefault();
  const rootPath = crawlRootInput.value.trim();
  const maxDepth = Number(crawlDepthInput.value || 3);

  if (!rootPath) {
    storageFeedback.textContent = "Hay nhap thu muc goc can crawl.";
    return;
  }

  const response = await fetch("/api/crawl-projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rootPath, maxDepth }),
  });

  const payload = await response.json();

  if (!response.ok) {
    storageFeedback.textContent = payload.message || "Crawl failed.";
    return;
  }

  storageFeedback.textContent = `Crawled ${payload.added} new / ${payload.updated} updated project nodes from ${payload.rootPath}`;
  await Promise.all([loadGraph(), loadStorageInfo()]);
  if (graphFocusNodeId) {
    await loadContextGraph(graphFocusNodeId);
  }
  renderStorage();
  render();
}

function seedDefaultCrawlRoot() {
  if (crawlRootInput.value.trim()) {
    return;
  }

  const dbPath = storageInfo?.dbPath || "";
  if (dbPath.includes("\\.graph-memory\\")) {
    crawlRootInput.value = "C:\\Users\\DELL\\OneDrive\\Desktop\\sang kein";
  }
}

function buildDisplayGraph(nodes, activeNodeId, focusNodeId, hasQuery) {
  const prefilteredNodes = applyGraphTypeFilters(nodes);
  if (!prefilteredNodes.length) {
    return {
      mode: "empty",
      focalNodeId: null,
      nodes: [],
      edges: [],
      metrics: { total: 0, openIssues: 0, byType: {} },
    };
  }

  const effectiveFocusNodeId =
    graphUiState.scope === "global"
      ? null
      : focusNodeId || (graphUiState.scope === "local" ? activeNodeId : null);
  const focusNode = effectiveFocusNodeId ? prefilteredNodes.find((node) => node.id === effectiveFocusNodeId) : null;
  if (focusNode) {
    if (focusedContextGraph?.focalNodeId === focusNode.id) {
      return finalizeDisplayGraph({
        ...focusedContextGraph,
        mode: "focus",
      });
    }

    const neighborhoodNodes = buildNeighborhood(prefilteredNodes, focusNode, graphUiState.depth).map((node) => ({
      ...node,
      graphRole: inferFallbackGraphRole(node, focusNode),
    }));

    return finalizeDisplayGraph({
      mode: "focus",
      focalNodeId: focusNode.id,
      activeNodeId,
      hasQuery,
      nodes: neighborhoodNodes,
      edges: buildEdgesForNodes(neighborhoodNodes),
      metrics: buildGraphMetrics(neighborhoodNodes),
    });
  }

  return finalizeDisplayGraph({
    ...buildGlobalGraph(prefilteredNodes, activeNodeId, hasQuery),
    activeNodeId,
    hasQuery,
  });
}

function buildGlobalGraph(nodes, activeNodeId, hasQuery) {
  const pinnedVisibleIds = new Set([
    activeNodeId,
    selectedGraphNodeId,
    ...selectedGraphNodeIds,
    ...promotedGraphNodeIds,
  ].filter(Boolean));
  const visibleNodes = hasQuery
    ? nodes
    : nodes.filter((node) => pinnedVisibleIds.has(node.id) || !["file", "error", "edit"].includes(node.type));
  const normalizedSource = visibleNodes.length ? visibleNodes : nodes;

  const normalizedNodes = normalizedSource.map((node) => ({
    ...node,
    graphRole: node.id === activeNodeId ? "focus" : "global",
  }));

  return {
    mode: "global",
    focalNodeId: null,
    nodes: sortGlobalNodes(normalizedNodes),
    edges: buildEdgesForNodes(normalizedNodes),
    metrics: buildGraphMetrics(normalizedNodes),
  };
}

function applyGraphTypeFilters(nodes) {
  if (!graphUiState.typeFilters.size) {
    return nodes;
  }
  return nodes.filter((node) => graphUiState.typeFilters.has(node.type));
}

function finalizeDisplayGraph(displayGraph) {
  if (!displayGraph?.nodes?.length) {
    return displayGraph;
  }

  const sourceNodes = [...displayGraph.nodes];
  const sourceEdges = [...(displayGraph.edges || [])];
  let nodes = sourceNodes;
  let edges = sourceEdges;
  let hiddenCount = 0;

  const revealed = applyGraphRevealMode(sourceNodes, sourceEdges, displayGraph);
  nodes = revealed.nodes;
  edges = revealed.edges;
  hiddenCount += revealed.hiddenCount;

  if (graphUiState.hideIsolated) {
    const linkedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    const nextNodes = nodes.filter((node) => linkedIds.has(node.id) || node.id === displayGraph.focalNodeId);
    hiddenCount += Math.max(nodes.length - nextNodes.length, 0);
    nodes = nextNodes;
    const nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  }

  return {
    ...displayGraph,
    nodes,
    edges,
    hiddenCount,
    metrics: buildGraphMetrics(nodes),
  };
}

function applyGraphRevealMode(nodes, edges, displayGraph) {
  if (graphUiState.revealMode === "full" || displayGraph.hasQuery) {
    return { nodes, edges, hiddenCount: 0 };
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const selectedIds = new Set([
    displayGraph.focalNodeId,
    displayGraph.activeNodeId,
    selectedGraphNodeId,
    ...selectedGraphNodeIds,
    ...promotedGraphNodeIds,
  ].filter((nodeId) => nodeId && nodeIds.has(nodeId)));
  const scored = [...nodes].map((node) => ({
    node,
    score: scoreGraphNodeVisibility(node, edges, displayGraph, selectedIds),
  }));
  const visibleLimit = resolveGraphRevealLimit(nodes.length, displayGraph.mode);
  const prioritized = scored
    .sort((left, right) => right.score - left.score || left.node.name.localeCompare(right.node.name))
    .slice(0, visibleLimit)
    .map((entry) => entry.node.id);
  const visibleIds = new Set([...prioritized, ...selectedIds]);
  const visibleNodes = nodes.filter((node) => visibleIds.has(node.id));
  const hiddenNodes = nodes.filter((node) => !visibleIds.has(node.id));
  if (!hiddenNodes.length) {
    const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    return {
      nodes: visibleNodes,
      edges: visibleEdges,
      hiddenCount: 0,
    };
  }

  const clustered = buildCollapsedClusters(visibleNodes, hiddenNodes, edges, displayGraph);
  return {
    nodes: clustered.nodes,
    edges: clustered.edges,
    hiddenCount: clustered.hiddenCount,
  };
}

function buildCollapsedClusters(visibleNodes, hiddenNodes, edges, displayGraph) {
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const clusterGroups = new Map();
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  hiddenNodes.forEach((node) => {
    const clusterKey = getCollapsedClusterKey(node, displayGraph.mode);
    if (!clusterGroups.has(clusterKey)) {
      clusterGroups.set(clusterKey, []);
    }
    clusterGroups.get(clusterKey).push(node);
  });

  const clusterNodes = [];
  const clusterEdges = [];
  const expandedNodes = [];
  const expandedIds = new Set();

  clusterGroups.forEach((members, clusterKey) => {
    const clusterNodeId = buildClusterNodeId(displayGraph, clusterKey);
    if (expandedClusterIds.has(clusterNodeId)) {
      members.forEach((node) => {
        expandedNodes.push(node);
        expandedIds.add(node.id);
      });
      return;
    }

    const clusterNode = createCollapsedClusterNode(clusterNodeId, clusterKey, members);
    clusterNodes.push(clusterNode);
    const neighborIds = new Set();

    edges.forEach((edge) => {
      if (members.some((node) => node.id === edge.source) && visibleIds.has(edge.target)) {
        neighborIds.add(edge.target);
      }
      if (members.some((node) => node.id === edge.target) && visibleIds.has(edge.source)) {
        neighborIds.add(edge.source);
      }
    });

    neighborIds.forEach((neighborId) => {
      const [source, target] = [clusterNode.id, neighborId].sort();
      clusterEdges.push({
        source,
        target,
        type: "cluster",
      });
    });
  });

  const combinedVisibleIds = new Set([
    ...visibleIds,
    ...clusterNodes.map((node) => node.id),
    ...expandedIds,
  ]);
  const expandedEdges = edges.filter((edge) => combinedVisibleIds.has(edge.source) && combinedVisibleIds.has(edge.target));

  return {
    nodes: [...visibleNodes, ...clusterNodes, ...expandedNodes],
    edges: dedupeGraphEdges([...visibleEdges, ...expandedEdges, ...clusterEdges]),
    hiddenCount: Math.max(hiddenNodes.length - expandedNodes.length, 0),
  };
}

function getCollapsedClusterKey(node, mode) {
  if (mode === "focus") {
    return node.graphRole ? `role:${node.graphRole}` : `type:${node.type}`;
  }
  const clusterKey = getNodeClusterKey(node);
  return clusterKey.startsWith("type:") ? clusterKey : `${clusterKey}::${node.type}`;
}

function buildClusterNodeId(displayGraph, clusterKey) {
  return `cluster:${displayGraph.mode}:${clusterKey}`;
}

function createCollapsedClusterNode(clusterNodeId, clusterKey, members) {
  const sample = members[0];
  const issueCount = members.reduce((count, node) => count + Number(node.openIssues || 0), 0);
  const files = members.flatMap((node) => node.files || []).slice(0, 3);
  const memberTypeCounts = summarizeClusterMemberTypes(members);
  const topHiddenFiles = summarizeClusterFiles(members);
  const hiddenHotspots = summarizeClusterHotspots(members);
  const previewMembers = summarizeClusterPreviewMembers(members);
  return {
    id: clusterNodeId,
    name: formatCollapsedClusterName(clusterKey, members),
    type: "cluster",
    summary: `Collapsed ${members.length} low-signal nodes. Click to expand this cluster.`,
    severity: issueCount > 0 ? "medium" : "low",
    openIssues: issueCount,
    files,
    relations: [],
    contextWindow: [
      {
        label: "Collapsed nodes",
        detail: `${members.length} members hidden for smoother rendering.`,
      },
      {
        label: "Cluster bucket",
        detail: clusterKey,
      },
    ],
    notes: [],
    debugSignals: [],
    chatHistory: [],
    graphRole: sample?.graphRole || "cluster",
    isCluster: true,
    clusterKey,
    hiddenCount: members.length,
    memberIds: members.map((node) => node.id),
    memberTypeCounts,
    topHiddenFiles,
    hiddenHotspots,
    previewMembers,
    selectNodeId: null,
  };
}

function formatCollapsedClusterName(clusterKey, members) {
  const typeCounts = members.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});
  const topType = Object.entries(typeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || "nodes";
  if (clusterKey.startsWith("role:")) {
    return `+${members.length} ${clusterKey.replace("role:", "")}`;
  }
  return `+${members.length} ${topType}`;
}

function formatClusterCount(value) {
  const count = Number(value || 0);
  if (count > 99) {
    return "99+";
  }
  return String(count);
}

function dedupeGraphEdges(edges) {
  const unique = new Map();
  edges.forEach((edge) => {
    const key = edge.type === "related" || edge.type === "cluster"
      ? `${[edge.source, edge.target].sort().join("::")}::${edge.type}`
      : `${edge.source}::${edge.target}::${edge.type}`;
    if (!unique.has(key)) {
      unique.set(key, edge);
    }
  });
  return [...unique.values()];
}

function summarizeClusterMemberTypes(members) {
  return Object.entries(
    members.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
    .slice(0, 4);
}

function summarizeClusterFiles(members) {
  const counts = new Map();
  members.forEach((node) => {
    (node.files || []).forEach((filePath) => {
      const existing = counts.get(filePath) || { count: 0, nodeId: node.id };
      counts.set(filePath, {
        count: existing.count + 1,
        nodeId: existing.nodeId || node.id,
      });
    });
  });
  return [...counts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([filePath, entry]) => ({
      path: filePath,
      count: entry.count,
      nodeId: entry.nodeId,
    }));
}

function summarizeClusterHotspots(members) {
  return [...members]
    .map((node) => ({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      location: node.debugSignals?.[0]?.location || node.files?.[0] || "",
      detail:
        node.debugSignals?.[0]?.symptom ||
        node.summary ||
        node.notes?.[0] ||
        `${node.openIssues || 0} issues`,
      score:
        Number(node.openIssues || 0) * 10 +
        (node.debugSignals?.length || 0) * 12 +
        (node.notes?.length || 0) * 2,
    }))
    .filter((item) => item.score > 0 || item.detail)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 4)
    .map(({ score, ...item }) => item);
}

function summarizeClusterPreviewMembers(members) {
  return [...members]
    .sort((left, right) => {
      const issueDelta = Number(right.openIssues || 0) - Number(left.openIssues || 0);
      if (issueDelta !== 0) {
        return issueDelta;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, 4)
    .map((node) => ({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      summary: truncateText(node.summary || getTraceDetail(node) || "Hidden member.", 110),
    }));
}

function scoreGraphNodeVisibility(node, edges, displayGraph, selectedIds) {
  let score = 0;
  const degree = edges.reduce((count, edge) => {
    if (edge.source === node.id || edge.target === node.id) {
      return count + 1;
    }
    return count;
  }, 0);
  score += degree * 4;
  score += Number(node.openIssues || 0) * 9;
  score += (node.debugSignals?.length || 0) * 10;
  score += (node.notes?.length || 0) * 2;
  score += (node.contextWindow?.length || 0) * 1.5;
  if (selectedIds.has(node.id)) {
    score += 90;
  }
  if (node.id === displayGraph.focalNodeId) {
    score += 110;
  }
  if (node.id === displayGraph.activeNodeId) {
    score += 75;
  }
  if (node.type === "project" || node.type === "workspace") {
    score += 40;
  }
  if (node.type === "error" || node.type === "edit") {
    score += 28;
  }
  if (node.graphRole === "focus" || node.graphRole === "parent" || node.graphRole === "child") {
    score += 24;
  }
  if (node.graphRole === "error" || node.graphRole === "edit") {
    score += 18;
  }
  return score;
}

function resolveGraphRevealLimit(totalNodes, mode) {
  if (graphUiState.revealMode === "expanded") {
    return mode === "focus"
      ? Math.min(totalNodes, 26)
      : Math.min(totalNodes, totalNodes > 90 ? 44 : 54);
  }

  return mode === "focus"
    ? Math.min(totalNodes, 16)
    : Math.min(totalNodes, totalNodes > 90 ? 26 : 34);
}

function buildEdgesForNodes(nodes) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];

  nodes.forEach((node) => {
    if (node.parentId && nodeIds.has(node.parentId)) {
      edges.push({
        source: node.parentId,
        target: node.id,
        type: inferParentEdgeType(node),
      });
    }

    node.relations
      .filter((relation) => nodeIds.has(relation))
      .forEach((relation) => {
        const [source, target] = [node.id, relation].sort();
        edges.push({
          source,
          target,
          type: "related",
        });
      });
  });

  const unique = new Map();
  edges.forEach((edge) => {
    const key = edge.type === "related"
      ? `${[edge.source, edge.target].sort().join("::")}::related`
      : `${edge.source}::${edge.target}::${edge.type}`;
    if (!unique.has(key)) {
      unique.set(key, edge);
    }
  });
  return [...unique.values()];
}

function inferParentEdgeType(node) {
  if (node.type === "file" || node.type === "error" || node.type === "edit") {
    return node.type;
  }
  return "parent";
}

function sortGlobalNodes(nodes) {
  const order = {
    workspace: 0,
    project: 1,
    service: 2,
    backend: 3,
    ui: 4,
    memory: 5,
    observability: 6,
    file: 7,
    error: 8,
    edit: 9,
  };

  return [...nodes].sort((left, right) => {
    const leftOrder = order[left.type] ?? 99;
    const rightOrder = order[right.type] ?? 99;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.openIssues !== right.openIssues) {
      return right.openIssues - left.openIssues;
    }
    return left.name.localeCompare(right.name);
  });
}

function buildGraphMetrics(nodes) {
  return nodes.reduce(
    (acc, node) => {
      acc.total += 1;
      acc.openIssues += Number(node.openIssues || 0);
      acc.byType[node.type] = (acc.byType[node.type] || 0) + 1;
      return acc;
    },
    {
      total: 0,
      openIssues: 0,
      byType: {},
    }
  );
}

function renderGraphMap(displayGraph, activeNodeId, options = {}) {
  if (!displayGraph?.nodes?.length) {
    graphOrbitGuides.innerHTML = "";
    graphEdges.innerHTML = "";
    graphNodes.innerHTML = `<p class="empty-state">Graph canvas dang trong.</p>`;
    graphMinimap.innerHTML = "";
    graphHint.textContent = "graph canvas is empty";
    return;
  }

  Object.keys(graphLayout).forEach((nodeId) => {
    if (!displayGraph.nodes.some((node) => node.id === nodeId)) {
      delete graphLayout[nodeId];
    }
  });

  if (!options.skipSimulation) {
    runGraphSimulation(displayGraph);
  }

  const nodesById = new Map(displayGraph.nodes.map((node) => [node.id, node]));
  const linkedIds = new Set(displayGraph.edges.flatMap((edge) => [edge.source, edge.target]));
  const edgeBundleMeta = buildGraphEdgeBundleMeta(displayGraph.edges);
  const shouldLabelEdges = shouldShowGraphEdgeLabels(displayGraph);

  graphOrbitGuides.innerHTML = renderGraphOrbitGuides(displayGraph);
  graphEdges.innerHTML = displayGraph.edges
    .map((edge, edgeIndex) => renderGraphEdge(edge, nodesById, shouldLabelEdges, edgeIndex, edgeBundleMeta))
    .join("");

  graphNodes.innerHTML = displayGraph.nodes
    .map((node) => {
      const position = graphLayout[node.id];
      const linkedClass = linkedIds.has(node.id) ? "is-linked" : "";
      const labelSide = getLabelSide(position, displayGraph.mode);
      const detail = getNodeSecondaryDetail(node);
      const showLabel = shouldShowGraphLabel(node, displayGraph, activeNodeId);
      const size = getNodeSize(node);
      const selectedClass = selectedGraphNodeIds.has(node.id) || selectedGraphNodeId === node.id ? "is-selected" : "";
      const expandedClass = expandedGraphNodeId === node.id ? "is-expanded" : "";
      return `
        <div
          class="graph-node-wrap"
          data-node-id="${node.id}"
          data-graph-role="${node.graphRole || "global"}"
          data-label-side="${labelSide}"
          style="transform: translate(${Math.round(position.x - size / 2)}px, ${Math.round(position.y - size / 2)}px); --node-size: ${size}px;"
        >
          ${renderGraphNode(node, activeNodeId).replace('class="graph-node ', `class="graph-node ${linkedClass} ${selectedClass} ${expandedClass} `)}
          <div class="graph-node-label ${showLabel ? "is-visible" : ""}" data-node-id="${node.id}" data-select-node-id="${node.selectNodeId || node.id}" data-testid="graph-node-label">
            <strong>${node.name}</strong>
            <small>${node.type}</small>
            ${detail ? `<span>${detail}</span>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  applyViewTransform();
  renderMinimap(displayGraph);
  updateGraphHint(displayGraph);
  persistGraphPreferences();
}

function renderMinimap(displayGraph) {
  if (!displayGraph?.nodes?.length) {
    graphMinimap.innerHTML = "";
    return;
  }

  const rect = graphViewport.getBoundingClientRect();
  const viewportWidth = Math.max(rect.width / viewState.scale, 120);
  const viewportHeight = Math.max(rect.height / viewState.scale, 90);
  const viewportX = clamp(-viewState.offsetX / viewState.scale, 0, GRAPH_SCENE_WIDTH - viewportWidth);
  const viewportY = clamp(-viewState.offsetY / viewState.scale, 0, GRAPH_SCENE_HEIGHT - viewportHeight);

  graphMinimap.innerHTML = `
    <div class="graph-minimap-world" data-minimap-world="true">
      ${displayGraph.nodes
        .slice()
        .sort((left, right) => Number(Boolean(left.isCluster)) - Number(Boolean(right.isCluster)))
        .map((node) => {
          const layout = graphLayout[node.id];
          if (!layout) {
            return "";
          }
          const left = (layout.x / GRAPH_SCENE_WIDTH) * 100;
          const top = (layout.y / GRAPH_SCENE_HEIGHT) * 100;
          const hiddenCount = node.hiddenCount || node.memberIds?.length || 0;
          const minimapSize = node.isCluster ? clamp(9 + hiddenCount * 0.45, 10, 20) : 8;
          const countBadge = node.isCluster
            ? `<small class="graph-minimap-count">${formatClusterCount(hiddenCount)}</small>`
            : "";
          const title = node.isCluster
            ? `${node.name} · ${hiddenCount} hidden nodes`
            : `${node.name} · ${node.type}`;
          return `
            <span
              class="graph-minimap-node graph-minimap-node--${node.type} ${node.isCluster ? "is-cluster" : ""}"
              style="left:${left}%; top:${top}%; --minimap-node-size:${minimapSize}px;"
              title="${escapeHtmlAttribute(title)}"
              data-minimap-node-id="${node.id}"
              data-minimap-cluster="${node.isCluster ? "true" : "false"}"
            >
              ${countBadge}
            </span>
          `;
        })
        .join("")}
      <div
        class="graph-minimap-window"
        data-minimap-window="true"
        style="
          left:${(viewportX / GRAPH_SCENE_WIDTH) * 100}%;
          top:${(viewportY / GRAPH_SCENE_HEIGHT) * 100}%;
          width:${(viewportWidth / GRAPH_SCENE_WIDTH) * 100}%;
          height:${(viewportHeight / GRAPH_SCENE_HEIGHT) * 100}%;
        "
      ></div>
    </div>
  `;
}

function updateGraphHint(displayGraph) {
  const modeLabel =
    graphUiState.layoutMode === "hierarchy" ? "hierarchy" :
    graphUiState.layoutMode === "performance" ? "performance" :
    "orbital";
  const revealLabel =
    graphUiState.revealMode === "full" ? "full" :
    graphUiState.revealMode === "expanded" ? "expanded" :
    "priority";
  const hiddenSuffix = displayGraph.hiddenCount ? ` · +${displayGraph.hiddenCount} hidden` : "";
  graphHint.textContent = `${modeLabel} layout · ${revealLabel} density · ${displayGraph.nodes.length} nodes${hiddenSuffix} · drag node, pan canvas, wheel to zoom`;
}

function applyViewTransform() {
  graphScene.style.transform = `translate(${viewState.offsetX}px, ${viewState.offsetY}px) scale(${viewState.scale})`;
}

function resetGraphView() {
  viewState = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  graphFocusNodeId = null;
  focusedContextGraph = null;
  selectedGraphNodeId = null;
  expandedGraphNodeId = null;
  selectedGraphNodeIds = new Set();
  expandedClusterIds = new Set();
  promotedGraphNodeIds = new Set();
  applyViewTransform();
  persistGraphPreferences();
  render();
}

function releasePinnedNodes() {
  Object.values(graphLayout).forEach((layout) => {
    layout.pinned = false;
    layout.anchorStrength = 0;
    layout.anchorX = null;
    layout.anchorY = null;
  });
  persistGraphPreferences();
  renderGraphMap(currentDisplayGraph, store.activeNodeId);
  bindNodeSelection();
}

function zoomGraph(delta) {
  viewState.scale = clamp(viewState.scale + delta, 0.55, 1.85);
  applyViewTransform();
  persistGraphPreferences();
}

function recenterGraphView() {
  if (!currentDisplayGraph?.nodes?.length) {
    return;
  }

  const positions = currentDisplayGraph.nodes
    .map((node) => graphLayout[node.id])
    .filter(Boolean);
  if (!positions.length) {
    return;
  }

  const minX = Math.min(...positions.map((item) => item.x));
  const maxX = Math.max(...positions.map((item) => item.x));
  const minY = Math.min(...positions.map((item) => item.y));
  const maxY = Math.max(...positions.map((item) => item.y));
  const rect = graphViewport.getBoundingClientRect();
  const graphCenterX = (minX + maxX) / 2;
  const graphCenterY = (minY + maxY) / 2;

  viewState.offsetX = rect.width / 2 - graphCenterX * viewState.scale;
  viewState.offsetY = rect.height / 2 - graphCenterY * viewState.scale;
  applyViewTransform();
  persistGraphPreferences();
}

function fitGraphToScreen() {
  if (!currentDisplayGraph?.nodes?.length) {
    return;
  }

  const positions = currentDisplayGraph.nodes
    .map((node) => {
      const layout = graphLayout[node.id];
      if (!layout) {
        return null;
      }
      const size = getNodeSize(node);
      return {
        minX: layout.x - size / 2 - 26,
        maxX: layout.x + size / 2 + 26,
        minY: layout.y - size / 2 - 32,
        maxY: layout.y + size / 2 + 32,
      };
    })
    .filter(Boolean);
  if (!positions.length) {
    return;
  }

  const minX = Math.min(...positions.map((item) => item.minX));
  const maxX = Math.max(...positions.map((item) => item.maxX));
  const minY = Math.min(...positions.map((item) => item.minY));
  const maxY = Math.max(...positions.map((item) => item.maxY));
  const rect = graphViewport.getBoundingClientRect();
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scaleX = Math.max((rect.width - 48) / width, 0.1);
  const scaleY = Math.max((rect.height - 48) / height, 0.1);
  viewState.scale = clamp(Math.min(scaleX, scaleY), 0.55, 1.4);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  viewState.offsetX = rect.width / 2 - centerX * viewState.scale;
  viewState.offsetY = rect.height / 2 - centerY * viewState.scale;
  applyViewTransform();
  persistGraphPreferences();
}

function autoArrangeGraph() {
  if (!currentDisplayGraph?.nodes?.length) {
    return;
  }

  currentDisplayGraph.nodes.forEach((node) => {
    delete graphLayout[node.id];
  });
  selectedGraphNodeIds = new Set(
    [...selectedGraphNodeIds].filter((nodeId) => currentDisplayGraph.nodes.some((node) => node.id === nodeId))
  );
  renderGraphMap(currentDisplayGraph, store.activeNodeId);
  startGraphPhysicsAnimation(18);
  recenterGraphView();
}

function handleGraphWheel(event) {
  event.preventDefault();
  zoomGraph(event.deltaY < 0 ? 0.08 : -0.08);
}

function handleViewportPointerDown(event) {
  if (event.target.closest("[data-select-node-id]")) {
    return;
  }

  panState = {
    startX: event.clientX,
    startY: event.clientY,
    originOffsetX: viewState.offsetX,
    originOffsetY: viewState.offsetY,
  };
  graphViewport.classList.add("is-panning");
}

function handleNodePointerDown(event) {
  const nodeId = event.currentTarget.getAttribute("data-node-id");
  const position = graphLayout[nodeId];

  if (!position) {
    return;
  }

  cancelPendingGraphSelection();
  stopGraphPhysicsAnimation();
  const point = clientToGraphPoint(event.clientX, event.clientY);
  dragState = {
    nodeId,
    startX: event.clientX,
    startY: event.clientY,
    originX: position.x,
    originY: position.y,
    grabOffsetX: point.x - position.x,
    grabOffsetY: point.y - position.y,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    velocityX: 0,
    velocityY: 0,
    lastMoveAt: performance.now(),
    moved: false,
  };
  if (typeof event.currentTarget.setPointerCapture === "function") {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore browsers that reject pointer capture for detached nodes.
    }
  }
  selectedGraphNodeId = nodeId;
  if (!selectedGraphNodeIds.has(nodeId)) {
    selectedGraphNodeIds = new Set([nodeId]);
  }
  position.vx = 0;
  position.vy = 0;
  event.stopPropagation();
}

function handlePointerMove(event) {
  if (dragState) {
    const movedEnough =
      Math.abs(event.clientX - dragState.startX) > 4 ||
      Math.abs(event.clientY - dragState.startY) > 4;
    const point = clientToGraphPoint(event.clientX, event.clientY);
    const layout = graphLayout[dragState.nodeId];
    const now = performance.now();
    const elapsed = Math.max(now - (dragState.lastMoveAt || now), 16);
    const nextX = clamp(point.x - dragState.grabOffsetX, 60, GRAPH_SCENE_WIDTH - 60);
    const nextY = clamp(point.y - dragState.grabOffsetY, 60, GRAPH_SCENE_HEIGHT - 60);
    dragState.velocityX = ((nextX - layout.x) / elapsed) * 16;
    dragState.velocityY = ((nextY - layout.y) / elapsed) * 16;
    layout.x = nextX;
    layout.y = nextY;
    layout.vx = dragState.velocityX;
    layout.vy = dragState.velocityY;
    dragState.lastClientX = event.clientX;
    dragState.lastClientY = event.clientY;
    dragState.lastMoveAt = now;
    dragState.moved = dragState.moved || movedEnough;
    if (dragState.moved) {
      layout.dragging = true;
    }
    scheduleGraphMapRender({ skipSimulation: true });
    return;
  }

  if (minimapDragState) {
    const movedEnough =
      Math.abs(event.clientX - minimapDragState.startX) > 3 ||
      Math.abs(event.clientY - minimapDragState.startY) > 3;
    minimapDragState.moved = minimapDragState.moved || movedEnough;
    panGraphViewportToMinimapClientPoint(
      event.clientX,
      event.clientY,
      minimapDragState.anchorRatioX,
      minimapDragState.anchorRatioY
    );
    return;
  }

  if (panState) {
    viewState.offsetX = panState.originOffsetX + (event.clientX - panState.startX);
    viewState.offsetY = panState.originOffsetY + (event.clientY - panState.startY);
    applyViewTransform();
  }
}

function buildNeighborhood(nodes, focusNode, depth = 1) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map();

  const connect = (leftId, rightId) => {
    if (!leftId || !rightId || leftId === rightId) {
      return;
    }
    if (!adjacency.has(leftId)) {
      adjacency.set(leftId, new Set());
    }
    adjacency.get(leftId).add(rightId);
  };

  nodes.forEach((node) => {
    if (node.parentId && nodesById.has(node.parentId)) {
      connect(node.id, node.parentId);
      connect(node.parentId, node.id);
    }
    (node.relations || []).forEach((relationId) => {
      if (nodesById.has(relationId)) {
        connect(node.id, relationId);
        connect(relationId, node.id);
      }
    });
  });

  const visited = new Set([focusNode.id]);
  const queue = [{ id: focusNode.id, depth: 0 }];

  while (queue.length) {
    const current = queue.shift();
    const neighbors = adjacency.get(current.id) || new Set();
    if (current.depth >= depth) {
      continue;
    }
    neighbors.forEach((neighborId) => {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    });
  }

  const focusNeighbors = adjacency.get(focusNode.id) || new Set();
  const hasUsefulNeighbor = [...focusNeighbors].some((neighborId) => neighborId !== focusNode.parentId);
  if (!hasUsefulNeighbor && focusNode.parentId && adjacency.has(focusNode.parentId)) {
    [...adjacency.get(focusNode.parentId)]
      .filter((neighborId) => neighborId !== focusNode.id)
      .slice(0, 12)
      .forEach((neighborId) => visited.add(neighborId));
  }

  nodes
    .filter((node) => node.type === "file" && node.files.some((file) => focusNode.files.includes(file)))
    .forEach((node) => visited.add(node.id));

  return nodes.filter((node) => visited.has(node.id));
}

function inferFallbackGraphRole(node, focusNode) {
  if (node.id === focusNode.id) {
    return "focus";
  }
  if (node.id === focusNode.parentId) {
    return "parent";
  }
  if (node.parentId === focusNode.id) {
    return node.type === "file" || node.type === "error" || node.type === "edit" ? node.type : "child";
  }
  if (node.type === "file") {
    return "file";
  }
  if (node.type === "error") {
    return "error";
  }
  if (node.type === "edit") {
    return "edit";
  }
  return "related";
}

function runGraphSimulation(displayGraph) {
  const targets = buildGraphTargets(displayGraph);
  const springEdges = displayGraph.edges || [];
  const visibleNodes = displayGraph.nodes;
  const nodeCount = visibleNodes.length;
  const isPerformanceMode = graphUiState.layoutMode === "performance";
  const isHierarchyMode = graphUiState.layoutMode === "hierarchy";
  const layoutMode = `${displayGraph.mode}:${graphUiState.layoutMode}:${GRAPH_LAYOUT_VERSION}`;
  const iterations =
    isPerformanceMode
      ? (nodeCount > 56 ? 18 : 28)
      : displayGraph.mode === "global"
      ? nodeCount > 84
        ? 52
        : nodeCount > 42
          ? 76
          : 108
      : nodeCount > 24
        ? 72
        : 94;
  const attraction =
    isPerformanceMode
      ? 0.032
      : isHierarchyMode
        ? (displayGraph.mode === "global" ? 0.024 : 0.03)
        : (displayGraph.mode === "global" ? 0.018 : 0.026);
  const damping =
    isPerformanceMode ? 0.76 :
    isHierarchyMode ? 0.81 :
    displayGraph.mode === "global" ? 0.8 : 0.84;
  const maxVelocity = isPerformanceMode ? 14 : displayGraph.mode === "global" ? 18 : 24;

  visibleNodes.forEach((node) => {
    const target = targets[node.id] || { x: GRAPH_SCENE_WIDTH / 2, y: GRAPH_SCENE_HEIGHT / 2 };
    const existing = graphLayout[node.id];
    if (!existing || existing.mode !== layoutMode) {
      graphLayout[node.id] = {
        x: target.x + seededOffset(`${displayGraph.mode}:${node.id}:x`, 80),
        y: target.y + seededOffset(`${displayGraph.mode}:${node.id}:y`, 80),
        vx: 0,
        vy: 0,
        anchorX: existing?.anchorX ?? null,
        anchorY: existing?.anchorY ?? null,
        anchorStrength: existing?.anchorStrength ?? 0,
        pinned: existing?.pinned || false,
        mode: layoutMode,
      };
      return;
    }

    existing.mode = layoutMode;
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    visibleNodes.forEach((node) => {
      const layout = graphLayout[node.id];
      const baseTarget = targets[node.id] || { x: GRAPH_SCENE_WIDTH / 2, y: GRAPH_SCENE_HEIGHT / 2 };
      const anchorStrength = clamp(Number(layout.anchorStrength) || 0, 0, 0.92);
      const target = anchorStrength
        ? {
            x: baseTarget.x * (1 - anchorStrength) + (layout.anchorX ?? baseTarget.x) * anchorStrength,
            y: baseTarget.y * (1 - anchorStrength) + (layout.anchorY ?? baseTarget.y) * anchorStrength,
          }
        : baseTarget;
      layout.fx = (target.x - layout.x) * attraction;
      layout.fy = (target.y - layout.y) * attraction;
      if (layout.anchorStrength) {
        layout.anchorStrength = Math.max(0, layout.anchorStrength - 0.0022);
      }
    });

    springEdges.forEach((edge) => {
      const source = graphLayout[edge.source];
      const target = graphLayout[edge.target];
      if (!source || !target) {
        return;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const desired =
        edge.type === "related" ? 145 :
        edge.type === "parent" ? 105 :
        edge.type === "file" ? 118 :
        92;
      const force = (distance - desired) * 0.01;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.fx += fx;
      source.fy += fy;
      target.fx -= fx;
      target.fy -= fy;
    });

    forEachVisibleRepulsionPair(visibleNodes, displayGraph.mode, (leftNode, rightNode) => {
      const leftLayout = graphLayout[leftNode.id];
      const leftSize = getNodeSize(leftNode);
      const rightLayout = graphLayout[rightNode.id];
      const rightSize = getNodeSize(rightNode);
      const dx = rightLayout.x - leftLayout.x;
      const dy = rightLayout.y - leftLayout.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const minimum = getGraphCollisionMinimum(leftNode, rightNode, displayGraph.mode);
      const repulsion = (displayGraph.mode === "global" ? 2600 : 5200) / (distance * distance);
      const overlap = Math.max(minimum - distance, 0) * 0.11;
      const force = repulsion + overlap;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      leftLayout.fx -= fx;
      leftLayout.fy -= fy;
      rightLayout.fx += fx;
      rightLayout.fy += fy;
    });

    visibleNodes.forEach((node) => {
      const layout = graphLayout[node.id];
      if (layout.pinned && (!dragState || dragState.nodeId !== node.id)) {
        layout.vx = 0;
        layout.vy = 0;
        return;
      }
      if (layout.dragging) {
        layout.vx = 0;
        layout.vy = 0;
        return;
      }

      layout.vx = clamp((layout.vx + layout.fx) * damping, -maxVelocity, maxVelocity);
      layout.vy = clamp((layout.vy + layout.fy) * damping, -maxVelocity, maxVelocity);
      layout.x = clamp(layout.x + layout.vx, 60, GRAPH_SCENE_WIDTH - 60);
      layout.y = clamp(layout.y + layout.vy, 60, GRAPH_SCENE_HEIGHT - 60);
    });

    applyGraphCollisionPass(visibleNodes, displayGraph.mode);
  }
}

function runGraphPhysicsTick(displayGraph) {
  if (!displayGraph?.nodes?.length) {
    return;
  }
  const targets = buildGraphTargets(displayGraph);
  const visibleNodes = displayGraph.nodes;
  const springEdges = displayGraph.edges || [];
  const attraction = displayGraph.mode === "global" ? 0.006 : 0.009;
  const damping = 0.88;
  const maxVelocity = 9;

  visibleNodes.forEach((node) => {
    const layout = graphLayout[node.id];
    if (!layout) {
      return;
    }
    const baseTarget = targets[node.id] || { x: GRAPH_SCENE_WIDTH / 2, y: GRAPH_SCENE_HEIGHT / 2 };
    const anchorStrength = clamp(Number(layout.anchorStrength) || 0, 0, 0.92);
    const target = anchorStrength
      ? {
          x: baseTarget.x * (1 - anchorStrength) + (layout.anchorX ?? baseTarget.x) * anchorStrength,
          y: baseTarget.y * (1 - anchorStrength) + (layout.anchorY ?? baseTarget.y) * anchorStrength,
        }
      : baseTarget;
    layout.fx = (target.x - layout.x) * attraction;
    layout.fy = (target.y - layout.y) * attraction;
    if (layout.anchorStrength) {
      layout.anchorStrength = Math.max(0, layout.anchorStrength - 0.018);
    }
  });

  springEdges.forEach((edge) => {
    const source = graphLayout[edge.source];
    const target = graphLayout[edge.target];
    if (!source || !target) {
      return;
    }
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const desired =
      edge.type === "related" ? 162 :
      edge.type === "parent" ? 112 :
      edge.type === "file" ? 132 :
      104;
    const force = (distance - desired) * 0.0038;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    source.fx += fx;
    source.fy += fy;
    target.fx -= fx;
    target.fy -= fy;
  });

  forEachVisibleRepulsionPair(visibleNodes, displayGraph.mode, (leftNode, rightNode) => {
    const leftLayout = graphLayout[leftNode.id];
    const rightLayout = graphLayout[rightNode.id];
    if (!leftLayout || !rightLayout) {
      return;
    }
    const dx = rightLayout.x - leftLayout.x;
    const dy = rightLayout.y - leftLayout.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const minimum = getGraphCollisionMinimum(leftNode, rightNode, displayGraph.mode);
    if (distance > minimum * 1.55) {
      return;
    }
    const overlap = Math.max(minimum - distance, 0);
    const force = overlap * 0.052 + (displayGraph.mode === "global" ? 620 : 840) / (distance * distance);
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    leftLayout.fx -= fx;
    leftLayout.fy -= fy;
    rightLayout.fx += fx;
    rightLayout.fy += fy;
  });

  visibleNodes.forEach((node) => {
    const layout = graphLayout[node.id];
    if (!layout || layout.dragging || layout.pinned) {
      if (layout) {
        layout.vx = 0;
        layout.vy = 0;
      }
      return;
    }
    layout.vx = clamp((layout.vx + layout.fx) * damping, -maxVelocity, maxVelocity);
    layout.vy = clamp((layout.vy + layout.fy) * damping, -maxVelocity, maxVelocity);
    layout.x = clamp(layout.x + layout.vx, 60, GRAPH_SCENE_WIDTH - 60);
    layout.y = clamp(layout.y + layout.vy, 60, GRAPH_SCENE_HEIGHT - 60);
  });

  applyGraphCollisionPass(visibleNodes, displayGraph.mode);
}

function buildGraphTargets(displayGraph) {
  return displayGraph.mode === "focus"
    ? buildFocusTargets(displayGraph.nodes, displayGraph.focalNodeId)
    : buildGlobalTargets(displayGraph.nodes);
}

function buildFocusTargets(nodes, focusNodeId) {
  if (graphUiState.layoutMode === "hierarchy") {
    return buildFocusHierarchyTargets(nodes, focusNodeId);
  }
  if (graphUiState.layoutMode === "performance") {
    return buildFocusPerformanceTargets(nodes, focusNodeId);
  }
  return buildFocusOrbitalTargets(nodes, focusNodeId);
}

function buildFocusOrbitalTargets(nodes, focusNodeId) {
  const targets = {};
  const centerX = GRAPH_SCENE_WIDTH / 2;
  const centerY = GRAPH_SCENE_HEIGHT / 2;
  const focusNode = nodes.find((node) => node.id === focusNodeId) || null;
  const shellGroups = [
    {
      key: "nucleus",
      nodes: nodes.filter((node) => node.graphRole === "ancestor" || node.graphRole === "parent" || node.graphRole === "child"),
      radiusX: 140,
      radiusY: 108,
      startAngle: -120,
      angleSpan: 320,
    },
    {
      key: "files",
      nodes: nodes.filter((node) => node.graphRole === "file" && node.id !== focusNodeId),
      radiusX: 250,
      radiusY: 194,
      startAngle: -96,
      angleSpan: 360,
    },
    {
      key: "signals",
      nodes: nodes.filter((node) => node.graphRole === "error" || node.graphRole === "edit"),
      radiusX: 360,
      radiusY: 278,
      startAngle: -80,
      angleSpan: 360,
    },
    {
      key: "related",
      nodes: nodes.filter((node) => node.graphRole === "related"),
      radiusX: 472,
      radiusY: 364,
      startAngle: -70,
      angleSpan: 360,
    },
  ];

  if (focusNode) {
    targets[focusNode.id] = { x: centerX, y: centerY };
  }

  shellGroups.forEach((shell) => {
    assignOrbitTargets(targets, shell.nodes, centerX, centerY, shell.radiusX, shell.radiusY, shell.key, {
      startAngle: shell.startAngle,
      angleSpan: shell.angleSpan,
    });
  });

  return targets;
}

function buildGlobalTargets(nodes) {
  if (graphUiState.layoutMode === "hierarchy") {
    return buildGlobalHierarchyTargets(nodes);
  }
  if (graphUiState.layoutMode === "performance") {
    return buildGlobalPerformanceTargets(nodes);
  }
  return buildGlobalOrbitalTargets(nodes);
}

function buildGlobalOrbitalTargets(nodes) {
  const targets = {};
  const centerX = GRAPH_SCENE_WIDTH / 2;
  const centerY = GRAPH_SCENE_HEIGHT / 2;
  const shellBuckets = new Map();
  let nucleusNode = null;

  nodes.forEach((node) => {
    if (!nucleusNode && (node.type === "project" || node.type === "workspace")) {
      nucleusNode = node;
      return;
    }
    const shellIndex = getGlobalOrbitalShellIndex(node);
    if (!shellBuckets.has(shellIndex)) {
      shellBuckets.set(shellIndex, []);
    }
    shellBuckets.get(shellIndex).push(node);
  });

  if (nucleusNode) {
    targets[nucleusNode.id] = { x: centerX, y: centerY };
  }

  const shellIndexes = [...shellBuckets.keys()].sort((left, right) => left - right);
  shellIndexes.forEach((shellIndex) => {
    const shellNodes = shellBuckets.get(shellIndex) || [];
    const radiusX = 138 + shellIndex * 112;
    const radiusY = 108 + shellIndex * 88;
    assignOrbitTargets(targets, shellNodes, centerX, centerY, radiusX, radiusY, `global-shell-${shellIndex}`, {
      startAngle: shellIndex % 2 === 0 ? -90 : -58,
      angleSpan: 360,
    });
  });

  return targets;
}

function buildFocusHierarchyTargets(nodes, focusNodeId) {
  const targets = {};
  const centerX = GRAPH_SCENE_WIDTH / 2;
  const focusY = 270;
  const parentNodes = nodes.filter((node) => node.graphRole === "ancestor" || node.graphRole === "parent");
  const focusNode = nodes.find((node) => node.id === focusNodeId);
  const childNodes = nodes.filter((node) => node.graphRole === "child");
  const fileNodes = nodes.filter((node) => node.graphRole === "file" && node.id !== focusNodeId);
  const signalNodes = nodes.filter((node) => node.graphRole === "error" || node.graphRole === "edit");
  const relatedNodes = nodes.filter((node) => node.graphRole === "related");

  assignCenteredRowTargets(targets, parentNodes, centerX, 126, 172);
  if (focusNode) {
    targets[focusNode.id] = { x: centerX, y: focusY };
  }
  assignCenteredRowTargets(targets, childNodes, centerX, 454, 170);
  assignCenteredRowTargets(targets, fileNodes, centerX, 632, 154);
  assignCenteredRowTargets(targets, signalNodes, centerX, 818, 150);
  assignCenteredRowTargets(targets, relatedNodes, centerX, 982, 140);
  return targets;
}

function buildFocusPerformanceTargets(nodes, focusNodeId) {
  const targets = {};
  const columns = [
    nodes.filter((node) => node.graphRole === "ancestor" || node.graphRole === "parent"),
    nodes.filter((node) => node.id === focusNodeId || node.graphRole === "child"),
    nodes.filter((node) => node.graphRole === "file"),
    nodes.filter((node) => node.graphRole === "error" || node.graphRole === "edit" || node.graphRole === "related"),
  ];

  columns.forEach((columnNodes, columnIndex) => {
    const x = 220 + columnIndex * 340;
    columnNodes.forEach((node, rowIndex) => {
      targets[node.id] = {
        x,
        y: 170 + rowIndex * 124,
      };
    });
  });

  return targets;
}

function buildGlobalHierarchyTargets(nodes) {
  const targets = {};
  const typeGroups = [
    ["project", "workspace"],
    ["file"],
    ["error", "edit"],
    ["module", "concept", "source"],
  ];
  let fallbackIndex = typeGroups.length;

  nodes.forEach((node) => {
    const typeIndex = typeGroups.findIndex((group) => group.includes(node.type));
    if (typeIndex === -1) {
      const key = `fallback:${node.type}`;
      if (!targets.__fallbackMap) {
        targets.__fallbackMap = new Map();
      }
      if (!targets.__fallbackMap.has(key)) {
        targets.__fallbackMap.set(key, fallbackIndex++);
      }
    }
  });

  const grouped = new Map();
  nodes.forEach((node) => {
    const typeIndex = typeGroups.findIndex((group) => group.includes(node.type));
    const layerIndex = typeIndex >= 0 ? typeIndex : targets.__fallbackMap.get(`fallback:${node.type}`);
    if (!grouped.has(layerIndex)) {
      grouped.set(layerIndex, []);
    }
    grouped.get(layerIndex).push(node);
  });

  [...grouped.keys()].sort((left, right) => left - right).forEach((layerIndex) => {
    assignCenteredRowTargets(targets, grouped.get(layerIndex), GRAPH_SCENE_WIDTH / 2, 160 + layerIndex * 200, 146);
  });

  delete targets.__fallbackMap;
  return targets;
}

function buildGlobalPerformanceTargets(nodes) {
  const targets = {};
  const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
  const gapX = clamp(Math.round((GRAPH_SCENE_WIDTH - 220) / columns), 150, 230);
  const gapY = 126;
  const sorted = [...nodes].sort((left, right) => {
    const typeDelta = (left.type || "").localeCompare(right.type || "");
    if (typeDelta !== 0) {
      return typeDelta;
    }
    return left.name.localeCompare(right.name);
  });

  sorted.forEach((node, index) => {
    const columnIndex = index % columns;
    const rowIndex = Math.floor(index / columns);
    targets[node.id] = {
      x: 120 + columnIndex * gapX,
      y: 120 + rowIndex * gapY,
    };
  });

  return targets;
}

function buildOrganicClusterCenters(count) {
  if (!count) {
    return [];
  }

  const centers = [];
  const centerX = GRAPH_SCENE_WIDTH / 2;
  const centerY = GRAPH_SCENE_HEIGHT / 2;
  let placed = 0;
  let ring = 0;

  while (placed < count) {
    const ringCount = ring === 0 ? 1 : Math.max(6, ring * 6);
    const radius = ring === 0 ? 0 : 170 + (ring - 1) * 190;
    const angleOffset = ring % 2 === 0 ? Math.PI / 8 : -Math.PI / 12;

    for (let index = 0; index < ringCount && placed < count; index += 1) {
      if (ring === 0) {
        centers.push({ x: centerX, y: centerY });
        placed += 1;
        continue;
      }
      const angle = angleOffset + (index / ringCount) * Math.PI * 2;
      centers.push({
        x: clamp(centerX + Math.cos(angle) * radius, 130, GRAPH_SCENE_WIDTH - 130),
        y: clamp(centerY + Math.sin(angle) * radius * 0.78, 120, GRAPH_SCENE_HEIGHT - 120),
      });
      placed += 1;
    }
    ring += 1;
  }

  return centers;
}

function assignClusterTargets(targets, nodes, centerX, centerY, width, height, seedKey = "") {
  if (!nodes.length) {
    return;
  }

  const ordered = [...nodes].sort((left, right) => {
    const leftWeight = (left.openIssues || 0) + (left.relations?.length || 0) + seededOffset(`${seedKey}:${left.id}`, 1);
    const rightWeight = (right.openIssues || 0) + (right.relations?.length || 0) + seededOffset(`${seedKey}:${right.id}`, 1);
    return rightWeight - leftWeight || left.name.localeCompare(right.name);
  });
  const columns = estimateClusterColumns(ordered.length, width, height);
  const rows = Math.max(1, Math.ceil(ordered.length / columns));
  const gapX = clamp(Math.round((width - 80) / Math.max(columns, 1)), 118, 182);
  const gapY = clamp(Math.round((height - 90) / Math.max(rows, 1)), 102, 150);
  const startX = centerX - ((columns - 1) * gapX) / 2;
  const startY = centerY - ((rows - 1) * gapY) / 2;

  ordered.forEach((node, index) => {
    const columnIndex = index % columns;
    const rowIndex = Math.floor(index / columns);
    const stagger = columnIndex % 2 === 0 ? -12 : 12;
    targets[node.id] = {
      x: clamp(startX + columnIndex * gapX + seededOffset(`${seedKey}:${node.id}:x`, 12), 90, GRAPH_SCENE_WIDTH - 90),
      y: clamp(startY + rowIndex * gapY + stagger + seededOffset(`${seedKey}:${node.id}:y`, 12), 84, GRAPH_SCENE_HEIGHT - 84),
    };
  });
}

function assignOrganicClusterTargets(targets, nodes, centerX, centerY, seedKey = "") {
  if (!nodes.length) {
    return;
  }

  const ordered = [...nodes].sort((left, right) => {
    const leftWeight = (left.openIssues || 0) * 3 + (left.relations?.length || 0);
    const rightWeight = (right.openIssues || 0) * 3 + (right.relations?.length || 0);
    return rightWeight - leftWeight || left.name.localeCompare(right.name);
  });

  const anchor = ordered.shift();
  if (anchor) {
    targets[anchor.id] = {
      x: clamp(centerX + seededOffset(`${seedKey}:${anchor.id}:x`, 16), 90, GRAPH_SCENE_WIDTH - 90),
      y: clamp(centerY + seededOffset(`${seedKey}:${anchor.id}:y`, 16), 84, GRAPH_SCENE_HEIGHT - 84),
    };
  }

  if (!ordered.length) {
    return;
  }

  let placed = 0;
  let ring = 1;
  while (placed < ordered.length) {
    const ringCount = Math.min(ordered.length - placed, Math.max(6, ring * 6));
    const radiusX = 76 + ring * 52;
    const radiusY = 58 + ring * 44;
    const angleOffset = seededOffset(`${seedKey}:ring:${ring}`, 10) * (Math.PI / 180);

    for (let index = 0; index < ringCount && placed < ordered.length; index += 1) {
      const node = ordered[placed];
      const angle = angleOffset + (index / ringCount) * Math.PI * 2;
      targets[node.id] = {
        x: clamp(centerX + Math.cos(angle) * radiusX + seededOffset(`${seedKey}:${node.id}:x`, 10), 90, GRAPH_SCENE_WIDTH - 90),
        y: clamp(centerY + Math.sin(angle) * radiusY + seededOffset(`${seedKey}:${node.id}:y`, 10), 84, GRAPH_SCENE_HEIGHT - 84),
      };
      placed += 1;
    }

    ring += 1;
  }
}

function assignOrbitTargets(
  targets,
  nodes,
  centerX,
  centerY,
  radiusX,
  radiusY,
  seedKey = "",
  options = {}
) {
  if (!nodes.length) {
    return;
  }

  const ordered = [...nodes].sort((left, right) => {
    const leftWeight = (left.openIssues || 0) * 3 + (left.relations?.length || 0);
    const rightWeight = (right.openIssues || 0) * 3 + (right.relations?.length || 0);
    return rightWeight - leftWeight || left.name.localeCompare(right.name);
  });
  const startAngle = options.startAngle ?? -90;
  const angleSpan = options.angleSpan ?? 360;
  const angleOffset = seededOffset(`${seedKey}:orbit`, 8);

  ordered.forEach((node, index) => {
    const ratio = ordered.length === 1 ? 0.5 : index / ordered.length;
    const angleDeg = startAngle + angleOffset + ratio * angleSpan;
    const angle = angleDeg * (Math.PI / 180);
    const shellStretch = 1 + (ordered.length > 10 ? Math.min(0.16, ordered.length * 0.01) : 0);
    const jitterX = seededOffset(`${seedKey}:${node.id}:x`, 10);
    const jitterY = seededOffset(`${seedKey}:${node.id}:y`, 10);
    targets[node.id] = {
      x: clamp(centerX + Math.cos(angle) * radiusX * shellStretch + jitterX, 90, GRAPH_SCENE_WIDTH - 90),
      y: clamp(centerY + Math.sin(angle) * radiusY * shellStretch + jitterY, 84, GRAPH_SCENE_HEIGHT - 84),
    };
  });
}

function getGlobalOrbitalShellIndex(node) {
  const type = String(node.type || "").toLowerCase();
  const role = String(node.graphRole || "").toLowerCase();
  if (type === "workspace" || type === "project") {
    return 0;
  }
  if (type === "file" || role === "file" || type === "module" || type === "service" || type === "ui" || type === "backend") {
    return 1;
  }
  if (type === "error" || type === "edit" || role === "error" || role === "edit") {
    return 2;
  }
  if (type === "cluster" || role === "related") {
    return 4;
  }
  return 3;
}

function estimateClusterColumns(count, width, height) {
  if (count <= 2) {
    return count;
  }
  const widthRatio = Math.max(width, 1) / Math.max(height, 1);
  const guess = Math.ceil(Math.sqrt(count * Math.max(widthRatio, 0.8) * 0.72));
  return clamp(guess, 1, Math.min(4, count));
}

function getGraphCollisionMinimum(leftNode, rightNode, mode) {
  const leftSize = getNodeSize(leftNode);
  const rightSize = getNodeSize(rightNode);
  const baseGap = mode === "global" ? 30 : 38;
  return leftSize + rightSize + baseGap;
}

function applyGraphCollisionPass(nodes, mode) {
  forEachVisibleRepulsionPair(nodes, mode, (leftNode, rightNode) => {
    const leftLayout = graphLayout[leftNode.id];
    const rightLayout = graphLayout[rightNode.id];
    if (!leftLayout || !rightLayout) {
      return;
    }

    const dx = rightLayout.x - leftLayout.x;
    const dy = rightLayout.y - leftLayout.y;
    const distance = Math.max(Math.hypot(dx, dy), 0.5);
    const minimum = getGraphCollisionMinimum(leftNode, rightNode, mode);
    if (distance >= minimum) {
      return;
    }

    const overlap = minimum - distance;
    const pushX = (dx / distance) * overlap * 0.55;
    const pushY = (dy / distance) * overlap * 0.55;
    const leftPinned = leftLayout.pinned && (!dragState || dragState.nodeId !== leftNode.id);
    const rightPinned = rightLayout.pinned && (!dragState || dragState.nodeId !== rightNode.id);

    if (!leftPinned && !rightPinned) {
      leftLayout.x = clamp(leftLayout.x - pushX * 0.5, 60, GRAPH_SCENE_WIDTH - 60);
      leftLayout.y = clamp(leftLayout.y - pushY * 0.5, 60, GRAPH_SCENE_HEIGHT - 60);
      rightLayout.x = clamp(rightLayout.x + pushX * 0.5, 60, GRAPH_SCENE_WIDTH - 60);
      rightLayout.y = clamp(rightLayout.y + pushY * 0.5, 60, GRAPH_SCENE_HEIGHT - 60);
      return;
    }

    if (!leftPinned) {
      leftLayout.x = clamp(leftLayout.x - pushX, 60, GRAPH_SCENE_WIDTH - 60);
      leftLayout.y = clamp(leftLayout.y - pushY, 60, GRAPH_SCENE_HEIGHT - 60);
    }
    if (!rightPinned) {
      rightLayout.x = clamp(rightLayout.x + pushX, 60, GRAPH_SCENE_WIDTH - 60);
      rightLayout.y = clamp(rightLayout.y + pushY, 60, GRAPH_SCENE_HEIGHT - 60);
    }
  });
}

function forEachVisibleRepulsionPair(nodes, mode, callback) {
  if (nodes.length <= 26) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        callback(nodes[leftIndex], nodes[rightIndex]);
      }
    }
    return;
  }

  const bucketSize = mode === "global" ? 180 : 210;
  const buckets = new Map();
  nodes.forEach((node, index) => {
    const layout = graphLayout[node.id];
    if (!layout) {
      return;
    }
    const bucketX = Math.floor(layout.x / bucketSize);
    const bucketY = Math.floor(layout.y / bucketSize);
    const key = `${bucketX}:${bucketY}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push({ node, index, bucketX, bucketY });
  });

  const seen = new Set();
  let pairCount = 0;

  buckets.forEach((entries) => {
    entries.forEach((entry) => {
      for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
        for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
          const neighborEntries = buckets.get(`${entry.bucketX + deltaX}:${entry.bucketY + deltaY}`);
          if (!neighborEntries) {
            continue;
          }
          neighborEntries.forEach((neighbor) => {
            if (entry.index >= neighbor.index) {
              return;
            }
            const pairKey = `${entry.index}:${neighbor.index}`;
            if (seen.has(pairKey)) {
              return;
            }
            seen.add(pairKey);
            pairCount += 1;
            callback(entry.node, neighbor.node);
          });
        }
      }
    });
  });

  if (pairCount >= nodes.length) {
    return;
  }

  const ordered = [...nodes].sort((left, right) => graphLayout[left.id].x - graphLayout[right.id].x);
  for (let index = 0; index < ordered.length; index += 1) {
    for (let offset = 1; offset <= 3 && index + offset < ordered.length; offset += 1) {
      callback(ordered[index], ordered[index + offset]);
    }
  }
}

function groupNodesByCluster(nodes) {
  return nodes.reduce((groups, node) => {
    const clusterKey = getNodeClusterKey(node);
    if (!groups.has(clusterKey)) {
      groups.set(clusterKey, []);
    }
    groups.get(clusterKey).push(node);
    return groups;
  }, new Map());
}

function getNodeClusterKey(node) {
  if (node.parentId) {
    return `parent:${node.parentId}`;
  }
  if (node.type === "project" || node.type === "workspace") {
    return `root:${node.id}`;
  }
  if (node.relations?.length) {
    return `rel:${node.relations.slice().sort()[0]}`;
  }
  return `type:${node.type}`;
}

function assignLineTargets(targets, nodes, startX, startY, gapX, gapY) {
  nodes.forEach((node, index) => {
    targets[node.id] = {
      x: startX + gapX * index,
      y: startY + gapY * index,
    };
  });
}

function assignCenteredRowTargets(targets, nodes, centerX, y, gapX) {
  if (!nodes.length) {
    return;
  }
  const sorted = [...nodes].sort((left, right) => {
    if ((right.openIssues || 0) !== (left.openIssues || 0)) {
      return (right.openIssues || 0) - (left.openIssues || 0);
    }
    return left.name.localeCompare(right.name);
  });
  const startX = centerX - ((sorted.length - 1) * gapX) / 2;
  sorted.forEach((node, index) => {
    targets[node.id] = {
      x: startX + index * gapX,
      y,
    };
  });
}

function assignArcTargets(targets, nodes, centerX, centerY, radiusX, radiusY, startDeg, endDeg, seedKey = "") {
  if (!nodes.length) {
    return;
  }

  const ordered = [...nodes].sort((left, right) => {
    const leftWeight = (left.openIssues || 0) + seededOffset(`${seedKey}:${left.id}`, 1);
    const rightWeight = (right.openIssues || 0) + seededOffset(`${seedKey}:${right.id}`, 1);
    return rightWeight - leftWeight;
  });

  ordered.forEach((node, index) => {
    const ratio = ordered.length === 1 ? 0.5 : index / (ordered.length - 1);
    const angle = (startDeg + (endDeg - startDeg) * ratio) * (Math.PI / 180);
    targets[node.id] = {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  });
}

function renderGraphOrbitGuides(displayGraph) {
  if (graphUiState.layoutMode !== "balanced" || !displayGraph?.nodes?.length) {
    return "";
  }
  const rings = buildGraphOrbitGuideRings(displayGraph);
  if (!rings.length) {
    return "";
  }
  return rings.map((ring, index) => `
    <g class="graph-orbit-guide graph-orbit-guide--${ring.kind || "shell"}" style="--orbit-index:${index};">
      <ellipse
        cx="${ring.cx}"
        cy="${ring.cy}"
        rx="${ring.rx}"
        ry="${ring.ry}"
      ></ellipse>
      <text x="${ring.cx + ring.rx + 12}" y="${ring.cy - 6}">${escapeHtml(ring.label)}</text>
    </g>
  `).join("");
}

function buildGraphOrbitGuideRings(displayGraph) {
  const centerX = GRAPH_SCENE_WIDTH / 2;
  const centerY = GRAPH_SCENE_HEIGHT / 2;
  if (displayGraph.mode === "focus") {
    const counts = displayGraph.nodes.reduce((accumulator, node) => {
      const role = node.graphRole || "related";
      accumulator[role] = (accumulator[role] || 0) + 1;
      return accumulator;
    }, {});
    return [
      { label: `nucleus ${formatOrbitCount((counts.focus || 0) + (counts.parent || 0) + (counts.child || 0))}`, rx: 140, ry: 108, kind: "nucleus" },
      { label: `files ${formatOrbitCount(counts.file || 0)}`, rx: 250, ry: 194, kind: "file" },
      { label: `signals ${formatOrbitCount((counts.error || 0) + (counts.edit || 0))}`, rx: 360, ry: 278, kind: "signal" },
      { label: `related ${formatOrbitCount(counts.related || 0)}`, rx: 472, ry: 364, kind: "related" },
    ]
      .filter((ring) => !ring.label.endsWith(" 0"))
      .map((ring) => ({ ...ring, cx: centerX, cy: centerY }));
  }

  const shellCounts = new Map();
  displayGraph.nodes.forEach((node) => {
    if (node.type === "project" || node.type === "workspace") {
      return;
    }
    const shellIndex = getGlobalOrbitalShellIndex(node);
    shellCounts.set(shellIndex, (shellCounts.get(shellIndex) || 0) + 1);
  });
  return [...shellCounts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([shellIndex, count]) => ({
      cx: centerX,
      cy: centerY,
      rx: 138 + shellIndex * 112,
      ry: 108 + shellIndex * 88,
      label: `shell ${shellIndex} ${formatOrbitCount(count)}`,
      kind: `shell-${shellIndex}`,
    }));
}

function formatOrbitCount(count) {
  return count ? String(count) : "0";
}

function buildGraphEdgeBundleMeta(edges = []) {
  const byHub = new Map();
  edges.forEach((edge) => {
    const hub = getGraphEdgeBundleHub(edge);
    if (!byHub.has(hub)) {
      byHub.set(hub, []);
    }
    byHub.get(hub).push(edge);
  });
  const meta = new Map();
  byHub.forEach((items, hub) => {
    const ordered = [...items].sort((left, right) =>
      `${left.source}:${left.target}:${left.type}`.localeCompare(`${right.source}:${right.target}:${right.type}`)
    );
    const count = ordered.length;
    ordered.forEach((edge, index) => {
      meta.set(edge, {
        hub,
        count,
        index,
        offset: index - (count - 1) / 2,
      });
    });
  });
  return meta;
}

function getGraphEdgeBundleHub(edge) {
  if (edge.type === "parent") {
    return edge.source;
  }
  if (edge.type === "file" || edge.type === "error" || edge.type === "edit") {
    return edge.source;
  }
  return [edge.source, edge.target].sort()[0];
}

function shouldShowGraphEdgeLabels(displayGraph) {
  if (!displayGraph || graphUiState.labelMode === "selected") {
    return false;
  }
  if (displayGraph.mode !== "focus") {
    return false;
  }
  return (displayGraph.edges || []).length <= 34;
}

function renderGraphEdge(edge, nodesById, showLabel, edgeIndex = 0, bundleMeta = new Map()) {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const sourcePosition = graphLayout[edge.source];
  const targetPosition = graphLayout[edge.target];

  if (!sourceNode || !targetNode || !sourcePosition || !targetPosition) {
    return "";
  }

  const startX = sourcePosition.x;
  const startY = sourcePosition.y;
  const endX = targetPosition.x;
  const endY = targetPosition.y;
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const bundle = bundleMeta.get(edge) || { count: 1, offset: 0 };
  const bundleStrength = Math.min(bundle.count - 1, 8);
  const curve =
    (edge.type === "related" ? 34 : edge.type === "parent" ? 16 : edge.type === "cluster" ? 42 : 24)
    + bundle.offset * 9
    + bundleStrength * 2;
  const centerPull = shouldBundleGraphEdge(edge, bundle)
    ? clamp(distance / 640, 0.08, 0.28)
    : 0;
  const sceneCenterX = GRAPH_SCENE_WIDTH / 2;
  const sceneCenterY = GRAPH_SCENE_HEIGHT / 2;
  const controlX = (midX - (dy / distance) * curve) * (1 - centerPull) + sceneCenterX * centerPull;
  const controlY = (midY + (dx / distance) * curve) * (1 - centerPull) + sceneCenterY * centerPull;
  const labelX = (midX + controlX) / 2;
  const labelY = (midY + controlY) / 2 - 8;
  const bundledClass = shouldBundleGraphEdge(edge, bundle) ? " is-bundled" : "";
  const fadedClass = shouldFadeGraphEdgeLabel(edge, bundle, showLabel) ? " is-label-hidden" : "";

  return `
    <g class="graph-edge-group graph-edge-group--${edge.type}${bundledClass}">
      <path class="graph-edge graph-edge--${edge.type}" d="M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}"></path>
      ${showLabel && !fadedClass ? `<text class="graph-edge-label graph-edge-label--${edge.type}" x="${labelX}" y="${labelY}">${edge.type}</text>` : ""}
    </g>
  `;
}

function shouldBundleGraphEdge(edge, bundle) {
  return bundle.count >= 4 || edge.type === "related" || edge.type === "cluster";
}

function shouldFadeGraphEdgeLabel(edge, bundle, showLabel) {
  return !showLabel || bundle.count > 5 || edge.type === "related" || edge.type === "cluster";
}

function clientToGraphPoint(clientX, clientY) {
  const rect = graphViewport.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left - viewState.offsetX) / viewState.scale, 40, GRAPH_SCENE_WIDTH - 40),
    y: clamp((clientY - rect.top - viewState.offsetY) / viewState.scale, 40, GRAPH_SCENE_HEIGHT - 40),
  };
}

function seededOffset(seed, amplitude) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 2147483647;
  }
  return ((hash % 1000) / 1000 - 0.5) * amplitude * 2;
}

function renderBrainPanel(displayGraph, activeNode, filteredNodes) {
  brainLegend.innerHTML = renderGraphLegend();

  if (!displayGraph?.nodes?.length) {
    graphHint.textContent = "graph empty";
    brainModeTitle.textContent = "No graph";
    brainModeSummary.textContent = "Khong co node nao de hien thi.";
    brainBreadcrumbs.innerHTML = `<span class="brain-pill is-muted">Empty</span>`;
    brainStatsLabel.textContent = "0 links";
    brainInsights.innerHTML = `<p class="empty-state">Chua co node nao trong graph.</p>`;
    brainTrace.innerHTML = `<p class="empty-state">Chua co trace nao.</p>`;
    return;
  }

  if (displayGraph.mode === "global") {
    const metrics = displayGraph.metrics;
    const hotspots = [...displayGraph.nodes]
      .sort((left, right) => right.openIssues - left.openIssues || left.name.localeCompare(right.name))
      .slice(0, 8);

    brainModeTitle.textContent = "Global Atlas";
    brainModeSummary.textContent = "Ban do top-level cua app, service va workspace. Click mot node de thu hep ve context graph cua no.";
    brainBreadcrumbs.innerHTML = activeNode
      ? renderBreadcrumbPills([activeNode])
      : `<span class="brain-pill is-muted">Show all</span>`;
    brainStatsLabel.textContent = `${displayGraph.edges.length} links`;
    brainInsights.innerHTML = [
      renderInsightCard("Nodes", metrics.total, "Tong node dang hien thi"),
      renderInsightCard("Issues", metrics.openIssues, "Tong open issues tren global map"),
      renderInsightCard("Projects", metrics.byType.project || 0, "Project/workspace roots"),
      renderInsightCard(
        "Modules",
        (metrics.byType.service || 0) + (metrics.byType.backend || 0) + (metrics.byType.ui || 0) + (metrics.byType.memory || 0) + (metrics.byType.observability || 0),
        "Service, UI, backend, memory, observability"
      ),
    ].join("");
    brainTrace.innerHTML = hotspots.length
      ? hotspots.map((node) => renderTraceItem(node, "hotspot")).join("")
      : `<p class="empty-state">Khong co hotspot nao de hien thi.</p>`;
    return;
  }

  const focusNode = displayGraph.nodes.find((node) => node.id === displayGraph.focalNodeId) || activeNode;
  const breadcrumbs = getBreadcrumbNodes(displayGraph);
  const files = displayGraph.nodes.filter((node) => node.graphRole === "file");
  const errors = displayGraph.nodes.filter((node) => node.graphRole === "error");
  const edits = displayGraph.nodes.filter((node) => node.graphRole === "edit");
  const related = displayGraph.nodes.filter((node) => node.graphRole === "related");
  const children = displayGraph.nodes.filter((node) => node.graphRole === "child");
  const metrics = displayGraph.metrics || buildGraphMetrics(displayGraph.nodes);
  const rootNode = breadcrumbs[0] || focusNode;

  brainModeTitle.textContent = `Context Brain · ${focusNode?.name || "Node"}`;
  brainModeSummary.textContent = describeFocusGraph(rootNode, focusNode, { files, errors, edits, related, children });
  brainBreadcrumbs.innerHTML = breadcrumbs.length
    ? renderBreadcrumbPills(breadcrumbs)
    : `<span class="brain-pill is-muted">Focused node</span>`;
  brainStatsLabel.textContent = `${displayGraph.edges.length} links`;
  brainInsights.innerHTML = [
    renderInsightCard("Root", rootNode?.name || "-", rootNode?.type || "node"),
    renderInsightCard("Files", files.length, files[0] ? getTraceDetail(files[0]) : "No tracked file"),
    renderInsightCard("Errors", errors.length, errors[0] ? getTraceDetail(errors[0]) : "No captured error"),
    renderInsightCard("Edits", edits.length, edits[0] ? getTraceDetail(edits[0]) : "No recorded edit"),
    renderInsightCard("Related", related.length + children.length, related[0] ? related[0].name : children[0]?.name || "No adjacent node"),
    renderInsightCard("Open Issues", metrics.openIssues, focusNode?.severity || "unknown"),
  ].join("");
  const traceNodes = buildTraceNodes(displayGraph);
  brainTrace.innerHTML = traceNodes.length
    ? traceNodes.map((node) => renderTraceItem(node, node.graphRole || "trace")).join("")
    : `<p class="empty-state">Khong co trace item nao.</p>`;
}

function getBreadcrumbNodes(displayGraph) {
  if (!displayGraph?.focalNodeId) {
    return [];
  }

  const nodesById = new Map(displayGraph.nodes.map((node) => [node.id, node]));
  const parentByChild = new Map(
    displayGraph.edges
      .filter((edge) => edge.type === "parent")
      .map((edge) => [edge.target, edge.source])
  );

  const path = [];
  let currentId = displayGraph.focalNodeId;
  while (currentId) {
    const currentNode = nodesById.get(currentId);
    if (!currentNode) {
      break;
    }
    path.unshift(currentNode);
    currentId = parentByChild.get(currentId);
  }
  return path;
}

function renderBreadcrumbPills(nodes) {
  return nodes
    .map(
      (node) => `
        <button type="button" class="brain-pill" data-select-node-id="${node.selectNodeId || node.id}">
          <span>${node.name}</span>
          <small>${node.type}</small>
        </button>
      `
    )
    .join("");
}

function renderInsightCard(label, value, detail) {
  return `
    <article class="brain-insight-card">
      <small>${label}</small>
      <strong>${value}</strong>
      <span>${detail}</span>
    </article>
  `;
}

function buildTraceNodes(displayGraph) {
  const order = {
    ancestor: 0,
    parent: 1,
    focus: 2,
    file: 3,
    error: 4,
    edit: 5,
    child: 6,
    related: 7,
  };

  return [...displayGraph.nodes].sort((left, right) => {
    const leftOrder = order[left.graphRole] ?? 99;
    const rightOrder = order[right.graphRole] ?? 99;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if ((right.openIssues || 0) !== (left.openIssues || 0)) {
      return (right.openIssues || 0) - (left.openIssues || 0);
    }
    return left.name.localeCompare(right.name);
  });
}

function renderTraceItem(node, role) {
  return `
    <button
      type="button"
      class="trace-item trace-item--${role}"
      data-select-node-id="${node.selectNodeId || node.id}"
    >
      <div class="trace-item-head">
        <strong>${node.name}</strong>
        <span>${node.graphRole || role}</span>
      </div>
      <small>${node.type}</small>
      <p>${getTraceDetail(node)}</p>
    </button>
  `;
}

function getTraceDetail(node) {
  if (node.isCluster) {
    return `${node.hiddenCount || node.memberIds?.length || 0} low-signal nodes collapsed for smoother rendering.`;
  }
  if (node.type === "error") {
    return node.debugSignals?.[0]?.location || node.summary;
  }
  if (node.type === "edit") {
    return node.notes?.[0] || node.summary;
  }
  if (node.type === "file") {
    return node.files?.[0] || node.summary;
  }
  return node.summary;
}

function describeFocusGraph(rootNode, focusNode, groups) {
  const rootLabel = rootNode?.name ? `${rootNode.name}` : "root";
  return `${focusNode?.name || "Node"} dang nam duoi ${rootLabel}, lien ket ${groups.files.length} file, ${groups.errors.length} error node, ${groups.edits.length} edit node va ${groups.related.length + groups.children.length} node lien quan.`;
}

function renderGraphLegend() {
  return [
    renderLegendItem("Project / Workspace", "brain-swatch--project", "Node goc cua app hoac workspace"),
    renderLegendItem("Service / Module", "brain-swatch--module", "Component logic chinh de debug"),
    renderLegendItem("File", "brain-swatch--file", "File duoc track de truy vet"),
    renderLegendItem("Error", "brain-swatch--error", "Diem no symptom, stack, location"),
    renderLegendItem("Edit", "brain-swatch--edit", "Lan sua da duoc luu lai"),
    renderLegendItem("Collapsed Cluster", "brain-swatch--module", "Cum node low-signal duoc nen lai, click de bung"),
    renderLegendItem("Parent link", "brain-swatch--parent", "Quan he thu muc / ancestor"),
    renderLegendItem("Related link", "brain-swatch--related", "Quan he logic giua cac node"),
  ].join("");
}

function renderLegendItem(label, swatchClass, detail) {
  return `
    <article class="brain-legend-item">
      <div class="brain-legend-head">
        <span class="brain-swatch ${swatchClass}"></span>
        <strong>${label}</strong>
      </div>
      <p>${detail}</p>
    </article>
  `;
}

function getLabelSide(position, mode) {
  return "bottom";
}

function shouldShowGraphLabel(node, displayGraph, activeNodeId) {
  if (node.isCluster) {
    return true;
  }
  if (graphUiState.labelMode === "all") {
    return true;
  }

  if (graphUiState.labelMode === "selected") {
    return graphLayout[node.id]?.pinned ||
      selectedGraphNodeIds.has(node.id) ||
      node.id === selectedGraphNodeId ||
      node.id === expandedGraphNodeId;
  }

  if (graphLayout[node.id]?.pinned) {
    return true;
  }

  if (selectedGraphNodeIds.has(node.id) || node.id === selectedGraphNodeId || node.id === expandedGraphNodeId) {
    return true;
  }

  if (displayGraph.mode === "global") {
    return node.id === activeNodeId || node.id === graphFocusNodeId;
  }

  return (
    node.id === displayGraph.focalNodeId ||
    node.graphRole === "ancestor" ||
    node.graphRole === "parent" ||
    node.graphRole === "file" ||
    node.graphRole === "error" ||
    node.graphRole === "edit"
  );
}

function shouldShowNodeGlyph(node) {
  if (node.isCluster) {
    return true;
  }
  if (currentDisplayGraph?.mode === "focus") {
    return true;
  }

  return (
    node.id === store.activeNodeId ||
    node.id === graphFocusNodeId
  );
}

function getNodeSecondaryDetail(node) {
  if (node.isCluster) {
    return `${node.hiddenCount || node.memberIds?.length || 0} hidden nodes`;
  }
  const detail = getTraceDetail(node);
  if (!detail || detail === node.summary) {
    return truncateText(node.summary, 42);
  }
  return truncateText(detail, 42);
}

function truncateText(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || "";
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function getNodeSize(node) {
  if (node.isCluster) {
    const hiddenCount = node.hiddenCount || node.memberIds?.length || 0;
    return clamp(52 + hiddenCount * 3, 60, 104);
  }
  const isGlobal = currentDisplayGraph?.mode === "global";
  const role = node.graphRole || "global";
  if (isGlobal) {
    if (role === "focus") {
      return 30;
    }
    if (node.type === "project" || node.type === "workspace") {
      return 24;
    }
    if (node.type === "error") {
      return 16;
    }
    if (node.type === "edit" || node.type === "file") {
      return 14;
    }
    return 18;
  }

  if (role === "focus") {
    return 58;
  }
  if (role === "ancestor" || role === "parent") {
    return 30;
  }
  if (role === "error") {
    return 24;
  }
  if (role === "edit") {
    return 20;
  }
  if (role === "file") {
    return 24;
  }
  if (role === "related" || role === "child") {
    return 22;
  }
  return 26;
}

function getNodeGlyph(node) {
  if (node.isCluster) {
    return `+${node.hiddenCount || node.memberIds?.length || 0}`;
  }
  if (node.type === "project") {
    return "P";
  }
  if (node.type === "workspace") {
    return "W";
  }
  if (node.type === "service") {
    return "S";
  }
  if (node.type === "backend") {
    return "B";
  }
  if (node.type === "ui") {
    return "UI";
  }
  if (node.type === "memory") {
    return "M";
  }
  if (node.type === "observability") {
    return "O";
  }
  if (node.type === "file") {
    return "F";
  }
  if (node.type === "error") {
    return "E";
  }
  if (node.type === "edit") {
    return "ED";
  }
  return node.name.slice(0, 2).toUpperCase();
}

function handlePointerUp() {
  if (dragState) {
    const layout = graphLayout[dragState.nodeId];
    if (dragState.moved) {
      if (layout) {
        layout.dragging = false;
        layout.anchorX = layout.x;
        layout.anchorY = layout.y;
        layout.anchorStrength = graphInteractionMode === "pin" ? 0.92 : 0.72;
        layout.vx = clamp(dragState.velocityX || 0, -12, 12);
        layout.vy = clamp(dragState.velocityY || 0, -12, 12);
        if (graphInteractionMode === "pin") {
          layout.pinned = true;
        }
      }
      persistGraphPreferences();
      scheduleGraphMapRender();
      startGraphPhysicsAnimation(26);
    } else if (layout) {
      layout.dragging = false;
    }
    window.setTimeout(() => {
      dragState = null;
    }, 0);
  }

  if (panState) {
    panState = null;
    graphViewport.classList.remove("is-panning");
    persistGraphPreferences();
  }

  if (minimapDragState) {
    if (minimapDragState.moved) {
      suppressMinimapClickUntil = Date.now() + 180;
    }
    minimapDragState = null;
    graphMinimap.classList.remove("is-dragging-window");
    persistGraphPreferences();
  }
}

function togglePinnedNode(nodeId, options = {}) {
  if (!graphLayout[nodeId]) {
    return;
  }

  graphLayout[nodeId].pinned = !graphLayout[nodeId].pinned;
  persistGraphPreferences();
  if (options.skipRender) {
    return;
  }
  renderGraphMap(currentDisplayGraph, store.activeNodeId);
  bindNodeSelection();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function handleImport(event) {
  event.preventDefault();
  const sourcePath = importPathInput.value.trim();
  const mode = importModeInput.value;

  if (!sourcePath) {
    storageFeedback.textContent = "Hay nhap duong dan file export can import.";
    return;
  }

  const response = await fetch("/api/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourcePath, mode }),
  });

  const payload = await response.json();

  if (!response.ok) {
    storageFeedback.textContent = payload.message || "Import failed.";
    return;
  }

  storageFeedback.textContent = `Imported graph from ${payload.importPath} with mode ${payload.mode}`;
  importPathInput.value = "";
  await Promise.all([loadGraph(), loadStorageInfo()]);
  if (graphFocusNodeId) {
    await loadContextGraph(graphFocusNodeId);
  }
  renderStorage();
  render();
}

async function loadContextGraph(nodeId) {
  if (!nodeId) {
    focusedContextGraph = null;
    return;
  }

  const response = await fetch(`/api/context-graph?nodeId=${encodeURIComponent(nodeId)}`);
  if (!response.ok) {
    focusedContextGraph = null;
    return;
  }

  focusedContextGraph = await response.json();
}
