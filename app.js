let store = {
  activeNodeId: null,
  nodes: [],
};
let storageInfo = null;
let activityOverview = null;
let graphLayout = {};
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
let selectedGraphNodeId = null;
let expandedGraphNodeId = null;
let graphClickTimer = null;
let selectedGraphNodeIds = new Set();
let pinModeEnabled = false;
let graphUiState = {
  scope: "auto",
  depth: 1,
  labelMode: "smart",
  hideIsolated: false,
  typeFilters: new Set(),
};

const GRAPH_SCENE_WIDTH = 1600;
const GRAPH_SCENE_HEIGHT = 1100;
const GRAPH_LAYOUT_STORAGE_KEY = "graph-memory-layout-v3";
const GRAPH_UI_STORAGE_KEY = "graph-memory-ui-v3";

const searchInput = document.getElementById("searchInput");
const nodeList = document.getElementById("nodeList");
const graphViewport = document.getElementById("graphViewport");
const graphScene = document.getElementById("graphScene");
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
const graphPinMode = document.getElementById("graphPinMode");
const graphClearSelection = document.getElementById("graphClearSelection");
const graphScope = document.getElementById("graphScope");
const graphDepth = document.getElementById("graphDepth");
const graphLabelMode = document.getElementById("graphLabelMode");
const graphHideIsolated = document.getElementById("graphHideIsolated");
const graphTypeFilters = document.getElementById("graphTypeFilters");
const graphHint = document.getElementById("graphHint");
const graphMinimap = document.getElementById("graphMinimap");
const activityStatus = document.getElementById("activityStatus");
const activityRunningList = document.getElementById("activityRunningList");
const activityRecentList = document.getElementById("activityRecentList");
const activityProjectsList = document.getElementById("activityProjectsList");
const brainModeTitle = document.getElementById("brainModeTitle");
const brainModeSummary = document.getElementById("brainModeSummary");
const brainBreadcrumbs = document.getElementById("brainBreadcrumbs");
const brainStatsLabel = document.getElementById("brainStatsLabel");
const brainInsights = document.getElementById("brainInsights");
const brainTrace = document.getElementById("brainTrace");
const brainLegend = document.getElementById("brainLegend");

searchInput.addEventListener("input", render);
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
graphPinMode.addEventListener("click", togglePinMode);
graphClearSelection.addEventListener("click", clearGraphSelection);
graphScope.addEventListener("change", handleGraphUiChange);
graphDepth.addEventListener("change", handleGraphUiChange);
graphLabelMode.addEventListener("change", handleGraphUiChange);
graphHideIsolated.addEventListener("change", handleGraphUiChange);
graphViewport.addEventListener("wheel", handleGraphWheel, { passive: false });
graphViewport.addEventListener("pointerdown", handleViewportPointerDown);
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
window.syncGraphState = async function () {
  await loadGraph();
  setActiveNode(store.activeNodeId);
};

bootstrap();

async function bootstrap() {
  hydrateGraphPreferences();
  await Promise.all([loadGraph(), loadStorageInfo(), loadActivityOverview()]);
  if (store.activeNodeId) {
    graphFocusNodeId = store.activeNodeId;
    await loadContextGraph(store.activeNodeId);
  }
  seedDefaultCrawlRoot();
  render();
  renderStorage();
  renderActivityOverview();
  window.setInterval(syncGraphState, 3000);
}

