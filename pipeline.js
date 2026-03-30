/* ──────────────────────────────────────────────────────────────
   Pipeline Scanner — Frontend Module
   Quét cấu trúc thư mục + trích xuất schema → hiển thị pipeline ERD
   Kết nối với Graph Memory qua nút "Sync to Graph"
   ────────────────────────────────────────────────────────────── */

(() => {
  "use strict";

  /* ── DOM refs ─────────────────────────────────────────────── */
  const scanForm = document.getElementById("pipelineScanForm");
  const pathInput = document.getElementById("pipelinePathInput");
  const scanBtn = document.getElementById("pipelineScanBtn");
  const syncGraphBtn = document.getElementById("pipelineSyncGraphBtn");
  const statusLabel = document.getElementById("pipelineStatus");
  const treeStats = document.getElementById("pipelineTreeStats");
  const treeContainer = document.getElementById("pipelineTree");
  const cardCount = document.getElementById("pipelineCardCount");
  const viewport = document.getElementById("pipelineViewport");
  const scene = document.getElementById("pipelineScene");
  const edgesSvg = document.getElementById("pipelineEdges");
  const cardsContainer = document.getElementById("pipelineCards");
  const zoomInBtn = document.getElementById("pipelineZoomIn");
  const zoomOutBtn = document.getElementById("pipelineZoomOut");
  const recenterBtn = document.getElementById("pipelineRecenter");
  const feedbackEl = document.getElementById("pipelineFeedback");

  /* ── State ────────────────────────────────────────────────── */
  let currentTree = null;
  let currentSchema = null;
  let currentScanPath = "";
  let pipelineView = { scale: 0.82, offsetX: 0, offsetY: 0 };
  let cardPositions = {};
  let panState = null;
  let dragState = null;
  let selectedCard = null;

  const CARD_WIDTH = 220;
  const CARD_HEADER = 36;
  const FIELD_HEIGHT = 26;
  const CARD_GAP_X = 100;
  const CARD_GAP_Y = 80;
  const SCENE_W = 3200;
  const SCENE_H = 2400;

  const TABLE_COLORS = [
    "#5b8def", "#e67e22", "#2ecc71", "#e74c3c",
    "#9b59b6", "#1abc9c", "#f39c12", "#3498db",
    "#e91e63", "#00bcd4", "#8bc34a", "#ff5722",
    "#607d8b", "#795548", "#673ab7", "#009688",
  ];

  /* ── Events ───────────────────────────────────────────────── */
  scanForm.addEventListener("submit", handleScan);
  syncGraphBtn.addEventListener("click", handleSyncToGraph);
  zoomInBtn.addEventListener("click", () => zoomPipeline(0.1));
  zoomOutBtn.addEventListener("click", () => zoomPipeline(-0.1));
  recenterBtn.addEventListener("click", recenterPipeline);
  document.getElementById("pipelineFullscreen").addEventListener("click", () => {
    if (typeof window.toggleCanvasFullscreen === "function") {
      window.toggleCanvasFullscreen("pipeline");
    }
  });
  viewport.addEventListener("wheel", handlePipelineWheel, { passive: false });
  viewport.addEventListener("pointerdown", handleViewportPointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);

  /* ── Scan Handler ─────────────────────────────────────────── */
  async function handleScan(event) {
    event.preventDefault();
    const scanPath = pathInput.value.trim();
    if (!scanPath) {
      feedback("Hãy nhập đường dẫn project cần quét.", "warn");
      return;
    }

    statusLabel.textContent = "scanning...";
    scanBtn.disabled = true;
    feedback("Đang quét project...", "info");

    try {
      const [treeRes, schemaRes] = await Promise.all([
        fetch(`/api/scan-tree?path=${encodeURIComponent(scanPath)}&maxDepth=6`),
        fetch(`/api/scan-schema?path=${encodeURIComponent(scanPath)}`),
      ]);

      if (!treeRes.ok || !schemaRes.ok) {
        const errPayload = await (treeRes.ok ? schemaRes : treeRes).json();
        throw new Error(errPayload.message || "Scan failed.");
      }

      const treeData = await treeRes.json();
      const schemaData = await schemaRes.json();

      currentTree = treeData.tree;
      currentSchema = schemaData;
      currentScanPath = scanPath;

      renderTree(currentTree);
      renderPipeline(currentSchema);

      statusLabel.textContent = `${schemaData.tables.length} tables · ${schemaData.relations.length} relations`;
      syncGraphBtn.disabled = !schemaData.tables.length;
      feedback(`Quét xong: ${schemaData.summary}`, "ok");
    } catch (error) {
      feedback(`Lỗi: ${error.message}`, "err");
      statusLabel.textContent = "scan failed";
    } finally {
      scanBtn.disabled = false;
    }
  }

  /* ── Sync to Graph Handler ────────────────────────────────── */
  async function handleSyncToGraph() {
    if (!currentScanPath) return;

    syncGraphBtn.disabled = true;
    feedback("Đang đồng bộ schema vào Graph Memory...", "info");

    try {
      const res = await fetch("/api/scan-to-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentScanPath }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.message || "Sync failed.");
      }

      feedback(
        `Đã đồng bộ: ${payload.added} nodes mới, ${payload.updated} đã cập nhật. Graph Memory đã được liên kết.`,
        "ok"
      );

      /* Trigger graph reload in main app.js */
      if (typeof window.syncGraphState === "function") {
        window.syncGraphState();
      } else {
        /* Fallback: reload graph data manually */
        try {
          const graphRes = await fetch("/api/graph");
          if (graphRes.ok && window.store) {
            window.store = await graphRes.json();
          }
        } catch { /* silent */ }
      }
    } catch (error) {
      feedback(`Lỗi đồng bộ: ${error.message}`, "err");
    } finally {
      syncGraphBtn.disabled = false;
    }
  }

  /* ── Tree Rendering ───────────────────────────────────────── */
  function renderTree(tree) {
    if (!tree) {
      treeContainer.innerHTML = `<p class="empty-state">Chưa quét thư mục nào.</p>`;
      treeStats.textContent = "-";
      return;
    }

    const stats = countTree(tree);
    treeStats.textContent = `${stats.files} files · ${stats.dirs} dirs`;
    treeContainer.innerHTML = buildTreeHtml(tree, 0, true);

    treeContainer.querySelectorAll(".pl-tree-toggle").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = btn.closest(".pl-tree-dir");
        if (parent) {
          parent.classList.toggle("is-collapsed");
        }
      });
    });

    treeContainer.querySelectorAll(".pl-tree-file").forEach((el) => {
      el.addEventListener("click", () => {
        const filePath = el.getAttribute("data-file-path");
        highlightRelatedCards(filePath);
      });
    });
  }

  function buildTreeHtml(node, depth, isExpanded) {
    if (node.type === "file") {
      const ext = node.ext || "";
      const icon = getFileIcon(ext);
      return `
        <div class="pl-tree-file" data-file-path="${escHtml(node.path)}" style="--tree-d:${depth}">
          <span class="pl-tree-icon">${icon}</span>
          <span class="pl-tree-name">${escHtml(node.name)}</span>
          <small class="pl-tree-size">${formatSize(node.size)}</small>
        </div>
      `;
    }

    const children = (node.children || [])
      .map((child) => buildTreeHtml(child, depth + 1, depth < 1))
      .join("");

    return `
      <div class="pl-tree-dir ${isExpanded ? "" : "is-collapsed"}" style="--tree-d:${depth}">
        <div class="pl-tree-toggle">
          <span class="pl-tree-icon">📁</span>
          <span class="pl-tree-name">${escHtml(node.name)}</span>
          <small class="pl-tree-count">${node.fileCount || 0}f · ${node.dirCount || 0}d</small>
        </div>
        <div class="pl-tree-children">${children}</div>
      </div>
    `;
  }

  function countTree(node) {
    if (node.type === "file") return { files: 1, dirs: 0 };
    let files = 0;
    let dirs = 1;
    (node.children || []).forEach((child) => {
      const sub = countTree(child);
      files += sub.files;
      dirs += sub.dirs;
    });
    return { files, dirs };
  }

  /* ── Pipeline / ERD Rendering ─────────────────────────────── */
  function renderPipeline(schema) {
    if (!schema || !schema.tables.length) {
      cardsContainer.innerHTML = `<p class="empty-state" style="color:rgba(230,236,244,0.6);padding:40px;">Không tìm thấy schema nào (Prisma, SQL, Django, model files).</p>`;
      edgesSvg.innerHTML = "";
      cardCount.textContent = "0 tables · 0 relations";
      return;
    }

    cardCount.textContent = `${schema.tables.length} tables · ${schema.relations.length} relations`;

    layoutCards(schema.tables);
    renderCards(schema.tables);
    renderEdges(schema.tables, schema.relations);
    applyPipelineTransform();
    recenterPipeline();
  }

  function layoutCards(tables) {
    /* Restore saved positions if available for this path */
    const savedKey = `pipeline-pos-${currentScanPath}`;
    const saved = loadPositions(savedKey);

    if (saved && Object.keys(saved).length) {
      /* Use saved positions, add any new tables not in saved */
      let hasAll = true;
      tables.forEach((table) => {
        if (!saved[table.name]) hasAll = false;
      });

      if (hasAll) {
        cardPositions = saved;
        /* Recalculate heights for render */
        tables.forEach((table) => {
          const cardH = CARD_HEADER + table.fields.length * FIELD_HEIGHT + 12;
          cardPositions[table.name].width = CARD_WIDTH;
          cardPositions[table.name].height = cardH;
        });
        return;
      }
    }

    /* Fresh layout: grid with per-row max height */
    const cols = Math.max(Math.ceil(Math.sqrt(tables.length)), 1);
    cardPositions = {};

    /* Pre-calculate card heights */
    const heights = tables.map(
      (t) => Math.max(CARD_HEADER + t.fields.length * FIELD_HEIGHT + 12, 140)
    );

    /* Calculate max height per row */
    const rows = Math.ceil(tables.length / cols);
    const rowMaxH = [];
    for (let r = 0; r < rows; r++) {
      let maxH = 0;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx < heights.length) maxH = Math.max(maxH, heights[idx]);
      }
      rowMaxH.push(maxH);
    }

    /* Assign positions using cumulative row heights */
    let yOffset = 80;
    tables.forEach((table, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      if (col === 0 && row > 0) {
        yOffset += rowMaxH[row - 1] + CARD_GAP_Y;
      }

      cardPositions[table.name] = {
        x: 80 + col * (CARD_WIDTH + CARD_GAP_X),
        y: yOffset,
        width: CARD_WIDTH,
        height: heights[index],
      };
    });

    savePositions(savedKey);
  }

  function renderCards(tables) {
    cardsContainer.innerHTML = tables
      .map((table, index) => {
        const pos = cardPositions[table.name];
        const color = table.color || TABLE_COLORS[index % TABLE_COLORS.length];
        const isSelected = selectedCard === table.name;

        return `
          <div
            class="pl-card ${isSelected ? "is-selected" : ""}"
            data-table-name="${escHtml(table.name)}"
            style="transform: translate(${pos.x}px, ${pos.y}px); width: ${pos.width}px;"
          >
            <div class="pl-card-header" style="background: ${color};">
              <strong>${escHtml(table.name)}</strong>
              <small>${table.source || ""}</small>
            </div>
            <div class="pl-card-fields">
              ${table.fields.map((f) => renderFieldRow(f)).join("")}
            </div>
            ${table.indexes && table.indexes.length ? `
              <div class="pl-card-indexes">
                <small class="pl-card-indexes-title">Indexes</small>
                ${table.indexes.map((idx) => `
                  <div class="pl-card-index">
                    <span class="pl-idx-icon">${idx.type === "unique" ? "◆" : "◇"}</span>
                    <span>${idx.fields ? idx.fields.join(", ") : idx.name || ""}</span>
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>
        `;
      })
      .join("");

    /* Bind card interactions */
    cardsContainer.querySelectorAll(".pl-card").forEach((cardEl) => {
      const tableName = cardEl.getAttribute("data-table-name");

      cardEl.querySelector(".pl-card-header").addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        dragState = {
          tableName,
          startX: e.clientX,
          startY: e.clientY,
          originX: cardPositions[tableName].x,
          originY: cardPositions[tableName].y,
          moved: false,
        };
      });

      cardEl.addEventListener("click", (e) => {
        if (dragState?.moved) return;
        selectedCard = selectedCard === tableName ? null : tableName;
        renderCards(currentSchema.tables);
        renderEdges(currentSchema.tables, currentSchema.relations);
        bindCardToGraph(tableName);
      });
    });
  }

  function renderFieldRow(field) {
    let icon = "";
    if (field.isPrimaryKey) icon = `<span class="pl-field-pk" title="Primary Key">🔑</span>`;
    else if (field.isForeignKey) icon = `<span class="pl-field-fk" title="Foreign Key">🔗</span>`;
    else icon = `<span class="pl-field-plain"></span>`;

    return `
      <div class="pl-field ${field.isPrimaryKey ? "is-pk" : ""} ${field.isForeignKey ? "is-fk" : ""}">
        ${icon}
        <span class="pl-field-name">${escHtml(field.name)}</span>
        <span class="pl-field-type">${escHtml(field.type)}${field.nullable ? "?" : ""}</span>
      </div>
    `;
  }

  function renderEdges(tables, relations) {
    if (!relations.length) {
      edgesSvg.innerHTML = "";
      return;
    }

    edgesSvg.setAttribute("viewBox", `0 0 ${SCENE_W} ${SCENE_H}`);
    edgesSvg.style.width = `${SCENE_W}px`;
    edgesSvg.style.height = `${SCENE_H}px`;

    const lines = relations
      .map((rel) => {
        const sourcePos = cardPositions[rel.sourceTable];
        const targetPos = cardPositions[rel.targetTable];
        if (!sourcePos || !targetPos) return "";

        const sourceTable = tables.find((t) => t.name === rel.sourceTable);
        const targetTable = tables.find((t) => t.name === rel.targetTable);

        let sourceFieldIdx = sourceTable
          ? sourceTable.fields.findIndex((f) => f.name === rel.sourceField)
          : -1;
        let targetFieldIdx = targetTable
          ? targetTable.fields.findIndex((f) => f.name === rel.targetField)
          : -1;

        if (sourceFieldIdx < 0) sourceFieldIdx = 0;
        if (targetFieldIdx < 0) targetFieldIdx = 0;

        const sy = sourcePos.y + CARD_HEADER + sourceFieldIdx * FIELD_HEIGHT + FIELD_HEIGHT / 2;
        const ty = targetPos.y + CARD_HEADER + targetFieldIdx * FIELD_HEIGHT + FIELD_HEIGHT / 2;

        let sx, tx, ctrlDx;
        if (sourcePos.x + sourcePos.width < targetPos.x) {
          sx = sourcePos.x + sourcePos.width;
          tx = targetPos.x;
          ctrlDx = Math.min((tx - sx) / 2, 80);
        } else if (targetPos.x + targetPos.width < sourcePos.x) {
          sx = sourcePos.x;
          tx = targetPos.x + targetPos.width;
          ctrlDx = -Math.min((sourcePos.x - tx) / 2, 80);
        } else {
          sx = sourcePos.x + sourcePos.width;
          tx = targetPos.x + targetPos.width;
          ctrlDx = 60;
        }

        const isHighlighted =
          selectedCard === rel.sourceTable || selectedCard === rel.targetTable;
        const edgeClass = isHighlighted ? "pl-edge is-highlighted" : "pl-edge";

        return `
          <g class="${edgeClass}">
            <path d="M ${sx} ${sy} C ${sx + ctrlDx} ${sy}, ${tx - ctrlDx} ${ty}, ${tx} ${ty}" />
            <circle cx="${sx}" cy="${sy}" r="4" class="pl-edge-dot" />
            <circle cx="${tx}" cy="${ty}" r="4" class="pl-edge-dot" />
          </g>
        `;
      })
      .join("");

    edgesSvg.innerHTML = lines;
  }

  /* ── Graph Integration ────────────────────────────────────── */
  function bindCardToGraph(tableName) {
    if (!tableName) return;

    const schemaNodeId = `schema-${tableName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    /* Try to navigate to this node in the graph sidebar */
    const nodeEl = document.querySelector(`[data-select-node-id="${schemaNodeId}"]`);
    if (nodeEl) {
      nodeEl.scrollIntoView({ behavior: "smooth", block: "center" });
      nodeEl.click();
    }
  }

  function highlightRelatedCards(filePath) {
    if (!currentSchema || !filePath) return;

    const matchingTables = currentSchema.tables.filter(
      (t) => t.sourceFile && t.sourceFile.toLowerCase() === filePath.toLowerCase()
    );

    if (matchingTables.length) {
      selectedCard = matchingTables[0].name;
      renderCards(currentSchema.tables);
      renderEdges(currentSchema.tables, currentSchema.relations);

      const pos = cardPositions[matchingTables[0].name];
      if (pos) {
        const vpRect = viewport.getBoundingClientRect();
        pipelineView.offsetX = vpRect.width / 2 - pos.x * pipelineView.scale;
        pipelineView.offsetY = vpRect.height / 2 - pos.y * pipelineView.scale;
        applyPipelineTransform();
      }
    }
  }

  /* ── Pan / Zoom ───────────────────────────────────────────── */
  function zoomPipeline(delta) {
    pipelineView.scale = clamp(pipelineView.scale + delta, 0.25, 2);
    applyPipelineTransform();
  }

  function recenterPipeline() {
    const names = Object.keys(cardPositions);
    if (!names.length) return;

    const positions = names.map((n) => cardPositions[n]);
    const minX = Math.min(...positions.map((p) => p.x));
    const maxX = Math.max(...positions.map((p) => p.x + p.width));
    const minY = Math.min(...positions.map((p) => p.y));
    const maxY = Math.max(...positions.map((p) => p.y + p.height));

    const vpRect = viewport.getBoundingClientRect();
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const fitScale = Math.min(vpRect.width / (contentW + 120), vpRect.height / (contentH + 120), 1.2);

    pipelineView.scale = clamp(fitScale, 0.25, 2);
    pipelineView.offsetX = (vpRect.width - contentW * pipelineView.scale) / 2 - minX * pipelineView.scale + 20;
    pipelineView.offsetY = (vpRect.height - contentH * pipelineView.scale) / 2 - minY * pipelineView.scale + 20;
    applyPipelineTransform();
  }

  function applyPipelineTransform() {
    scene.style.transform = `translate(${pipelineView.offsetX}px, ${pipelineView.offsetY}px) scale(${pipelineView.scale})`;
  }

  function handlePipelineWheel(event) {
    event.preventDefault();
    zoomPipeline(event.deltaY < 0 ? 0.06 : -0.06);
  }

  function handleViewportPointerDown(event) {
    if (event.target.closest(".pl-card")) return;

    panState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pipelineView.offsetX,
      originY: pipelineView.offsetY,
    };
    viewport.classList.add("is-panning");
  }

  function handlePointerMove(event) {
    if (dragState) {
      const dx = (event.clientX - dragState.startX) / pipelineView.scale;
      const dy = (event.clientY - dragState.startY) / pipelineView.scale;
      dragState.moved = dragState.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;

      cardPositions[dragState.tableName].x = dragState.originX + dx;
      cardPositions[dragState.tableName].y = dragState.originY + dy;

      renderCards(currentSchema.tables);
      renderEdges(currentSchema.tables, currentSchema.relations);
      return;
    }

    if (panState) {
      pipelineView.offsetX = panState.originX + (event.clientX - panState.startX);
      pipelineView.offsetY = panState.originY + (event.clientY - panState.startY);
      applyPipelineTransform();
    }
  }

  function handlePointerUp() {
    if (dragState) {
      if (dragState.moved && currentScanPath) {
        savePositions(`pipeline-pos-${currentScanPath}`);
      }
      dragState = null;
    }
    if (panState) {
      panState = null;
      viewport.classList.remove("is-panning");
    }
  }

  /* ── Position Persistence ────────────────────────────────── */
  function savePositions(key) {
    try {
      const data = {};
      for (const [name, pos] of Object.entries(cardPositions)) {
        data[name] = { x: pos.x, y: pos.y };
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch { /* quota exceeded or unavailable */ }
  }

  function loadPositions(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  /* ── Helpers ──────────────────────────────────────────────── */
  function feedback(msg, type) {
    feedbackEl.textContent = msg;
    feedbackEl.className = `pipeline-feedback pl-fb-${type || "info"}`;
  }

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatSize(bytes) {
    if (!bytes || bytes < 0) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }

  function getFileIcon(ext) {
    const iconMap = {
      ".js": "📜", ".ts": "📘", ".jsx": "⚛️", ".tsx": "⚛️",
      ".py": "🐍", ".rb": "💎", ".go": "🔵", ".rs": "🦀",
      ".html": "🌐", ".css": "🎨", ".scss": "🎨",
      ".json": "📋", ".yaml": "📋", ".yml": "📋", ".toml": "📋",
      ".md": "📝", ".txt": "📄",
      ".sql": "🗃️", ".prisma": "🔷",
      ".png": "🖼️", ".jpg": "🖼️", ".svg": "🖼️", ".gif": "🖼️",
      ".env": "🔐", ".lock": "🔒",
    };
    return iconMap[ext] || "📄";
  }
})();
