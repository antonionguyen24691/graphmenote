(function () {
  const pipelineScanForm = document.getElementById("pipelineScanForm");
  const pipelinePathInput = document.getElementById("pipelinePathInput");
  const pipelineScanBtn = document.getElementById("pipelineScanBtn");
  const pipelineSyncGraphBtn = document.getElementById("pipelineSyncGraphBtn");
  const pipelineStatus = document.getElementById("pipelineStatus");
  const pipelineTreeStats = document.getElementById("pipelineTreeStats");
  const pipelineTree = document.getElementById("pipelineTree");
  const pipelineViewport = document.getElementById("pipelineViewport");
  const pipelineSyncHint = document.getElementById("pipelineSyncHint");
  const pipelineScene = document.getElementById("pipelineScene");
  const pipelineMinimap = document.getElementById("pipelineMinimap");
  const pipelineEdges = document.getElementById("pipelineEdges");
  const pipelineCards = document.getElementById("pipelineCards");
  const pipelineAutoArrange = document.getElementById("pipelineAutoArrange");
  const pipelineFeedback = document.getElementById("pipelineFeedback");
  const pipelineCardCount = document.getElementById("pipelineCardCount");
  const pipelineTraceStats = document.getElementById("pipelineTraceStats");
  const pipelineTraceList = document.getElementById("pipelineTraceList");
  const pipelineLaneStats = document.getElementById("pipelineLaneStats");
  const pipelineLaneBoard = document.getElementById("pipelineLaneBoard");
  const pipelineTraceGraphStats = document.getElementById("pipelineTraceGraphStats");
  const pipelineTraceGraph = document.getElementById("pipelineTraceGraph");
  const pipelineSourcePreviewMeta = document.getElementById("pipelineSourcePreviewMeta");
  const pipelineSourcePreview = document.getElementById("pipelineSourcePreview");
  const pipelineLayoutMode = document.getElementById("pipelineLayoutMode");
  const pipelineFitScreen = document.getElementById("pipelineFitScreen");
  const pipelineZoomIn = document.getElementById("pipelineZoomIn");
  const pipelineZoomOut = document.getElementById("pipelineZoomOut");
  const pipelineRecenter = document.getElementById("pipelineRecenter");
  const pipelineFullscreen = document.getElementById("pipelineFullscreen");
  const tabPipeline = document.getElementById("tabPipeline");

  if (!pipelineScanForm) {
    return;
  }

  const STORAGE_KEY = "graph-memory-pipeline-v1";
  const CARD_WIDTH = 300;
  const CARD_HEIGHT = 180;
  const PIPELINE_SCENE_WIDTH = 3200;
  const PIPELINE_SCENE_HEIGHT = 2400;
  const LAYER_GAP_X = 360;
  const LAYER_GAP_Y = 218;
  const state = {
    tree: null,
    schema: null,
    pipeline: null,
    activeTraceId: null,
    activeTraceGraphNodeId: null,
    sourcePreview: null,
    selectedCardId: null,
    layoutMode: "flow",
    layout: {},
    viewState: { scale: 0.7, offsetX: 60, offsetY: 60 },
    dragState: null,
    panState: null,
    minimapDragState: null,
    suppressMinimapClickUntil: 0,
    overviewSyncMuted: false,
    syncHintTimer: null,
    autoScannedPath: null,
  };

  hydrateState();

  pipelineScanForm.addEventListener("submit", handleScanSubmit);
  pipelineSyncGraphBtn.addEventListener("click", handleSyncToGraph);
  pipelineAutoArrange?.addEventListener("click", () => {
    autoArrangePipeline({ forceReset: true, recenter: true });
  });
  pipelineFitScreen?.addEventListener("click", fitPipelineToScreen);
  pipelineLayoutMode?.addEventListener("change", () => {
    state.layoutMode = pipelineLayoutMode.value || "flow";
    autoArrangePipeline({ forceReset: true, recenter: true });
  });
  pipelineZoomIn.addEventListener("click", () => zoomPipeline(0.12));
  pipelineZoomOut.addEventListener("click", () => zoomPipeline(-0.12));
  pipelineRecenter.addEventListener("click", recenterPipelineView);
  pipelineFullscreen.addEventListener("click", () => {
    if (typeof window.toggleCanvasFullscreen === "function") {
      window.toggleCanvasFullscreen("pipeline");
    }
  });
  pipelineViewport.addEventListener("wheel", handleWheel, { passive: false });
  pipelineViewport.addEventListener("pointerdown", handleViewportPointerDown);
  pipelineMinimap?.addEventListener("pointerdown", handleMinimapPointerDown);
  pipelineMinimap?.addEventListener("click", (event) => {
    void handleMinimapClick(event);
  });
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  tabPipeline?.addEventListener("click", handlePipelineTabFocus);
  window.focusPipelineOverview = focusPipelineOverview;

  syncPathFromGraphSelection();
  if (pipelineLayoutMode) {
    pipelineLayoutMode.value = state.layoutMode;
  }
  applyPipelineTransform();

  async function handlePipelineTabFocus() {
    const nextPath = syncPathFromGraphSelection();
    if (nextPath && nextPath !== state.autoScannedPath) {
      await scanProject(nextPath);
      state.autoScannedPath = nextPath;
    }
  }

  function hydrateState() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) {
        return;
      }
      pipelinePathInput.value = saved.path || "";
      state.layoutMode = saved.layoutMode || "flow";
      state.layout = saved.layout || {};
      state.viewState = {
        scale: clamp(Number(saved.viewState?.scale || 0.7), 0.35, 1.8),
        offsetX: Number(saved.viewState?.offsetX || 60),
        offsetY: Number(saved.viewState?.offsetY || 60),
      };
      if (pipelineLayoutMode) {
        pipelineLayoutMode.value = state.layoutMode;
      }
    } catch (error) {
      console.warn("Khong the nap pipeline state.", error);
    }
  }

  function persistState() {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        path: pipelinePathInput.value.trim(),
        layoutMode: state.layoutMode,
        layout: state.layout,
        viewState: state.viewState,
      })
    );
  }

  function syncPathFromGraphSelection() {
    const snapshot = typeof window.getGraphMemorySnapshot === "function"
      ? window.getGraphMemorySnapshot()
      : null;
    const pathValue = resolvePathFromSnapshot(snapshot);
    if (pathValue && !pipelinePathInput.value.trim()) {
      pipelinePathInput.value = pathValue;
      persistState();
    }
    return pathValue;
  }

  function resolvePathFromSnapshot(snapshot) {
    if (!snapshot?.activeNodeId || !Array.isArray(snapshot.nodes)) {
      return "";
    }

    const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    let current = nodesById.get(snapshot.activeNodeId);

    while (current) {
      if (["project", "workspace"].includes(current.type)) {
        const explicit = getNodeRootPath(current);
        if (explicit) {
          return explicit;
        }
      }
      if (current.parentId) {
        current = nodesById.get(current.parentId);
      } else {
        break;
      }
    }

    current = nodesById.get(snapshot.activeNodeId);
    const filePath = current?.files?.[0];
    return filePath ? normalizeProjectPath(filePath) : "";
  }

  function getNodeRootPath(node) {
    const fromContext = (node.contextWindow || []).find((item) =>
      ["Root path", "Workspace root"].includes(item.label)
    )?.detail;
    if (fromContext) {
      return fromContext;
    }
    if (node.files?.[0]) {
      return normalizeProjectPath(node.files[0]);
    }
    return "";
  }

  function normalizeProjectPath(value) {
    try {
      const looksLikeFile = /\.[a-z0-9]+$/i.test(value);
      return looksLikeFile ? value.replace(/[\\/][^\\/]+$/, "") : value;
    } catch {
      return value || "";
    }
  }

  function normalizeComparablePath(value) {
    return String(value || "").trim().replaceAll("\\", "/");
  }

  async function handleScanSubmit(event) {
    event.preventDefault();
    const scanPath = pipelinePathInput.value.trim();
    if (!scanPath) {
      setFeedback("Hay nhap project path truoc khi quet.", "warn");
      return;
    }
    await scanProject(scanPath);
  }

  async function scanProject(scanPath, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    pipelineStatus.textContent = "scanning project...";
    pipelineScanBtn.disabled = true;
    pipelineSyncGraphBtn.disabled = true;
    setFeedback("Dang quet tree, pipeline va schema...", "info");

    try {
      const encodedPath = encodeURIComponent(scanPath);
      const [treeResponse, pipelineResponse, schemaResponse] = await Promise.all([
        fetch(`/api/scan-tree?path=${encodedPath}&maxDepth=5`),
        fetch(`/api/scan-pipeline?path=${encodedPath}&maxDepth=6&maxFiles=220&force=${forceRefresh ? "1" : "0"}`),
        fetch(`/api/scan-schema?path=${encodedPath}`),
      ]);

      const treePayload = await treeResponse.json();
      const pipelinePayload = await pipelineResponse.json();
      const schemaPayload = await schemaResponse.json();

      if (!treeResponse.ok) {
        throw new Error(treePayload.message || "Scan tree that bai.");
      }
      if (!pipelineResponse.ok) {
        throw new Error(pipelinePayload.message || "Scan pipeline that bai.");
      }
      if (!schemaResponse.ok) {
        throw new Error(schemaPayload.message || "Scan schema that bai.");
      }

      state.tree = treePayload.tree;
      state.pipeline = pipelinePayload;
      state.schema = schemaPayload;
      state.activeTraceId = pipelinePayload.traces?.[0]?.id || null;
      state.activeTraceGraphNodeId = pipelinePayload.traces?.[0]?.traceGraph?.nodes?.[0]?.id || null;
      state.selectedCardId = getInitialSelectedId();
      renderTree();
      autoArrangePipeline({ forceReset: true, recenter: true });
      renderTraceList();
      renderTraceLanes();
      renderTraceGraph();
      renderSourcePreview();

      const schemaTables = schemaPayload.tables?.length || 0;
      const schemaRelations = schemaPayload.relations?.length || 0;
      const fileNodes = pipelinePayload.nodes?.length || 0;
      const fileLinks = pipelinePayload.edges?.length || 0;
      const symbolCount = pipelinePayload.symbolCount || 0;

      const cachedTag = pipelinePayload.cached ? " | cached" : "";
      pipelineStatus.textContent = `${fileNodes} files · ${symbolCount} symbols · ${schemaTables} schema nodes · ${state.layoutMode} layout${cachedTag}`;
      pipelineSyncGraphBtn.disabled = schemaTables === 0;
      setFeedback(
        `Tree ready. Code pipeline: ${fileNodes} files / ${symbolCount} symbols / ${fileLinks} links. Schema: ${schemaTables} tables / ${schemaRelations} relations.`,
        "ok"
      );
    } catch (error) {
      setFeedback(error.message || "Scan project that bai.", "err");
      pipelineStatus.textContent = "scan failed";
    } finally {
      pipelineScanBtn.disabled = false;
    }
  }

  async function handleSyncToGraph() {
    const scanPath = pipelinePathInput.value.trim();
    if (!scanPath) {
      setFeedback("Khong co path de sync.", "warn");
      return;
    }

    pipelineSyncGraphBtn.disabled = true;
    try {
      const response = await fetch("/api/scan-to-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: scanPath }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || "Sync schema vao graph that bai.");
      }
      setFeedback(`Da sync ${payload.totalTables} schema nodes vao Graph Memory.`, "ok");
      if (typeof window.syncGraphState === "function") {
        await window.syncGraphState();
      }
    } catch (error) {
      setFeedback(error.message || "Sync graph that bai.", "err");
    } finally {
      pipelineSyncGraphBtn.disabled = !(state.schema?.tables?.length);
    }
  }

  function getRenderDataset() {
    if (state.schema?.tables?.length) {
      return {
        mode: "schema",
        nodes: state.schema.tables.map((table) => ({
          id: `schema-${table.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: table.name,
          titleColor: table.color || "#5b8def",
          role: table.source || "schema",
          fields: table.fields || [],
          indexes: table.indexes || [],
          sourceFile: table.sourceFile,
        })),
        edges: (state.schema.relations || []).map((relation) => ({
          source: `schema-${relation.sourceTable.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          target: `schema-${relation.targetTable.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          type: relation.type || "foreign_key",
        })),
      };
    }

    return {
      mode: "pipeline",
      nodes: state.pipeline?.nodes || [],
      edges: state.pipeline?.edges || [],
    };
  }

  function getInitialSelectedId() {
    const dataset = getRenderDataset();
    return dataset.nodes[0]?.id || null;
  }

  function autoArrangePipeline(options = {}) {
    rebuildPipelineLayout({ forceReset: Boolean(options.forceReset) });
    renderCardsAndEdges();
    if (options.recenter) {
      recenterPipelineView();
    } else {
      applyPipelineTransform();
    }
    persistState();
  }

  function rebuildPipelineLayout(options = {}) {
    const dataset = getRenderDataset();
    const forceReset = Boolean(options.forceReset);
    const nextLayout = buildNextPipelineLayout(dataset);
    relaxPipelineLayout(nextLayout, dataset);

    dataset.nodes.forEach((node) => {
      const existing = state.layout[node.id];
      state.layout[node.id] = forceReset || !existing ? nextLayout[node.id] : existing;
    });

    Object.keys(state.layout).forEach((nodeId) => {
      if (!dataset.nodes.some((node) => node.id === nodeId)) {
        delete state.layout[nodeId];
      }
    });
  }

  function buildNextPipelineLayout(dataset) {
    if (state.layoutMode === "grouped") {
      return buildGroupedPipelineLayout(dataset);
    }
    if (state.layoutMode === "compact") {
      return buildFlowPipelineLayout(dataset, {
        maxRows: dataset.mode === "schema" ? 5 : 6,
        layerGapX: 308,
        layerGapY: 188,
        subColumnGap: 104,
      });
    }
    return buildFlowPipelineLayout(dataset, {
      maxRows: dataset.mode === "schema" ? 4 : 5,
      layerGapX: LAYER_GAP_X,
      layerGapY: LAYER_GAP_Y,
      subColumnGap: 118,
    });
  }

  function buildFlowPipelineLayout(dataset, options = {}) {
    const nextLayout = {};
    const depths = buildPipelineDepthIndex(dataset);
    const groups = new Map();

    dataset.nodes.forEach((node) => {
      const layerIndex = getLayerIndexForNode(node, dataset.mode, depths);
      if (!groups.has(layerIndex)) {
        groups.set(layerIndex, []);
      }
      groups.get(layerIndex).push(node);
    });

    [...groups.keys()].sort((left, right) => left - right).forEach((layerIndex) => {
      const items = groups.get(layerIndex)
        .slice()
        .sort((left, right) => {
          const degreeDelta = getNodeDegree(right, dataset.edges) - getNodeDegree(left, dataset.edges);
          if (degreeDelta !== 0) {
            return degreeDelta;
          }
          return left.name.localeCompare(right.name);
        });
      const maxRows = options.maxRows || 5;
      const subColumns = Math.max(1, Math.ceil(items.length / maxRows));
      const centeredX = 130 + layerIndex * (options.layerGapX || LAYER_GAP_X);
      const baseX = centeredX - ((subColumns - 1) * (options.subColumnGap || 118)) / 2;

      items.forEach((node, itemIndex) => {
        const subColumnIndex = Math.floor(itemIndex / maxRows);
        const rowIndex = itemIndex % maxRows;
        const seedX = seededOffset(`${state.layoutMode}:${dataset.mode}:${node.id}:x`, 10);
        const seedY = seededOffset(`${state.layoutMode}:${dataset.mode}:${node.id}:y`, 12);
        nextLayout[node.id] = {
          x: baseX + subColumnIndex * (options.subColumnGap || 118) + seedX,
          y: 108 + rowIndex * (options.layerGapY || LAYER_GAP_Y) + (subColumnIndex % 2 === 0 ? -8 : 10) + seedY,
        };
      });
    });

    return nextLayout;
  }

  function buildGroupedPipelineLayout(dataset) {
    const nextLayout = {};
    const groups = new Map();

    dataset.nodes.forEach((node) => {
      const groupKey = dataset.mode === "schema"
        ? (node.role || "schema")
        : classifyPipelineGroup(node);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(node);
    });

    [...groups.keys()].forEach((groupKey, columnIndex) => {
      const items = groups.get(groupKey)
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name));
      const rows = dataset.mode === "schema" ? 4 : 5;
      const subColumns = Math.max(1, Math.ceil(items.length / rows));
      const baseX = 150 + columnIndex * 324 - ((subColumns - 1) * 106) / 2;
      items.forEach((node, itemIndex) => {
        const subColumnIndex = Math.floor(itemIndex / rows);
        const rowIndex = itemIndex % rows;
        nextLayout[node.id] = {
          x: baseX + subColumnIndex * 106 + seededOffset(`${groupKey}:${node.id}:x`, 8),
          y: 116 + rowIndex * 196 + seededOffset(`${groupKey}:${node.id}:y`, 10),
        };
      });
    });

    return nextLayout;
  }

  function relaxPipelineLayout(layout, dataset) {
    const nodes = dataset.nodes || [];
    if (nodes.length <= 1) {
      return;
    }

    const depths = buildPipelineDepthIndex(dataset);
    const anchors = new Map(
      nodes.map((node) => [
        node.id,
        {
          x: layout[node.id]?.x ?? 120,
          y: layout[node.id]?.y ?? 120,
        },
      ])
    );
    const layers = new Map(
      nodes.map((node) => [node.id, getLayerIndexForNode(node, dataset.mode, depths)])
    );
    const iterations =
      state.layoutMode === "compact" ? 16 :
      state.layoutMode === "grouped" ? 22 :
      28;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      nodes.forEach((node) => {
        const position = layout[node.id];
        const anchor = anchors.get(node.id);
        if (!position || !anchor) {
          return;
        }
        position.x += (anchor.x - position.x) * 0.12;
        position.y += (anchor.y - position.y) * 0.14;
      });

      (dataset.edges || []).forEach((edge) => {
        const source = layout[edge.source];
        const target = layout[edge.target];
        const sourceAnchor = anchors.get(edge.source);
        const targetAnchor = anchors.get(edge.target);
        if (!source || !target || !sourceAnchor || !targetAnchor) {
          return;
        }

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const desired = Math.max(160, Math.abs(targetAnchor.x - sourceAnchor.x) * 0.8);
        const force = (distance - desired) * 0.01;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force * 0.4;
        source.x = clamp(source.x + fx, 60, PIPELINE_SCENE_WIDTH - CARD_WIDTH - 40);
        source.y = clamp(source.y + fy, 60, PIPELINE_SCENE_HEIGHT - CARD_HEIGHT - 40);
        target.x = clamp(target.x - fx, 60, PIPELINE_SCENE_WIDTH - CARD_WIDTH - 40);
        target.y = clamp(target.y - fy, 60, PIPELINE_SCENE_HEIGHT - CARD_HEIGHT - 40);
      });

      applyPipelineCollisionPass(layout, nodes, layers);
    }

    settlePipelineLayers(layout, nodes, layers);
  }

  function applyPipelineCollisionPass(layout, nodes, layers) {
    forEachPipelineCollisionPair(nodes, layout, (leftNode, rightNode) => {
      const left = layout[leftNode.id];
      const right = layout[rightNode.id];
      if (!left || !right) {
        return;
      }

      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const widthGap = state.layoutMode === "compact" ? 28 : 40;
      const heightGap = state.layoutMode === "compact" ? 18 : 30;
      const overlapX = CARD_WIDTH + widthGap - Math.abs(dx);
      const overlapY = CARD_HEIGHT + heightGap - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) {
        return;
      }

      const sameLayer = layers.get(leftNode.id) === layers.get(rightNode.id);
      const directionX = Math.abs(dx) > 0.5 ? Math.sign(dx) : (seededOffset(`${leftNode.id}:${rightNode.id}:x`, 1) >= 0 ? 1 : -1);
      const directionY = Math.abs(dy) > 0.5 ? Math.sign(dy) : (seededOffset(`${leftNode.id}:${rightNode.id}:y`, 1) >= 0 ? 1 : -1);
      const pushMostlyY = sameLayer || overlapY <= overlapX * 1.1;
      const pushX = pushMostlyY ? (overlapX * 0.16 * directionX) : ((overlapX / 2 + 6) * directionX);
      const pushY = pushMostlyY ? ((overlapY / 2 + 8) * directionY) : (overlapY * 0.18 * directionY);

      left.x = clamp(left.x - pushX * 0.5, 60, PIPELINE_SCENE_WIDTH - CARD_WIDTH - 40);
      right.x = clamp(right.x + pushX * 0.5, 60, PIPELINE_SCENE_WIDTH - CARD_WIDTH - 40);
      left.y = clamp(left.y - pushY * 0.5, 60, PIPELINE_SCENE_HEIGHT - CARD_HEIGHT - 40);
      right.y = clamp(right.y + pushY * 0.5, 60, PIPELINE_SCENE_HEIGHT - CARD_HEIGHT - 40);
    });
  }

  function settlePipelineLayers(layout, nodes, layers) {
    const groups = new Map();
    nodes.forEach((node) => {
      const layer = layers.get(node.id) ?? 0;
      if (!groups.has(layer)) {
        groups.set(layer, []);
      }
      groups.get(layer).push(node);
    });

    groups.forEach((layerNodes) => {
      const ordered = layerNodes
        .slice()
        .sort((left, right) => (layout[left.id]?.y || 0) - (layout[right.id]?.y || 0));
      const minGap = CARD_HEIGHT + (state.layoutMode === "compact" ? 18 : 26);

      for (let index = 1; index < ordered.length; index += 1) {
        const previous = layout[ordered[index - 1].id];
        const current = layout[ordered[index].id];
        if (!previous || !current) {
          continue;
        }
        const minimumY = previous.y + minGap;
        if (current.y < minimumY) {
          current.y = minimumY;
        }
      }
    });
  }

  function forEachPipelineCollisionPair(nodes, layout, callback) {
    if (nodes.length <= 48) {
      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          callback(nodes[leftIndex], nodes[rightIndex]);
        }
      }
      return;
    }

    const bucketSize = 340;
    const buckets = new Map();
    nodes.forEach((node, index) => {
      const position = layout[node.id];
      if (!position) {
        return;
      }
      const bucketX = Math.floor(position.x / bucketSize);
      const bucketY = Math.floor(position.y / bucketSize);
      const key = `${bucketX}:${bucketY}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push({ node, index, bucketX, bucketY });
    });

    const seen = new Set();
    buckets.forEach((entries) => {
      entries.forEach((entry) => {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
            const nearby = buckets.get(`${entry.bucketX + deltaX}:${entry.bucketY + deltaY}`);
            if (!nearby) {
              continue;
            }
            nearby.forEach((neighbor) => {
              if (entry.index >= neighbor.index) {
                return;
              }
              const pairKey = `${entry.index}:${neighbor.index}`;
              if (seen.has(pairKey)) {
                return;
              }
              seen.add(pairKey);
              callback(entry.node, neighbor.node);
            });
          }
        }
      });
    });
  }

  function buildPipelineDepthIndex(dataset) {
    const incoming = new Map();
    const outgoing = new Map();
    const depths = new Map();

    dataset.nodes.forEach((node) => {
      incoming.set(node.id, 0);
      outgoing.set(node.id, []);
      depths.set(node.id, 0);
    });

    (dataset.edges || []).forEach((edge) => {
      if (!incoming.has(edge.source) || !incoming.has(edge.target)) {
        return;
      }
      incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      outgoing.get(edge.source).push(edge.target);
    });

    const queue = [...incoming.entries()]
      .filter(([, count]) => count === 0)
      .map(([nodeId]) => nodeId);

    while (queue.length) {
      const current = queue.shift();
      const currentDepth = depths.get(current) || 0;
      (outgoing.get(current) || []).forEach((nextId) => {
        depths.set(nextId, Math.max(depths.get(nextId) || 0, currentDepth + 1));
        incoming.set(nextId, Math.max(0, (incoming.get(nextId) || 0) - 1));
        if ((incoming.get(nextId) || 0) === 0) {
          queue.push(nextId);
        }
      });
    }

    return depths;
  }

  function getLayerIndexForNode(node, mode, depths) {
    if (mode === "schema") {
      return clamp(depths.get(node.id) || 0, 0, 8);
    }

    const role = String(node.role || "").toLowerCase();
    const roleIndex =
      /route|controller|handler|entry|screen|page|api/.test(role) ? 0 :
      /middleware|hook|guard|provider/.test(role) ? 1 :
      /service|usecase|domain|feature/.test(role) ? 2 :
      /repository|model|entity|store|database|orm|query/.test(role) ? 3 :
      /config|util|helper|shared|schema/.test(role) ? 4 :
      2;
    const depthIndex = clamp(depths.get(node.id) || 0, 0, 6);
    return Math.max(roleIndex, depthIndex);
  }

  function classifyPipelineGroup(node) {
    const role = String(node.role || "").toLowerCase();
    if (/route|controller|handler|entry|screen|page|api/.test(role)) {
      return "entry";
    }
    if (/middleware|hook|guard|provider/.test(role)) {
      return "orchestration";
    }
    if (/service|usecase|domain|feature/.test(role)) {
      return "service";
    }
    if (/repository|model|entity|store|database|orm|query/.test(role)) {
      return "data";
    }
    if (/config|util|helper|shared|schema/.test(role)) {
      return "shared";
    }
    return role || "misc";
  }

  function getNodeDegree(node, edges) {
    return (edges || []).reduce((count, edge) => {
      if (edge.source === node.id || edge.target === node.id) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  function seededOffset(seed, span) {
    let hash = 0;
    const text = String(seed || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
    const normalized = ((Math.abs(hash) % 1000) / 999) - 0.5;
    return Math.round(normalized * span * 2);
  }

  function renderTree() {
    if (!state.tree) {
      pipelineTree.innerHTML = `<p class="empty-state">Chua co tree nao.</p>`;
      pipelineTreeStats.textContent = "-";
      return;
    }

    const stats = countTreeStats(state.tree);
    pipelineTreeStats.textContent = `${stats.dirs} dirs · ${stats.files} files`;
    pipelineTree.innerHTML = renderTreeNode(state.tree, 0);

    pipelineTree.querySelectorAll(".pl-tree-toggle").forEach((item) => {
      item.addEventListener("click", () => {
        item.parentElement.classList.toggle("is-collapsed");
      });
    });
  }

  function renderTreeNode(node, depth) {
    if (node.type === "file") {
      return `
        <div class="pl-tree-file" style="--tree-d:${depth};" title="${escapeHtml(node.path)}">
          <span class="pl-tree-icon">·</span>
          <span class="pl-tree-name">${escapeHtml(node.name)}</span>
          <span class="pl-tree-size">${formatBytes(node.size || 0)}</span>
        </div>
      `;
    }

    return `
      <div class="pl-tree-dir" style="--tree-d:${depth};">
        <div class="pl-tree-toggle" title="${escapeHtml(node.path)}">
          <span class="pl-tree-icon">▾</span>
          <span class="pl-tree-name">${escapeHtml(node.name)}</span>
          <span class="pl-tree-count">${node.dirCount || 0}/${node.fileCount || 0}</span>
        </div>
        <div class="pl-tree-children">
          ${(node.children || []).map((child) => renderTreeNode(child, depth + 1)).join("")}
        </div>
      </div>
    `;
  }

  function renderCardsAndEdges() {
    const dataset = getRenderDataset();
    if (!dataset.nodes.length) {
      pipelineCards.innerHTML = `<p class="empty-state">Khong tim thay table hoac pipeline node nao.</p>`;
      pipelineEdges.innerHTML = "";
      if (pipelineMinimap) {
        pipelineMinimap.innerHTML = "";
      }
      pipelineCardCount.textContent = "0 nodes · 0 relations";
      pipelineTraceStats.textContent = "0 traces";
      pipelineTraceList.innerHTML = `<p class="empty-state">Chua co trace nao.</p>`;
      pipelineLaneStats.textContent = "0 lanes";
      pipelineLaneBoard.innerHTML = `<p class="empty-state">Chua co pipeline lane nao.</p>`;
      pipelineTraceGraphStats.textContent = "0 edges";
      pipelineTraceGraph.innerHTML = `<p class="empty-state">Chua co trace graph nao.</p>`;
      renderSourcePreview();
      return;
    }

    pipelineCards.innerHTML = dataset.nodes.map(renderCard).join("");
    pipelineEdges.innerHTML = dataset.edges.map((edge) => renderEdge(edge, dataset.nodes)).join("");
    const symbolInfo = dataset.mode === "pipeline"
      ? ` · ${(state.pipeline?.symbolCount || 0)} symbols`
      : "";
    pipelineCardCount.textContent = `${dataset.nodes.length} ${dataset.mode === "schema" ? "tables" : "files"} · ${dataset.edges.length} relations${symbolInfo} · ${state.layoutMode}`;
    applyPipelineTransform();
    bindCardEvents(dataset);
  }

  function renderTraceList() {
    const traces = state.pipeline?.traces || [];
    pipelineTraceStats.textContent = `${traces.length} traces`;
    if (!traces.length) {
      pipelineTraceList.innerHTML = `<p class="empty-state">Khong phat hien route trace nao trong project nay.</p>`;
      pipelineLaneStats.textContent = "0 lanes";
      pipelineLaneBoard.innerHTML = `<p class="empty-state">Chua co pipeline lane nao.</p>`;
      pipelineTraceGraphStats.textContent = "0 edges";
      pipelineTraceGraph.innerHTML = `<p class="empty-state">Chua co trace graph nao.</p>`;
      renderSourcePreview();
      return;
    }

    pipelineTraceList.innerHTML = traces.map((trace) => `
      <article class="pl-trace-item ${state.activeTraceId === trace.id ? "is-active" : ""}" data-trace-id="${trace.id}">
        <div class="pl-trace-head">
          <strong>${escapeHtml(trace.method)} ${escapeHtml(trace.path)}</strong>
          <small>${escapeHtml(trace.framework || "trace")}</small>
        </div>
        <div class="pl-trace-steps">
          ${(trace.steps || []).slice(0, 8).map((step) => `<span>${escapeHtml(step.role)}: ${escapeHtml(step.label)}</span>`).join("")}
        </div>
        <div class="pl-trace-meta">${escapeHtml(trace.filePath || "")}</div>
      </article>
    `).join("");

    pipelineTraceList.querySelectorAll("[data-trace-id]").forEach((item) => {
      item.addEventListener("click", () => {
        state.activeTraceId = item.getAttribute("data-trace-id");
        state.activeTraceGraphNodeId = getActiveTrace()?.traceGraph?.nodes?.[0]?.id || null;
        renderCardsAndEdges();
        renderTraceList();
        renderTraceLanes();
        renderTraceGraph();
        renderSourcePreview();
      });
    });
  }

  function renderTraceLanes() {
    const trace = getActiveTrace();
    const lanes = trace?.lanes || [];
    pipelineLaneStats.textContent = `${lanes.length} lanes`;
    if (!lanes.length) {
      pipelineLaneBoard.innerHTML = `<p class="empty-state">Chon trace de xem luong route -> service -> repository -> model.</p>`;
      renderSourcePreview();
      return;
    }

    pipelineLaneBoard.innerHTML = lanes.map((lane) => `
      <section class="pl-lane" data-lane="${escapeHtml(lane.lane)}">
        <div class="pl-lane-head">
          <strong>${escapeHtml(lane.label)}</strong>
          <span>${lane.steps.length} steps</span>
        </div>
        <div class="pl-lane-steps">
          ${lane.steps.map((step) => `
            <article
              class="pl-lane-step ${isTraceStepFocused(step) ? "is-active" : ""}"
              data-lane-step-file="${escapeHtml(step.filePath || "")}"
              data-lane-step-symbol="${escapeHtml(step.symbol || "")}"
              data-lane-step-label="${escapeHtml(step.label || "")}"
              title="${escapeHtml(step.filePath || step.label)}"
            >
              <strong>${escapeHtml(step.label)}</strong>
              <small>${escapeHtml(compactStepMeta(step))}</small>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("");

    pipelineLaneBoard.querySelectorAll("[data-lane-step-file], [data-lane-step-label]").forEach((item) => {
      item.addEventListener("click", () => {
        focusTraceLaneStep({
          filePath: item.getAttribute("data-lane-step-file") || "",
          symbol: item.getAttribute("data-lane-step-symbol") || "",
          label: item.getAttribute("data-lane-step-label") || "",
        });
      });
    });
  }

  function renderTraceGraph() {
    const trace = getActiveTrace();
    const graph = trace?.traceGraph;
    if (!graph?.nodes?.length) {
      pipelineTraceGraphStats.textContent = "0 edges";
      pipelineTraceGraph.innerHTML = `<p class="empty-state">Chon trace de xem symbol-to-symbol flow.</p>`;
      return;
    }

    const columnWidth = 210;
    const rowHeight = 116;
    const cardWidth = 170;
    const cardHeight = 88;
    const positions = new Map();
    const maxX = Math.max(...graph.nodes.map((node) => node.x), 0);
    const maxY = Math.max(...graph.nodes.map((node) => node.y), 0);
    const sceneWidth = (maxX + 1) * columnWidth + 120;
    const sceneHeight = (maxY + 1) * rowHeight + 120;

    const nodesMarkup = graph.nodes.map((node) => {
      const left = 40 + node.x * columnWidth;
      const top = 34 + node.y * rowHeight;
      positions.set(node.id, {
        centerX: left + cardWidth / 2,
        centerY: top + cardHeight / 2,
      });
      return `
        <article class="pl-trace-graph-node ${state.activeTraceGraphNodeId === node.id ? "is-active" : ""}" data-trace-graph-node-id="${node.id}" style="left:${left}px; top:${top}px;" title="${escapeHtml(node.filePath || node.label)}">
          <small>${escapeHtml(node.laneLabel)}</small>
          <strong>${escapeHtml(node.label)}</strong>
          <span>${escapeHtml(compactTraceNodeMeta(node))}</span>
        </article>
      `;
    }).join("");

    const edgesMarkup = graph.edges.map((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) {
        return "";
      }
      const startX = source.centerX;
      const startY = source.centerY;
      const endX = target.centerX;
      const endY = target.centerY;
      const midX = (startX + endX) / 2;
      const curve = Math.max(48, Math.abs(endX - startX) * 0.18);
      return `
        <g class="pl-trace-graph-edge ${edge.source === state.activeTraceGraphNodeId || edge.target === state.activeTraceGraphNodeId ? "is-active" : ""}">
          <path d="M ${startX} ${startY} C ${midX - curve} ${startY}, ${midX + curve} ${endY}, ${endX} ${endY}"></path>
          <circle cx="${midX}" cy="${(startY + endY) / 2}" r="3"></circle>
        </g>
      `;
    }).join("");

    pipelineTraceGraphStats.textContent = `${graph.edges.length} edges`;
    pipelineTraceGraph.innerHTML = `
      <div class="pl-trace-graph-scene" style="width:${sceneWidth}px; height:${sceneHeight}px;">
        <svg class="pl-trace-graph-edges" viewBox="0 0 ${sceneWidth} ${sceneHeight}" preserveAspectRatio="none">
          ${edgesMarkup}
        </svg>
        ${nodesMarkup}
      </div>
    `;

    pipelineTraceGraph.querySelectorAll("[data-trace-graph-node-id]").forEach((element) => {
      element.addEventListener("click", () => {
        focusTraceGraphNode(element.getAttribute("data-trace-graph-node-id"), graph);
      });
    });
  }

  function renderCard(node) {
    const position = state.layout[node.id] || { x: 120, y: 120 };
    const fields = (node.fields || []).slice(0, 8);
    const traceNodeIds = new Set(getActiveTraceNodeIds());
    const traceFocusCardId = getFocusedTraceCardId();
    return `
      <article
        class="pl-card ${state.selectedCardId === node.id || traceNodeIds.has(node.id) ? "is-selected" : ""} ${traceFocusCardId === node.id ? "is-trace-focus" : ""}"
        data-pl-card-id="${node.id}"
        style="transform: translate(${position.x}px, ${position.y}px); width: ${CARD_WIDTH}px;"
        title="${escapeHtml(node.sourceFile || node.path || node.name)}"
      >
        <header class="pl-card-header" data-pl-drag-id="${node.id}" style="background:${node.titleColor || "#5b8def"};">
          <strong>${escapeHtml(node.name)}</strong>
          <small>${escapeHtml(node.role || "node")}</small>
        </header>
        <div class="pl-card-fields">
          ${fields.map(renderFieldRow).join("")}
        </div>
        ${(node.indexes || []).length ? `
          <div class="pl-card-indexes">
            <span class="pl-card-indexes-title">Indexes</span>
            ${(node.indexes || []).slice(0, 4).map((idx) => `
              <div class="pl-card-index">
                <span class="pl-idx-icon">#</span>
                <span>${escapeHtml([idx.type, ...(idx.fields || [])].join(" · "))}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}
      </article>
    `;
  }

  function renderFieldRow(field) {
    const lead = field.isPrimaryKey
      ? `<span class="pl-field-pk">🔑</span>`
      : field.isForeignKey
        ? `<span class="pl-field-fk">⛓</span>`
        : `<span class="pl-field-plain"></span>`;

    return `
      <div class="pl-field ${field.isPrimaryKey ? "is-pk" : ""} ${field.isForeignKey ? "is-fk" : ""}">
        ${lead}
        <span class="pl-field-name">${escapeHtml(field.name)}</span>
        <span class="pl-field-type">${escapeHtml(field.type)}</span>
      </div>
    `;
  }

  function renderEdge(edge, nodes) {
    const sourceLayout = state.layout[edge.source];
    const targetLayout = state.layout[edge.target];
    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);
    if (!sourceLayout || !targetLayout || !sourceNode || !targetNode) {
      return "";
    }

    const startX = sourceLayout.x + CARD_WIDTH;
    const startY = sourceLayout.y + 42;
    const endX = targetLayout.x;
    const endY = targetLayout.y + 42;
    const midX = (startX + endX) / 2;
    const curve = Math.max(70, Math.abs(endX - startX) * 0.24);
    const activeTraceNodeIds = new Set(getActiveTraceNodeIds());
    const selected =
      (state.selectedCardId && (edge.source === state.selectedCardId || edge.target === state.selectedCardId)) ||
      (activeTraceNodeIds.has(edge.source) && activeTraceNodeIds.has(edge.target));

    return `
      <g class="pl-edge ${selected ? "is-highlighted" : ""}">
        <path d="M ${startX} ${startY} C ${midX - curve} ${startY}, ${midX + curve} ${endY}, ${endX} ${endY}"></path>
        <circle class="pl-edge-dot" cx="${midX}" cy="${(startY + endY) / 2}" r="3"></circle>
      </g>
    `;
  }

  function renderPipelineMinimap() {
    if (!pipelineMinimap) {
      return;
    }

    const dataset = getRenderDataset();
    if (!dataset.nodes.length) {
      pipelineMinimap.innerHTML = "";
      return;
    }

    const rect = pipelineViewport.getBoundingClientRect();
    const viewportWidth = Math.max(rect.width / state.viewState.scale, 180);
    const viewportHeight = Math.max(rect.height / state.viewState.scale, 120);
    const viewportX = clamp(-state.viewState.offsetX / state.viewState.scale, 0, PIPELINE_SCENE_WIDTH - viewportWidth);
    const viewportY = clamp(-state.viewState.offsetY / state.viewState.scale, 0, PIPELINE_SCENE_HEIGHT - viewportHeight);
    const traceNodeIds = new Set(getActiveTraceNodeIds());
    const traceFocusCardId = getFocusedTraceCardId();

    pipelineMinimap.innerHTML = `
      <div class="pipeline-minimap-world" data-pipeline-minimap-world="true">
        ${dataset.nodes.map((node) => {
          const position = state.layout[node.id];
          if (!position) {
            return "";
          }
          const centerX = position.x + CARD_WIDTH / 2;
          const centerY = position.y + CARD_HEIGHT / 2;
          const width = clamp((CARD_WIDTH / PIPELINE_SCENE_WIDTH) * 100, 4, 16);
          const height = clamp((CARD_HEIGHT / PIPELINE_SCENE_HEIGHT) * 100, 3, 11);
          const classNames = [
            "pipeline-minimap-node",
            state.selectedCardId === node.id ? "is-selected" : "",
            traceNodeIds.has(node.id) ? "is-trace" : "",
            traceFocusCardId === node.id ? "is-trace-focus" : "",
          ].filter(Boolean).join(" ");
          return `
            <span
              class="${classNames}"
              style="left:${(centerX / PIPELINE_SCENE_WIDTH) * 100}%; top:${(centerY / PIPELINE_SCENE_HEIGHT) * 100}%; width:${width}%; height:${height}%;"
              title="${escapeHtmlAttribute(node.name)}"
              data-pipeline-minimap-card-id="${node.id}"
            ></span>
          `;
        }).join("")}
        <div
          class="pipeline-minimap-window"
          data-pipeline-minimap-window="true"
          style="
            left:${(viewportX / PIPELINE_SCENE_WIDTH) * 100}%;
            top:${(viewportY / PIPELINE_SCENE_HEIGHT) * 100}%;
            width:${(viewportWidth / PIPELINE_SCENE_WIDTH) * 100}%;
            height:${(viewportHeight / PIPELINE_SCENE_HEIGHT) * 100}%;
          "
        ></div>
      </div>
    `;
  }

  function getPipelineCardById(cardId) {
    return getRenderDataset().nodes.find((node) => node.id === cardId) || null;
  }

  function getPipelineCardFilePaths(node) {
    return [node?.path, node?.sourceFile].map(normalizeComparablePath).filter(Boolean);
  }

  function buildPipelineOverviewPayload(cardId) {
    const node = getPipelineCardById(cardId);
    if (!node) {
      return null;
    }
    return {
      cardId,
      nodeName: node.name,
      filePaths: getPipelineCardFilePaths(node),
      workspacePath: normalizeComparablePath(pipelinePathInput.value.trim()),
    };
  }

  function showPipelineSyncHint(message, target = "") {
    if (!pipelineSyncHint) {
      return;
    }
    pipelineSyncHint.innerHTML = `
      <span class="canvas-sync-label">${escapeHtml(message)}</span>
      ${target ? `<strong class="canvas-sync-target">${escapeHtml(target)}</strong>` : ""}
    `;
    pipelineSyncHint.classList.add("is-visible", "is-pipeline");
    if (state.syncHintTimer) {
      window.clearTimeout(state.syncHintTimer);
    }
    state.syncHintTimer = window.setTimeout(() => {
      pipelineSyncHint.classList.remove("is-visible");
    }, 2200);
  }

  async function notifyGraphOverviewSync(cardId) {
    if (state.overviewSyncMuted || typeof window.focusGraphOverview !== "function") {
      return;
    }
    const payload = buildPipelineOverviewPayload(cardId);
    if (!payload) {
      return;
    }
    await window.focusGraphOverview(payload, { source: "pipeline", silentBridge: true });
  }

  function resolvePipelineCardIdForOverviewPayload(payload = {}) {
    const dataset = getRenderDataset();
    const requestedPaths = (Array.isArray(payload.filePaths) ? payload.filePaths : [])
      .map(normalizeComparablePath)
      .filter(Boolean);
    if (requestedPaths.length) {
      const directCard = dataset.nodes.find((node) => {
        const cardPaths = getPipelineCardFilePaths(node);
        return cardPaths.some((cardPath) => requestedPaths.includes(cardPath));
      });
      if (directCard) {
        return directCard.id;
      }
    }

    if (payload.cardId && dataset.nodes.some((node) => node.id === payload.cardId)) {
      return payload.cardId;
    }

    return null;
  }

  async function focusPipelineOverview(payload = {}, options = {}) {
    const workspacePath = normalizeComparablePath(payload.workspacePath);
    const currentWorkspacePath = normalizeComparablePath(pipelinePathInput.value.trim());
    if (workspacePath && (workspacePath !== currentWorkspacePath || !state.pipeline?.nodes?.length)) {
      pipelinePathInput.value = workspacePath;
      await scanProject(workspacePath);
    }

    const targetCardId = resolvePipelineCardIdForOverviewPayload(payload);
    if (!targetCardId) {
      return false;
    }

    const shouldMute = options.silentBridge !== false;
    if (shouldMute) {
      state.overviewSyncMuted = true;
    }
    try {
      selectPipelineCard(targetCardId, { recenter: true, clearTrace: false, skipOverviewSync: true });
      const sourceLabel = options.source || payload.source;
      if (sourceLabel === "graph") {
        const targetLabel =
          payload.nodeName ||
          pathBaseName(payload.filePaths?.[0] || "") ||
          shortenPath(payload.filePaths?.[0] || "");
        showPipelineSyncHint("Synced from graph", targetLabel);
      }
      return true;
    } finally {
      if (shouldMute) {
        state.overviewSyncMuted = false;
      }
    }
  }

  function selectPipelineCard(cardId, options = {}) {
    if (!cardId) {
      return;
    }
    const { recenter = false, clearTrace = true, skipOverviewSync = false } = options;
    state.selectedCardId = cardId;
    if (clearTrace) {
      state.activeTraceId = null;
      state.activeTraceGraphNodeId = null;
    }
    state.sourcePreview = null;
    renderCardsAndEdges();
    renderTraceList();
    renderTraceLanes();
    renderTraceGraph();
    renderSourcePreview();
    if (recenter) {
      recenterOnPipelineCard(cardId);
    }
    if (!skipOverviewSync) {
      void notifyGraphOverviewSync(cardId);
    }
  }

  function panPipelineToScenePoint(x, y) {
    const rect = pipelineViewport.getBoundingClientRect();
    state.viewState.offsetX = rect.width / 2 - x * state.viewState.scale;
    state.viewState.offsetY = rect.height / 2 - y * state.viewState.scale;
    applyPipelineTransform();
    persistState();
  }

  function panPipelineViewportToMinimapClientPoint(clientX, clientY, anchorRatioX = 0.5, anchorRatioY = 0.5) {
    const world = pipelineMinimap?.querySelector(".pipeline-minimap-world");
    if (!world) {
      return;
    }
    const rect = world.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const worldRatioX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const worldRatioY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const viewportRect = pipelineViewport.getBoundingClientRect();
    const viewportWidth = Math.max(viewportRect.width / state.viewState.scale, 180);
    const viewportHeight = Math.max(viewportRect.height / state.viewState.scale, 120);
    const viewportX = clamp(worldRatioX * PIPELINE_SCENE_WIDTH - viewportWidth * anchorRatioX, 0, PIPELINE_SCENE_WIDTH - viewportWidth);
    const viewportY = clamp(worldRatioY * PIPELINE_SCENE_HEIGHT - viewportHeight * anchorRatioY, 0, PIPELINE_SCENE_HEIGHT - viewportHeight);
    state.viewState.offsetX = -viewportX * state.viewState.scale;
    state.viewState.offsetY = -viewportY * state.viewState.scale;
    applyPipelineTransform();
    persistState();
  }

  function handleMinimapPointerDown(event) {
    const windowHandle = event.target.closest("[data-pipeline-minimap-window]");
    if (!windowHandle) {
      return;
    }
    const windowRect = windowHandle.getBoundingClientRect();
    state.minimapDragState = {
      anchorRatioX: windowRect.width ? clamp((event.clientX - windowRect.left) / windowRect.width, 0, 1) : 0.5,
      anchorRatioY: windowRect.height ? clamp((event.clientY - windowRect.top) / windowRect.height, 0, 1) : 0.5,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    pipelineMinimap.classList.add("is-dragging-window");
    event.preventDefault();
    event.stopPropagation();
  }

  async function handleMinimapClick(event) {
    if (Date.now() < state.suppressMinimapClickUntil) {
      event.preventDefault();
      return;
    }

    if (event.target.closest("[data-pipeline-minimap-window]")) {
      return;
    }

    const marker = event.target.closest("[data-pipeline-minimap-card-id]");
    if (marker) {
      event.preventDefault();
      event.stopPropagation();
      selectPipelineCard(marker.getAttribute("data-pipeline-minimap-card-id"), { recenter: true, clearTrace: true });
      return;
    }

    const world = event.target.closest("[data-pipeline-minimap-world]");
    if (!world) {
      return;
    }

    event.preventDefault();
    const rect = world.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    panPipelineToScenePoint(ratioX * PIPELINE_SCENE_WIDTH, ratioY * PIPELINE_SCENE_HEIGHT);
  }

  function bindCardEvents(dataset) {
    pipelineCards.querySelectorAll("[data-pl-card-id]").forEach((card) => {
      const cardId = card.getAttribute("data-pl-card-id");
      card.addEventListener("click", () => {
        selectPipelineCard(cardId, { recenter: false, clearTrace: true });
      });
    });

    pipelineCards.querySelectorAll("[data-pl-drag-id]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        const cardId = handle.getAttribute("data-pl-drag-id");
        state.dragState = {
          cardId,
          startX: event.clientX,
          startY: event.clientY,
        };
        state.selectedCardId = cardId;
        state.activeTraceId = null;
        state.activeTraceGraphNodeId = null;
        state.sourcePreview = null;
        renderTraceLanes();
        renderTraceGraph();
        renderSourcePreview();
      });
    });
  }

  function getActiveTraceNodeIds() {
    const trace = getActiveTrace();
    if (!trace) {
      return [];
    }

    const pathToNodeIds = new Map();
    (state.pipeline?.nodes || []).forEach((node) => {
      if (!pathToNodeIds.has(node.path)) {
        pathToNodeIds.set(node.path, []);
      }
      pathToNodeIds.get(node.path).push(node.id);
    });

    return trace.steps.flatMap((step) => pathToNodeIds.get(step.filePath) || []);
  }

  function getActiveTrace() {
    return (state.pipeline?.traces || []).find((item) => item.id === state.activeTraceId) || null;
  }

  function getFocusedTraceNode() {
    const trace = getActiveTrace();
    if (!trace || !state.activeTraceGraphNodeId) {
      return null;
    }
    return (trace.traceGraph?.nodes || []).find((node) => node.id === state.activeTraceGraphNodeId) || null;
  }

  function getFocusedTraceCardId() {
    const focusedNode = getFocusedTraceNode();
    if (!focusedNode?.filePath) {
      return null;
    }
    return (state.pipeline?.nodes || []).find((node) => node.path === focusedNode.filePath)?.id || null;
  }

  function isTraceStepFocused(step) {
    const focusedNode = getFocusedTraceNode();
    if (!focusedNode) {
      return false;
    }

    if (focusedNode.filePath && step.filePath !== focusedNode.filePath) {
      return false;
    }

    if (focusedNode.symbol && step.symbol) {
      return step.symbol === focusedNode.symbol;
    }

    return step.label === focusedNode.label;
  }

  function focusTraceGraphNode(traceNodeId, graph) {
    const traceNode = (graph?.nodes || []).find((node) => node.id === traceNodeId);
    if (!traceNode?.filePath) {
      return;
    }

    const fileCard = (state.pipeline?.nodes || []).find((node) => node.path === traceNode.filePath);
    if (!fileCard) {
      return;
    }

    state.activeTraceGraphNodeId = traceNodeId;
    selectPipelineCard(fileCard.id, { recenter: true, clearTrace: false });
    loadSourcePreview({
      filePath: traceNode.filePath,
      line: traceNode.line,
      symbol: traceNode.symbol || "",
      label: traceNode.label || "",
    });
  }

  function focusTraceLaneStep(step) {
    const trace = getActiveTrace();
    const graph = trace?.traceGraph;
    if (!graph?.nodes?.length) {
      return;
    }

    const traceNodeId = findTraceGraphNodeIdForStep(step, graph);
    if (!traceNodeId) {
      return;
    }

    focusTraceGraphNode(traceNodeId, graph);
  }

  function findTraceGraphNodeIdForStep(step, graph) {
    const nodes = graph?.nodes || [];
    const exact = nodes.find((node) =>
      node.filePath === step.filePath &&
      (step.symbol ? node.symbol === step.symbol : true) &&
      (step.label ? node.label === step.label : true)
    );
    if (exact) {
      return exact.id;
    }

    const symbolMatch = nodes.find((node) =>
      node.filePath === step.filePath &&
      step.symbol &&
      node.symbol === step.symbol
    );
    if (symbolMatch) {
      return symbolMatch.id;
    }

    const labelMatch = nodes.find((node) =>
      node.filePath === step.filePath &&
      step.label &&
      node.label === step.label
    );
    if (labelMatch) {
      return labelMatch.id;
    }

    return nodes.find((node) => node.filePath === step.filePath)?.id || null;
  }

  function handleViewportPointerDown(event) {
    if (event.target.closest("[data-pl-card-id]")) {
      return;
    }
    state.panState = {
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: state.viewState.offsetX,
      originOffsetY: state.viewState.offsetY,
    };
    pipelineViewport.classList.add("is-panning");
  }

  function handlePointerMove(event) {
    if (state.dragState) {
      const layout = state.layout[state.dragState.cardId];
      if (!layout) {
        return;
      }
      layout.x += (event.clientX - state.dragState.startX) / state.viewState.scale;
      layout.y += (event.clientY - state.dragState.startY) / state.viewState.scale;
      state.dragState.startX = event.clientX;
      state.dragState.startY = event.clientY;
      persistState();
      renderCardsAndEdges();
      return;
    }

    if (state.minimapDragState) {
      const movedEnough =
        Math.abs(event.clientX - state.minimapDragState.startX) > 3 ||
        Math.abs(event.clientY - state.minimapDragState.startY) > 3;
      state.minimapDragState.moved = state.minimapDragState.moved || movedEnough;
      panPipelineViewportToMinimapClientPoint(
        event.clientX,
        event.clientY,
        state.minimapDragState.anchorRatioX,
        state.minimapDragState.anchorRatioY
      );
      return;
    }

    if (state.panState) {
      state.viewState.offsetX = state.panState.originOffsetX + (event.clientX - state.panState.startX);
      state.viewState.offsetY = state.panState.originOffsetY + (event.clientY - state.panState.startY);
      applyPipelineTransform();
      persistState();
    }
  }

  function handlePointerUp() {
    state.dragState = null;
    if (state.panState) {
      state.panState = null;
      pipelineViewport.classList.remove("is-panning");
    }
    if (state.minimapDragState) {
      if (state.minimapDragState.moved) {
        state.suppressMinimapClickUntil = Date.now() + 180;
      }
      state.minimapDragState = null;
      pipelineMinimap?.classList.remove("is-dragging-window");
      persistState();
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    zoomPipeline(event.deltaY < 0 ? 0.08 : -0.08);
  }

  function zoomPipeline(delta) {
    state.viewState.scale = clamp(state.viewState.scale + delta, 0.35, 1.8);
    applyPipelineTransform();
    persistState();
  }

  function recenterPipelineView() {
    const dataset = getRenderDataset();
    if (!dataset.nodes.length) {
      return;
    }

    const positions = dataset.nodes
      .map((node) => state.layout[node.id])
      .filter(Boolean);
    const minX = Math.min(...positions.map((pos) => pos.x));
    const maxX = Math.max(...positions.map((pos) => pos.x + CARD_WIDTH));
    const minY = Math.min(...positions.map((pos) => pos.y));
    const maxY = Math.max(...positions.map((pos) => pos.y + CARD_HEIGHT));
    const rect = pipelineViewport.getBoundingClientRect();

    state.viewState.offsetX = rect.width / 2 - ((minX + maxX) / 2) * state.viewState.scale;
    state.viewState.offsetY = rect.height / 2 - ((minY + maxY) / 2) * state.viewState.scale;
    applyPipelineTransform();
    persistState();
  }

  function fitPipelineToScreen() {
    const dataset = getRenderDataset();
    if (!dataset.nodes.length) {
      return;
    }

    const positions = dataset.nodes
      .map((node) => state.layout[node.id])
      .filter(Boolean);
    if (!positions.length) {
      return;
    }

    const minX = Math.min(...positions.map((pos) => pos.x - 28));
    const maxX = Math.max(...positions.map((pos) => pos.x + CARD_WIDTH + 28));
    const minY = Math.min(...positions.map((pos) => pos.y - 24));
    const maxY = Math.max(...positions.map((pos) => pos.y + CARD_HEIGHT + 24));
    const rect = pipelineViewport.getBoundingClientRect();
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const scaleX = Math.max((rect.width - 40) / width, 0.1);
    const scaleY = Math.max((rect.height - 40) / height, 0.1);
    state.viewState.scale = clamp(Math.min(scaleX, scaleY), 0.35, 1.2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    state.viewState.offsetX = rect.width / 2 - centerX * state.viewState.scale;
    state.viewState.offsetY = rect.height / 2 - centerY * state.viewState.scale;
    applyPipelineTransform();
    persistState();
  }

  function recenterOnPipelineCard(cardId) {
    const layout = state.layout[cardId];
    if (!layout) {
      return;
    }

    const rect = pipelineViewport.getBoundingClientRect();
    state.viewState.offsetX = rect.width / 2 - (layout.x + CARD_WIDTH / 2) * state.viewState.scale;
    state.viewState.offsetY = rect.height / 2 - (layout.y + CARD_HEIGHT / 2) * state.viewState.scale;
    applyPipelineTransform();
    persistState();
  }

  async function loadSourcePreview(target) {
    const filePath = target?.filePath || "";
    if (!filePath) {
      state.sourcePreview = null;
      renderSourcePreview();
      return;
    }

    pipelineSourcePreviewMeta.textContent = "loading preview...";
    pipelineSourcePreview.innerHTML = `<p class="empty-state">Dang tai source preview...</p>`;

    try {
      const params = new URLSearchParams({
        path: filePath,
        line: String(target.line || ""),
        symbol: target.symbol || "",
        label: target.label || "",
      });
      const response = await fetch(`/api/source-preview?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || "Khong tai duoc source preview.");
      }
      state.sourcePreview = payload;
      renderSourcePreview();
    } catch (error) {
      state.sourcePreview = {
        error: error.message || "Khong tai duoc source preview.",
        filePath,
      };
      renderSourcePreview();
    }
  }

  function renderSourcePreview() {
    const preview = state.sourcePreview;
    if (!preview) {
      pipelineSourcePreviewMeta.textContent = "no selection";
      pipelineSourcePreview.innerHTML = `<p class="empty-state">Chon symbol node hoac lane step de xem doan code tuong ung.</p>`;
      return;
    }

    if (preview.error) {
      pipelineSourcePreviewMeta.textContent = shortenPath(preview.filePath || "");
      pipelineSourcePreview.innerHTML = `<p class="empty-state">${escapeHtml(preview.error)}</p>`;
      return;
    }

    pipelineSourcePreviewMeta.textContent = `${shortenPath(preview.filePath)} · L${preview.focusLine || preview.startLine}`;
    pipelineSourcePreview.innerHTML = `
      <div class="pl-source-header">
        <strong>${escapeHtml(preview.symbol || preview.label || pathBaseName(preview.filePath))}</strong>
        <span>${escapeHtml(preview.filePath)}</span>
      </div>
      <pre class="pl-source-code">${preview.lines.map((line) => `
<div class="pl-source-line ${line.number === preview.focusLine ? "is-focus" : ""}">
  <span class="pl-source-line-no">${line.number}</span>
  <code>${escapeHtml(line.text || " ")}</code>
</div>`).join("")}
      </pre>
    `;
  }

  function pathBaseName(filePath) {
    return String(filePath || "").split(/[\\/]/).pop() || filePath || "";
  }

  function renderSourcePreview() {
    const preview = state.sourcePreview;
    if (!preview) {
      pipelineSourcePreviewMeta.textContent = "no selection";
      pipelineSourcePreview.innerHTML = `<p class="empty-state">Chon symbol node hoac lane step de xem doan code tuong ung.</p>`;
      return;
    }

    if (preview.error) {
      pipelineSourcePreviewMeta.textContent = shortenPath(preview.filePath || "");
      pipelineSourcePreview.innerHTML = `<p class="empty-state">${escapeHtml(preview.error)}</p>`;
      return;
    }

    const referenceCount = preview.references?.length || 0;
    const currentReference = referenceCount ? Math.max(1, (preview.focusIndex ?? 0) + 1) : 0;
    const referenceItems = referenceCount
      ? `
        <div class="pl-source-reference-list">
          ${preview.references.map((reference, index) => `
            <button
              type="button"
              class="pl-source-reference-item ${index === (preview.focusIndex ?? 0) ? "is-active" : ""}"
              data-source-ref="${index}"
              title="${escapeHtml(reference.text || "")}"
            >
              <span class="pl-source-reference-line">L${reference.line}</span>
              <span class="pl-source-reference-text">${escapeHtml(reference.text || "(empty line)")}</span>
            </button>
          `).join("")}
        </div>
      `
      : "";
    pipelineSourcePreviewMeta.textContent = `${shortenPath(preview.filePath)} | L${preview.focusLine || preview.startLine}${referenceCount ? ` | ref ${currentReference}/${referenceCount}` : ""}`;
    pipelineSourcePreview.innerHTML = `
      <div class="pl-source-header">
        <div class="pl-source-header-main">
          <strong>${escapeHtml(preview.symbol || preview.label || pathBaseName(preview.filePath))}</strong>
          <span>${escapeHtml(preview.filePath)}</span>
        </div>
        <div class="pl-source-nav">
          <button type="button" data-source-nav="prev" ${referenceCount > 1 ? "" : "disabled"}>Prev Ref</button>
          <button type="button" data-source-nav="next" ${referenceCount > 1 ? "" : "disabled"}>Next Ref</button>
        </div>
      </div>
      ${referenceItems}
      <pre class="pl-source-code">${preview.lines.map((line) => `
<div class="pl-source-line ${line.number === preview.focusLine ? "is-focus" : ""}">
  <span class="pl-source-line-no">${line.number}</span>
  <code>${escapeHtml(line.text || " ")}</code>
</div>`).join("")}
      </pre>
    `;

    pipelineSourcePreview.querySelectorAll("[data-source-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        stepSourceReference(button.getAttribute("data-source-nav"));
      });
    });

    pipelineSourcePreview.querySelectorAll("[data-source-ref]").forEach((button) => {
      button.addEventListener("click", () => {
        jumpToSourceReference(Number(button.getAttribute("data-source-ref")));
      });
    });
  }

  function stepSourceReference(direction) {
    const preview = state.sourcePreview;
    const references = preview?.references || [];
    if (references.length < 2) {
      return;
    }

    const currentIndex = preview.focusIndex >= 0 ? preview.focusIndex : 0;
    const nextIndex = direction === "prev"
      ? (currentIndex - 1 + references.length) % references.length
      : (currentIndex + 1) % references.length;
    const reference = references[nextIndex];
    if (!reference) {
      return;
    }

    jumpToSourceReference(nextIndex);
  }

  function jumpToSourceReference(index) {
    const preview = state.sourcePreview;
    const references = preview?.references || [];
    if (!Number.isInteger(index) || index < 0 || index >= references.length) {
      return;
    }

    const reference = references[index];
    if (!reference) {
      return;
    }

    loadSourcePreview({
      filePath: preview.filePath,
      line: reference.line,
      symbol: preview.symbol || "",
      label: preview.label || "",
    });
  }

  function applyPipelineTransform() {
    pipelineScene.style.transform = `translate(${state.viewState.offsetX}px, ${state.viewState.offsetY}px) scale(${state.viewState.scale})`;
    renderPipelineMinimap();
  }

  function countTreeStats(node) {
    if (!node) {
      return { dirs: 0, files: 0 };
    }
    if (node.type === "file") {
      return { dirs: 0, files: 1 };
    }
    return (node.children || []).reduce(
      (acc, child) => {
        const childStats = countTreeStats(child);
        acc.dirs += childStats.dirs;
        acc.files += childStats.files;
        return acc;
      },
      { dirs: 1, files: 0 }
    );
  }

  function setFeedback(message, type) {
    pipelineFeedback.innerHTML = `<div class="pl-fb-${type}">${escapeHtml(message)}</div>`;
  }

  function compactStepMeta(step) {
    const parts = [];
    if (step.filePath) parts.push(shortenPath(step.filePath));
    if (step.symbol) parts.push(step.symbol);
    if (step.line) parts.push(`L${step.line}`);
    return parts.join(" · ");
  }

  function compactTraceNodeMeta(node) {
    const parts = [];
    if (node.filePath) parts.push(shortenPath(node.filePath));
    if (node.symbol) parts.push(node.symbol);
    if (node.line) parts.push(`L${node.line}`);
    return parts.join(" · ");
  }

  function shortenPath(value) {
    const normalized = String(value || "").replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.slice(-3).join("/");
  }

  function formatBytes(value) {
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${Math.round(value / 102.4) / 10} KB`;
    }
    return `${Math.round(value / 104857.6) / 10} MB`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