function hydrateGraphPreferences() {
  try {
    const savedUi = JSON.parse(window.localStorage.getItem(GRAPH_UI_STORAGE_KEY) || "null");
    if (savedUi) {
      graphUiState = {
        scope: savedUi.scope || "auto",
        depth: clamp(Number(savedUi.depth || 1), 1, 3),
        labelMode: savedUi.labelMode || "smart",
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
  graphUiState.hideIsolated = graphHideIsolated.checked;
  persistGraphPreferences();
  if (event?.target) {
    render();
  }
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
  renderGraphMap(currentDisplayGraph, activeNode?.id);
  renderBrainPanel(currentDisplayGraph, activeNode, filteredNodes);
  bindNodeSelection();
  renderActiveNode(activeNode);
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

function renderGraphNode(node, activeNodeId) {
  const initials = shouldShowNodeGlyph(node) ? getNodeGlyph(node) : "";
  const selectNodeId = node.selectNodeId || node.id;
  const isPinned = graphLayout[node.id]?.pinned;
  return `
    <article
      class="graph-node ${selectNodeId === activeNodeId ? "is-active" : ""} ${isPinned ? "is-pinned" : ""}"
      data-node-id="${node.id}"
      data-select-node-id="${selectNodeId}"
      data-node-type="${node.type}"
      data-graph-role="${node.graphRole || "global"}"
      style="--node-size: ${getNodeSize(node)}px;"
    >
      ${initials ? `<h3 class="graph-title">${initials}</h3>` : ""}
    </article>
  `;
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
        handleGraphNodeClick(nodeId, event.detail || 1);
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

function handleGraphNodeClick(nodeId, detail) {
  if (graphClickTimer) {
    clearTimeout(graphClickTimer);
    graphClickTimer = null;
  }

  if (pinModeEnabled && detail === 1) {
    selectedGraphNodeId = nodeId;
    togglePinnedNode(nodeId);
    return;
  }

  if (detail >= 3) {
    selectedGraphNodeId = nodeId;
    selectedGraphNodeIds = new Set([nodeId]);
    expandedGraphNodeId = nodeId;
    selectNode(nodeId);
    return;
  }

  if (detail === 2) {
    if (selectedGraphNodeIds.has(nodeId)) {
      selectedGraphNodeIds.delete(nodeId);
    } else {
      selectedGraphNodeIds.add(nodeId);
    }
    selectedGraphNodeId = nodeId;
    expandedGraphNodeId = expandedGraphNodeId === nodeId ? null : nodeId;
    renderGraphMap(currentDisplayGraph, store.activeNodeId, { skipSimulation: true });
    bindNodeSelection();
    return;
  }

  graphClickTimer = window.setTimeout(() => {
    selectedGraphNodeId = nodeId;
    selectedGraphNodeIds = new Set([nodeId]);
    renderGraphMap(currentDisplayGraph, store.activeNodeId, { skipSimulation: true });
    bindNodeSelection();
    graphClickTimer = null;
  }, 220);
}

function togglePinMode() {
  pinModeEnabled = !pinModeEnabled;
  graphPinMode.textContent = pinModeEnabled ? "Pin Mode On" : "Pin Mode Off";
  graphPinMode.classList.toggle("is-active", pinModeEnabled);
  persistGraphPreferences();
}

function clearGraphSelection() {
  selectedGraphNodeId = null;
  expandedGraphNodeId = null;
  selectedGraphNodeIds = new Set();
  persistGraphPreferences();
  renderGraphMap(currentDisplayGraph, store.activeNodeId, { skipSimulation: true });
  bindNodeSelection();
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

async function selectNode(nodeId) {
  if (!nodeId) {
    return;
  }

  selectedGraphNodeId = nodeId;

  const response = await fetch("/api/active-node", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nodeId }),
  });

  if (!response.ok) {
    return;
  }

  store = await response.json();
  graphFocusNodeId = nodeId;
  await loadContextGraph(nodeId);
  render();
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
      nodes: neighborhoodNodes,
      edges: buildEdgesForNodes(neighborhoodNodes),
      metrics: buildGraphMetrics(neighborhoodNodes),
    });
  }

  return finalizeDisplayGraph(buildGlobalGraph(prefilteredNodes, activeNodeId, hasQuery));
}

function buildGlobalGraph(nodes, activeNodeId, hasQuery) {
  const visibleNodes = hasQuery
    ? nodes
    : nodes.filter((node) => !["file", "error", "edit"].includes(node.type));
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
  if (!graphUiState.hideIsolated || !displayGraph?.nodes?.length) {
    return displayGraph;
  }

  const linkedIds = new Set((displayGraph.edges || []).flatMap((edge) => [edge.source, edge.target]));
  const nodes = displayGraph.nodes.filter((node) => linkedIds.has(node.id) || node.id === displayGraph.focalNodeId);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (displayGraph.edges || []).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    ...displayGraph,
    nodes,
    edges,
    metrics: buildGraphMetrics(nodes),
  };
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
    graphEdges.innerHTML = "";
    graphNodes.innerHTML = `<p class="empty-state">Graph canvas dang trong.</p>`;
    graphMinimap.innerHTML = "";
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

  graphEdges.innerHTML = displayGraph.edges
    .map((edge) => renderGraphEdge(edge, nodesById, displayGraph.mode === "focus"))
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
          data-graph-role="${node.graphRole || "global"}"
          data-label-side="${labelSide}"
          style="transform: translate(${Math.round(position.x - size / 2)}px, ${Math.round(position.y - size / 2)}px); --node-size: ${size}px;"
        >
          ${renderGraphNode(node, activeNodeId).replace('class="graph-node ', `class="graph-node ${linkedClass} ${selectedClass} ${expandedClass} `)}
          <div class="graph-node-label ${showLabel ? "is-visible" : ""}" data-select-node-id="${node.selectNodeId || node.id}">
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
    <div class="graph-minimap-world">
      ${displayGraph.nodes
        .map((node) => {
          const layout = graphLayout[node.id];
          if (!layout) {
            return "";
          }
          const left = (layout.x / GRAPH_SCENE_WIDTH) * 100;
          const top = (layout.y / GRAPH_SCENE_HEIGHT) * 100;
          return `<span class="graph-minimap-node graph-minimap-node--${node.type}" style="left:${left}%; top:${top}%"></span>`;
        })
        .join("")}
      <div
        class="graph-minimap-window"
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
  applyViewTransform();
  persistGraphPreferences();
  render();
}

function releasePinnedNodes() {
  Object.values(graphLayout).forEach((layout) => {
    layout.pinned = false;
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

  if (!position || selectedGraphNodeId !== nodeId) {
    return;
  }

  dragState = {
    nodeId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  graphLayout[nodeId].pinned = true;
  event.stopPropagation();
}

function handlePointerMove(event) {
  if (dragState) {
    const point = clientToGraphPoint(event.clientX, event.clientY);
    graphLayout[dragState.nodeId].x = point.x;
    graphLayout[dragState.nodeId].y = point.y;
    graphLayout[dragState.nodeId].vx = 0;
    graphLayout[dragState.nodeId].vy = 0;
    dragState.moved =
      dragState.moved ||
      Math.abs(event.clientX - dragState.startX) > 4 ||
      Math.abs(event.clientY - dragState.startY) > 4;
    renderGraphMap(currentDisplayGraph, store.activeNodeId, { skipSimulation: true });
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
  const iterations = displayGraph.mode === "global" ? 180 : 110;
  const attraction = displayGraph.mode === "global" ? 0.012 : 0.02;

  visibleNodes.forEach((node) => {
    const target = targets[node.id] || { x: GRAPH_SCENE_WIDTH / 2, y: GRAPH_SCENE_HEIGHT / 2 };
    const existing = graphLayout[node.id];
    if (!existing || existing.mode !== displayGraph.mode) {
      graphLayout[node.id] = {
        x: target.x + seededOffset(`${displayGraph.mode}:${node.id}:x`, 80),
        y: target.y + seededOffset(`${displayGraph.mode}:${node.id}:y`, 80),
        vx: 0,
        vy: 0,
        pinned: existing?.pinned || false,
        mode: displayGraph.mode,
      };
      return;
    }

    existing.mode = displayGraph.mode;
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    visibleNodes.forEach((node) => {
      const layout = graphLayout[node.id];
      const target = targets[node.id] || { x: GRAPH_SCENE_WIDTH / 2, y: GRAPH_SCENE_HEIGHT / 2 };
      layout.fx = (target.x - layout.x) * attraction;
      layout.fy = (target.y - layout.y) * attraction;
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

    for (let leftIndex = 0; leftIndex < visibleNodes.length; leftIndex += 1) {
      const leftNode = visibleNodes[leftIndex];
      const leftLayout = graphLayout[leftNode.id];
      const leftSize = getNodeSize(leftNode);
      for (let rightIndex = leftIndex + 1; rightIndex < visibleNodes.length; rightIndex += 1) {
        const rightNode = visibleNodes[rightIndex];
        const rightLayout = graphLayout[rightNode.id];
        const rightSize = getNodeSize(rightNode);
        const dx = rightLayout.x - leftLayout.x;
        const dy = rightLayout.y - leftLayout.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const minimum = (leftSize + rightSize) * 0.68 + (displayGraph.mode === "global" ? 16 : 28);
        const repulsion = (displayGraph.mode === "global" ? 2600 : 5200) / (distance * distance);
        const overlap = Math.max(minimum - distance, 0) * 0.045;
        const force = repulsion + overlap;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        leftLayout.fx -= fx;
        leftLayout.fy -= fy;
        rightLayout.fx += fx;
        rightLayout.fy += fy;
      }
    }

    visibleNodes.forEach((node) => {
      const layout = graphLayout[node.id];
      if (layout.pinned && (!dragState || dragState.nodeId !== node.id)) {
        layout.vx = 0;
        layout.vy = 0;
        return;
      }

      layout.vx = (layout.vx + layout.fx) * 0.82;
      layout.vy = (layout.vy + layout.fy) * 0.82;
      layout.x = clamp(layout.x + layout.vx, 60, GRAPH_SCENE_WIDTH - 60);
      layout.y = clamp(layout.y + layout.vy, 60, GRAPH_SCENE_HEIGHT - 60);
    });
  }
}

function buildGraphTargets(displayGraph) {
  return displayGraph.mode === "focus"
    ? buildFocusTargets(displayGraph.nodes, displayGraph.focalNodeId)
    : buildGlobalTargets(displayGraph.nodes);
}

function buildFocusTargets(nodes, focusNodeId) {
  const targets = {};
  const centerX = 780;
  const centerY = 520;
  const groups = {
    ancestors: nodes.filter((node) => node.graphRole === "ancestor" || node.graphRole === "parent"),
    files: nodes.filter((node) => node.graphRole === "file" && node.id !== focusNodeId),
    errors: nodes.filter((node) => node.graphRole === "error"),
    edits: nodes.filter((node) => node.graphRole === "edit"),
    children: nodes.filter((node) => node.graphRole === "child"),
    related: nodes.filter((node) => node.graphRole === "related"),
  };

  if (nodes.find((node) => node.id === focusNodeId)) {
    targets[focusNodeId] = { x: centerX, y: centerY };
  }

  assignLineTargets(targets, groups.ancestors, centerX, 160, 0, 92);
  assignArcTargets(targets, groups.files, centerX + 210, centerY - 30, 130, 185, -70, 70);
  assignArcTargets(targets, groups.errors, centerX - 220, centerY - 10, 120, 175, 110, 250);
  assignLineTargets(targets, groups.edits, centerX + 200, centerY + 170, 86, 64, 54);
  assignLineTargets(targets, groups.children, centerX - ((groups.children.length - 1) * 86) / 2, centerY + 210, 86, 86, 0);
  assignArcTargets(targets, groups.related, centerX, centerY, 250, 220, 205, 335);

  return targets;
}

function buildGlobalTargets(nodes) {
  const targets = {};
  const clusterEntries = [...groupNodesByCluster(nodes).entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const centerX = GRAPH_SCENE_WIDTH / 2;
  const centerY = GRAPH_SCENE_HEIGHT / 2;
  const radiusX = 430;
  const radiusY = 300;

  clusterEntries.forEach(([clusterKey, clusterNodes], index) => {
    const angle = ((Math.PI * 2) / Math.max(clusterEntries.length, 1)) * index - Math.PI / 2;
    const clusterX = centerX + Math.cos(angle) * radiusX;
    const clusterY = centerY + Math.sin(angle) * radiusY;
    assignArcTargets(
      targets,
      clusterNodes,
      clusterX,
      clusterY,
      40 + Math.min(clusterNodes.length * 6, 110),
      40 + Math.min(clusterNodes.length * 5, 95),
      -170,
      170,
      clusterKey
    );
  });

  return targets;
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

function renderGraphEdge(edge, nodesById, showLabel) {
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
  const curve = edge.type === "related" ? 30 : edge.type === "parent" ? 14 : 22;
  const controlX = midX - (dy / distance) * curve;
  const controlY = midY + (dx / distance) * curve;
  const labelX = (midX + controlX) / 2;
  const labelY = (midY + controlY) / 2 - 8;

  return `
    <g class="graph-edge-group graph-edge-group--${edge.type}">
      <path class="graph-edge graph-edge--${edge.type}" d="M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}"></path>
      ${showLabel ? `<text class="graph-edge-label graph-edge-label--${edge.type}" x="${labelX}" y="${labelY}">${edge.type}</text>` : ""}
    </g>
  `;
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

    graphHint.textContent = `global atlas · ${graphUiState.hideIsolated ? "isolated hidden" : "all roots"} · ${graphUiState.labelMode} labels`;
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

  graphHint.textContent = `local brain · depth ${graphUiState.depth} · ${graphUiState.labelMode} labels`;
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
  if (currentDisplayGraph?.mode === "focus") {
    return true;
  }

  return (
    node.id === store.activeNodeId ||
    node.id === graphFocusNodeId
  );
}

function getNodeSecondaryDetail(node) {
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
    if (dragState.moved) {
      persistGraphPreferences();
      renderGraphMap(currentDisplayGraph, store.activeNodeId);
      bindNodeSelection();
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
}

function togglePinnedNode(nodeId) {
  if (!graphLayout[nodeId]) {
    return;
  }

  graphLayout[nodeId].pinned = !graphLayout[nodeId].pinned;
  persistGraphPreferences();
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
