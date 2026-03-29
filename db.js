const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const LEGACY_DATA_FILE = path.join(ROOT, "graph-data.json");
const STORAGE_HOME = process.env.GRAPH_MEMORY_HOME || path.join(os.homedir(), ".graph-memory");
const DB_PATH = process.env.GRAPH_MEMORY_DB_PATH || path.join(STORAGE_HOME, "graph.db");
const EXPORTS_DIR = path.join(STORAGE_HOME, "exports");
const BACKUPS_DIR = path.join(STORAGE_HOME, "backups");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`);
initialize();

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL,
      open_issues INTEGER NOT NULL DEFAULT 0,
      files_json TEXT NOT NULL DEFAULT '[]',
      relations_json TEXT NOT NULL DEFAULT '[]',
      context_window_json TEXT NOT NULL DEFAULT '[]',
      debug_signals_json TEXT NOT NULL DEFAULT '[]',
      chat_history_json TEXT NOT NULL DEFAULT '[]',
      notes_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      workspace_path TEXT NOT NULL,
      tool_source TEXT NOT NULL,
      command_text TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      current_file TEXT,
      latest_error TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      project_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      file_path TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
  `);

  const tableInfo = db.prepare("PRAGMA table_info(nodes)").all();
  if (!tableInfo.some((col) => col.name === "parent_id")) {
    db.exec("ALTER TABLE nodes ADD COLUMN parent_id TEXT");
  }

  try {
    if (getMeta("schemaVersion") !== "1") {
      setMeta("schemaVersion", "1");
    }
    migrateFromLegacyJsonIfNeeded();
  } catch (error) {
    if (!isSqliteBusyError(error)) {
      throw error;
    }
  }
}

function migrateFromLegacyJsonIfNeeded() {
  const hasNodes = db.prepare("SELECT COUNT(*) AS count FROM nodes").get().count > 0;

  if (hasNodes || !fs.existsSync(LEGACY_DATA_FILE)) {
    return;
  }

  const legacy = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, "utf8"));
  const insert = db.prepare(`
    INSERT INTO nodes (
      id, parent_id, name, type, summary, severity, open_issues,
      files_json, relations_json, context_window_json, debug_signals_json,
      chat_history_json, notes_json, sort_order, created_at, updated_at
    ) VALUES (
      @id, @parentId, @name, @type, @summary, @severity, @openIssues,
      @filesJson, @relationsJson, @contextWindowJson, @debugSignalsJson,
      @chatHistoryJson, @notesJson, @sortOrder, @createdAt, @updatedAt
    )
  `);

  const now = nowIso();
  db.exec("BEGIN");
  try {
    legacy.nodes.forEach((node, index) => {
      insert.run(toRow(node, index, now));
    });
    if (legacy.activeNodeId) {
      setMeta("activeNodeId", legacy.activeNodeId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getGraph() {
  return {
    activeNodeId: getMeta("activeNodeId"),
    nodes: listNodes(),
  };
}

function getNode(nodeId) {
  const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(nodeId);
  return row ? fromRow(row) : null;
}

function listNodes() {
  return db
    .prepare("SELECT * FROM nodes ORDER BY sort_order ASC, updated_at DESC")
    .all()
    .map(fromRow);
}

function searchNodes(query) {
  const normalized = (query || "").trim().toLowerCase();
  const nodes = listNodes();
  return normalized ? nodes.filter((node) => matchesQuery(node, normalized)) : nodes;
}

function traceNodes({ file, location, query }) {
  const normalizedFile = (file || "").trim().toLowerCase();
  const normalizedLocation = (location || "").trim().toLowerCase();
  const normalizedQuery = (query || "").trim().toLowerCase();

  return listNodes().filter((node) => {
    const fileMatch = normalizedFile
      ? node.files.some((entry) => entry.toLowerCase().includes(normalizedFile))
      : false;
    const locationMatch = normalizedLocation
      ? node.debugSignals.some((signal) => signal.location.toLowerCase().includes(normalizedLocation))
      : false;
    const queryMatch = normalizedQuery ? matchesQuery(node, normalizedQuery) : false;
    return fileMatch || locationMatch || queryMatch;
  });
}

function setActiveNode(nodeId) {
  const node = getNode(nodeId);
  if (!node) {
    return null;
  }

  setMeta("activeNodeId", nodeId);
  return getGraph();
}

function createNode(payload) {
  const file = Array.isArray(payload.files) ? payload.files[0] : payload.file;
  if (!file || typeof file !== "string") {
    throw new Error("file hoac files[0] la bat buoc.");
  }

  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : deriveNodeName(file || payload.summary || "Untitled Node");
  const id =
    typeof payload.id === "string" && payload.id.trim()
      ? sanitizeId(payload.id)
      : sanitizeId(name);

  const existing = getNode(id);
  if (existing) {
    return existing;
  }

  const providedParentId = typeof payload.parentId === "string" ? payload.parentId.trim() : null;
  const parentId = providedParentId || autoLinkUnderParent(file, id) || null;

  const node = {
    id,
    parentId,
    name,
    type: typeof payload.type === "string" && payload.type.trim() ? payload.type.trim() : "workspace",
    summary:
      typeof payload.summary === "string" && payload.summary.trim()
        ? payload.summary.trim()
        : `Auto-created node for ${file}.`,
    severity:
      typeof payload.severity === "string" && payload.severity.trim()
        ? payload.severity.trim()
        : "medium",
    files: uniqueStrings(Array.isArray(payload.files) ? payload.files : [file]),
    relations: uniqueStrings(Array.isArray(payload.relations) ? payload.relations : []),
    contextWindow: Array.isArray(payload.contextWindow) ? payload.contextWindow : [],
    debugSignals: Array.isArray(payload.debugSignals) ? payload.debugSignals : [],
    chatHistory: Array.isArray(payload.chatHistory) ? payload.chatHistory : [],
    notes: Array.isArray(payload.notes) ? payload.notes : [`Auto-created from editor trace for ${file}.`],
    openIssues: Number(payload.openIssues || 0),
  };

  insertNode(node);
  setMeta("activeNodeId", node.id);
  return getNode(node.id);
}

function upsertNodeFromTrace(payload) {
  const file = typeof payload.file === "string" ? payload.file.trim() : "";
  const location = typeof payload.location === "string" ? payload.location.trim() : "";
  const symptom = typeof payload.symptom === "string" ? payload.symptom.trim() : "";

  if (!file) {
    throw new Error("file la bat buoc.");
  }

  let node = listNodes().find((entry) =>
    entry.files.some((item) => item.toLowerCase() === file.toLowerCase())
  );

  if (!node) {
    const id = sanitizeId(deriveNodeName(file));
    const parentId = typeof payload.parentId === "string" ? payload.parentId.trim() : autoLinkUnderParent(file, id);

    node = {
      id,
      parentId,
      name: deriveNodeName(file),
      type: typeof payload.type === "string" && payload.type.trim() ? payload.type.trim() : "workspace",
      summary:
        typeof payload.summary === "string" && payload.summary.trim()
          ? payload.summary.trim()
          : `Auto-created node for ${file}.`,
      severity:
        typeof payload.severity === "string" && payload.severity.trim()
          ? payload.severity.trim()
          : "medium",
      files: [file],
      relations: [],
      contextWindow: [
        {
          label: "Auto trace",
          detail: `Node duoc tao tu editor trace cho ${file}.`,
        },
      ],
      debugSignals: [],
      chatHistory: [],
      notes: [`Auto-created from trace at ${formatTime()}.`],
      openIssues: 0,
    };
    insertNode(node);
    node = getNode(node.id);
  }

  if (location && symptom) {
    const alreadyExists = node.debugSignals.some(
      (signal) =>
        signal.location.toLowerCase() === location.toLowerCase() &&
        signal.symptom.toLowerCase() === symptom.toLowerCase()
    );

    if (!alreadyExists) {
      node.debugSignals.unshift({
        title:
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim()
            : "Captured Diagnostic",
        location,
        symptom,
      });
      node.openIssues = Number(node.openIssues || 0) + 1;
      updateNode(node);
    }
  }

  setMeta("activeNodeId", node.id);
  return getNode(node.id);
}

function addNote(nodeId, note, role = "assistant") {
  const node = getNode(nodeId);
  if (!node) {
    return null;
  }

  node.notes.unshift(note.trim());
  node.chatHistory.unshift({
    role: role === "user" ? "user" : "assistant",
    timestamp: formatTime(),
    message: `Captured note: ${note.trim()}`,
  });
  updateNode(node);
  setMeta("activeNodeId", node.id);
  return getGraph();
}

function addChat(nodeId, message, role = "user") {
  const node = getNode(nodeId);
  if (!node) {
    return null;
  }

  node.chatHistory.unshift({
    role: role === "assistant" ? "assistant" : "user",
    timestamp: formatTime(),
    message: message.trim(),
  });
  updateNode(node);
  setMeta("activeNodeId", node.id);
  return getGraph();
}

function addDebugSignal(nodeId, signal) {
  const node = getNode(nodeId);
  if (!node) {
    return null;
  }

  node.debugSignals.unshift({
    title: signal.title.trim(),
    location: signal.location.trim(),
    symptom: signal.symptom.trim(),
  });
  node.openIssues = Number(node.openIssues || 0) + 1;
  updateNode(node);
  setMeta("activeNodeId", node.id);
  return getGraph();
}

function recordEdit(payload) {
  const file = typeof payload.file === "string" ? payload.file.trim() : "";
  if (!file) {
    throw new Error("file la bat buoc.");
  }

  const projectId =
    typeof payload.projectId === "string" && payload.projectId.trim()
      ? payload.projectId.trim()
      : autoLinkUnderParent(file);
  const fileNode = ensureFileNode(file, projectId);
  const editId = `edit-${sanitizeId(`${file}-${nowIso()}`)}`;

  insertNode({
    id: editId,
    parentId: fileNode.id,
    name: payload.name || deriveNodeName(file),
    type: "edit",
    summary: payload.summary || `Edit recorded for ${file}.`,
    severity: payload.severity || "low",
    files: [file],
    relations: uniqueStrings([fileNode.id, ...(projectId ? [projectId] : [])]),
    contextWindow: [
      {
        label: "Edited file",
        detail: file,
      },
      {
        label: "Tool source",
        detail: payload.toolSource || "manual",
      },
    ],
    debugSignals: [],
    chatHistory: [],
    notes: [payload.note || payload.summary || `Edit captured at ${formatTime()}`],
    openIssues: 0,
  });

  setMeta("activeNodeId", editId);
  return getNode(editId);
}

function recordError(payload) {
  const file = typeof payload.file === "string" ? payload.file.trim() : "";
  const location = typeof payload.location === "string" ? payload.location.trim() : "";
  const symptom = typeof payload.symptom === "string" ? payload.symptom.trim() : "";

  if (!file || !location || !symptom) {
    throw new Error("file, location va symptom la bat buoc.");
  }

  const projectId =
    typeof payload.projectId === "string" && payload.projectId.trim()
      ? payload.projectId.trim()
      : autoLinkUnderParent(file);
  const fileNode = ensureFileNode(file, projectId);
  const errorId = `error-${sanitizeId(`${location}-${nowIso()}`)}`;

  insertNode({
    id: errorId,
    parentId: fileNode.id,
    name: payload.name || payload.title || "Captured Error",
    type: "error",
    summary: payload.summary || symptom,
    severity: payload.severity || "high",
    files: [file],
    relations: uniqueStrings([fileNode.id, ...(projectId ? [projectId] : [])]),
    contextWindow: [
      {
        label: "Error location",
        detail: location,
      },
      {
        label: "Tool source",
        detail: payload.toolSource || "manual",
      },
    ],
    debugSignals: [
      {
        title: payload.title || "Captured Error",
        location,
        symptom,
      },
    ],
    chatHistory: [],
    notes: [payload.note || `Error captured at ${formatTime()}`],
    openIssues: 1,
  });

  setMeta("activeNodeId", errorId);
  return getNode(errorId);
}

function ensureFileNode(file, projectId = null) {
  const fileNodeId = `file-${sanitizeId(file)}`;
  let fileNode = getNode(fileNodeId);

  if (!fileNode) {
    insertNode({
      id: fileNodeId,
      parentId: projectId || autoLinkUnderParent(file),
      name: path.basename(file),
      type: "file",
      summary: `Tracked file node for ${file}.`,
      severity: "low",
      files: [file],
      relations: uniqueStrings(projectId ? [projectId] : []),
      contextWindow: [
        {
          label: "File path",
          detail: file,
        },
      ],
      debugSignals: [],
      chatHistory: [],
      notes: [],
      openIssues: 0,
    });
    fileNode = getNode(fileNodeId);
  }

  return fileNode;
}

function getContextGraph(nodeId) {
  const focal = getNode(nodeId);
  if (!focal) {
    return null;
  }

  const allNodes = listNodes();
  const contextNodes = [];
  const edges = [];
  const seen = new Set();

  addNode(contextNodes, seen, focal, "focus");

  const ancestors = getAncestorChain(allNodes, focal);
  ancestors.forEach((ancestor, index) => {
    addNode(contextNodes, seen, ancestor, index === 0 ? "parent" : "ancestor");
  });
  ancestors.forEach((ancestor, index) => {
    const childId = index === 0 ? focal.id : ancestors[index - 1].id;
    edges.push({ source: ancestor.id, target: childId, type: "parent" });
  });

  const children = allNodes
    .filter((node) => node.parentId === focal.id)
    .sort(sortNodesForContext)
    .slice(0, 8);
  children.forEach((child) => {
    const edgeType = child.type === "file" || child.type === "error" || child.type === "edit" ? child.type : "child";
    addNode(contextNodes, seen, child, edgeType === "child" ? "child" : edgeType);
    edges.push({ source: focal.id, target: child.id, type: edgeType });
  });

  allNodes
    .filter((node) => node.id !== focal.id && (focal.relations.includes(node.id) || node.relations.includes(focal.id)))
    .sort(sortNodesForContext)
    .slice(0, 8)
    .forEach((related) => {
      addNode(contextNodes, seen, related, "related");
      edges.push({ source: focal.id, target: related.id, type: "related" });
    });

  const fileNodes = resolveContextFileNodes(focal, allNodes);
  const fileAnchors = fileNodes.length ? fileNodes : [];
  fileAnchors.forEach((fileNode) => {
    const role = fileNode.id === focal.id ? "focus" : "file";
    addNode(contextNodes, seen, fileNode, role);
    if (fileNode.id !== focal.id) {
      edges.push({ source: focal.id, target: fileNode.id, type: "file" });
    }

    const descendants = allNodes
      .filter((node) => {
        if (node.id === focal.id) {
          return false;
        }
        if (node.type !== "error" && node.type !== "edit") {
          return false;
        }
        return node.parentId === fileNode.id || sharesFiles(node.files, fileNode.files);
      })
      .sort(sortNodesForContext)
      .slice(0, 10);

    descendants.forEach((descendant) => {
      addNode(contextNodes, seen, descendant, descendant.type);
      edges.push({ source: fileNode.id, target: descendant.id, type: descendant.type });
    });
  });

  const representedErrors = new Set(
    contextNodes
      .filter((node) => node.type === "error")
      .flatMap((node) => node.debugSignals || [])
      .map((signal) => `${signal.location || ""}::${signal.symptom || ""}`.toLowerCase())
  );

  focal.debugSignals.slice(0, 6).forEach((signal, index) => {
    const signature = `${signal.location || ""}::${signal.symptom || ""}`.toLowerCase();
    if (representedErrors.has(signature)) {
      return;
    }

    const anchor = matchFileAnchorForSignal(fileAnchors, signal) || fileAnchors[index % Math.max(fileAnchors.length, 1)];
    const syntheticId = `synthetic-error-${sanitizeId(`${focal.id}-${signal.location}-${index}`)}`;
    addNode(
      contextNodes,
      seen,
      {
        id: syntheticId,
        name: signal.title,
        type: "error",
        summary: signal.symptom,
        severity: "high",
        files: focal.files,
        relations: [focal.id],
        contextWindow: [{ label: "Location", detail: signal.location }],
        debugSignals: [signal],
        chatHistory: [],
        notes: [],
        openIssues: 1,
        selectNodeId: focal.id,
      },
      "error"
    );
    edges.push({ source: anchor?.id || focal.id, target: syntheticId, type: "error" });
  });

  return {
    focalNodeId: focal.id,
    nodes: sortContextNodes(contextNodes),
    edges: uniqueEdges(edges),
    metrics: buildContextMetrics(contextNodes),
  };
}

function startActivity(payload) {
  const workspacePath = normalizeWorkspacePath(payload.workspacePath);
  if (!workspacePath) {
    throw new Error("workspacePath la bat buoc.");
  }

  const toolSource = normalizeToolSource(payload.toolSource);
  const projectNode = ensureProjectNodeForWorkspace(workspacePath, payload);
  const now = nowIso();
  const runId =
    typeof payload.runId === "string" && payload.runId.trim()
      ? payload.runId.trim()
      : `run-${sanitizeId(`${toolSource}-${workspacePath}-${now}`)}`;

  const existing = getActivityRun(runId);
  if (existing) {
    return existing;
  }

  const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
  const currentFile = normalizeOptionalPath(payload.currentFile || payload.file);
  const latestError = normalizeOptionalText(payload.latestError || payload.error);
  const metadata = typeof payload.metadata === "object" && payload.metadata ? payload.metadata : {};

  db.prepare(`
    INSERT INTO activity_runs (
      id, project_id, workspace_path, tool_source, command_text, status, summary,
      current_file, latest_error, metadata_json, started_at, last_heartbeat_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    projectNode?.id || null,
    workspacePath,
    toolSource,
    normalizeOptionalText(payload.commandText || payload.command),
    "running",
    summary,
    currentFile,
    latestError,
    JSON.stringify(metadata),
    now,
    now,
    null
  );

  insertActivityEvent(runId, projectNode?.id || null, "start", summary || `Started ${toolSource} session`, currentFile, {
    commandText: normalizeOptionalText(payload.commandText || payload.command),
    latestError,
    metadata,
  });

  if (projectNode) {
    setMeta("activeNodeId", projectNode.id);
  }

  return getActivityRun(runId);
}

function heartbeatActivity(runId, payload = {}) {
  const run = getActivityRun(runId);
  if (!run) {
    return null;
  }

  const now = nowIso();
  const summary = typeof payload.summary === "string" && payload.summary.trim() ? payload.summary.trim() : run.summary;
  const currentFile = normalizeOptionalPath(payload.currentFile || payload.file) || run.currentFile;
  const latestError = normalizeOptionalText(payload.latestError || payload.error) || run.latestError;
  const metadata = mergeMetadata(run.metadata, payload.metadata);
  const status = run.status === "running" ? "running" : normalizeActivityStatus(run.status);

  db.prepare(`
    UPDATE activity_runs
    SET
      summary = ?,
      current_file = ?,
      latest_error = ?,
      metadata_json = ?,
      last_heartbeat_at = ?,
      status = ?
    WHERE id = ?
  `).run(
    summary,
    currentFile,
    latestError,
    JSON.stringify(metadata),
    now,
    status,
    runId
  );

  const message =
    normalizeOptionalText(payload.message) ||
    normalizeOptionalText(payload.summary) ||
    normalizeOptionalText(payload.error) ||
    normalizeOptionalText(payload.file || payload.currentFile);

  if (message) {
    insertActivityEvent(runId, run.projectId, payload.kind || "heartbeat", message, currentFile, payload);
  }

  return getActivityRun(runId);
}

function finishActivity(runId, payload = {}) {
  const run = getActivityRun(runId);
  if (!run) {
    return null;
  }

  const now = nowIso();
  const summary = typeof payload.summary === "string" && payload.summary.trim() ? payload.summary.trim() : run.summary;
  const currentFile = normalizeOptionalPath(payload.currentFile || payload.file) || run.currentFile;
  const latestError = normalizeOptionalText(payload.latestError || payload.error) || run.latestError;
  const metadata = mergeMetadata(run.metadata, payload.metadata);
  const status = normalizeActivityStatus(payload.status || (latestError ? "failed" : "completed"));

  db.prepare(`
    UPDATE activity_runs
    SET
      summary = ?,
      current_file = ?,
      latest_error = ?,
      metadata_json = ?,
      last_heartbeat_at = ?,
      status = ?,
      ended_at = ?
    WHERE id = ?
  `).run(
    summary,
    currentFile,
    latestError,
    JSON.stringify(metadata),
    now,
    status,
    now,
    runId
  );

  insertActivityEvent(
    runId,
    run.projectId,
    "finish",
    summary || `Session ${status}`,
    currentFile,
    {
      ...payload,
      status,
      latestError,
    }
  );

  const touchedFiles = Array.isArray(payload.touchedFiles)
    ? uniqueStrings(payload.touchedFiles.map(normalizeOptionalPath).filter(Boolean))
    : [];

  touchedFiles.forEach((filePath) => {
    recordEdit({
      projectId: run.projectId || autoLinkUnderParent(filePath),
      file: filePath,
      toolSource: run.toolSource,
      summary: summary || `Activity run ${runId} touched ${filePath}.`,
      note: `Captured from activity run ${runId} (${status}).`,
      severity: status === "failed" ? "medium" : "low",
      name: path.basename(filePath),
    });
  });

  if (status === "failed" && currentFile && payload.location && latestError) {
    recordError({
      projectId: run.projectId || autoLinkUnderParent(currentFile),
      file: currentFile,
      location: payload.location,
      symptom: latestError,
      title: payload.title || "Activity Failure",
      toolSource: run.toolSource,
      summary: summary || latestError,
      note: `Captured from activity run ${runId}.`,
      severity: "high",
      name: payload.title || "Activity Failure",
    });
  }

  if (run.projectId) {
    setMeta("activeNodeId", run.projectId);
  }

  return getActivityRun(runId);
}

function getActivityRun(runId) {
  const row = db.prepare("SELECT * FROM activity_runs WHERE id = ?").get(runId);
  return row ? fromActivityRunRow(row) : null;
}

function listActivityRuns(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.status) {
    conditions.push("status = ?");
    values.push(normalizeActivityStatus(filters.status));
  }

  if (filters.projectId) {
    conditions.push("project_id = ?");
    values.push(filters.projectId);
  }

  if (filters.workspacePath) {
    conditions.push("workspace_path = ?");
    values.push(normalizeWorkspacePath(filters.workspacePath));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(Number(filters.limit || 20), 100));
  const rows = db
    .prepare(`
      SELECT *
      FROM activity_runs
      ${whereClause}
      ORDER BY
        CASE WHEN status = 'running' THEN 0 ELSE 1 END,
        COALESCE(ended_at, last_heartbeat_at, started_at) DESC
      LIMIT ${limit}
    `)
    .all(...values);

  return rows.map(fromActivityRunRow);
}

function getActivityOverview() {
  const running = listActivityRuns({ status: "running", limit: 8 });
  const recent = listActivityRuns({ limit: 12 }).slice(0, 12);
  const recentEvents = db
    .prepare(`
      SELECT *
      FROM activity_events
      ORDER BY created_at DESC
      LIMIT 16
    `)
    .all()
    .map(fromActivityEventRow);

  const projectStats = db
    .prepare(`
      SELECT
        project_id,
        workspace_path,
        COUNT(*) AS run_count,
        MAX(COALESCE(ended_at, last_heartbeat_at, started_at)) AS last_used_at,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count
      FROM activity_runs
      GROUP BY project_id, workspace_path
      ORDER BY last_used_at DESC
      LIMIT 10
    `)
    .all()
    .map((row) => {
      const projectNode = row.project_id ? getNode(row.project_id) : null;
      return {
        projectId: row.project_id || null,
        projectName: projectNode?.name || path.basename(row.workspace_path),
        workspacePath: row.workspace_path,
        runCount: Number(row.run_count || 0),
        runningCount: Number(row.running_count || 0),
        lastUsedAt: row.last_used_at,
      };
    });

  return {
    runningCount: running.length,
    running,
    recent,
    recentEvents,
    projects: projectStats,
  };
}

function getStorageInfo() {
  return {
    storageHome: STORAGE_HOME,
    dbPath: DB_PATH,
    exportsDir: EXPORTS_DIR,
    backupsDir: BACKUPS_DIR,
    legacyDataFile: LEGACY_DATA_FILE,
    activeNodeId: getMeta("activeNodeId"),
    nodeCount: db.prepare("SELECT COUNT(*) AS count FROM nodes").get().count,
    runningActivityCount: db.prepare("SELECT COUNT(*) AS count FROM activity_runs WHERE status = 'running'").get().count,
    recentExports: listRecentFiles(EXPORTS_DIR, ".json"),
    recentBackups: listRecentFiles(BACKUPS_DIR, ".db"),
  };
}

function exportGraph(targetPath) {
  const exportPath = targetPath || path.join(EXPORTS_DIR, `graph-export-${timestampForFile()}.json`);
  ensureParentDir(exportPath);
  const payload = {
    exportedAt: nowIso(),
    storage: getStorageInfo(),
    graph: getGraph(),
  };
  fs.writeFileSync(exportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    exportPath,
    nodeCount: payload.graph.nodes.length,
    activeNodeId: payload.graph.activeNodeId,
  };
}

function backupDatabase(targetPath) {
  const backupPath = targetPath || path.join(BACKUPS_DIR, `graph-backup-${timestampForFile()}.db`);
  ensureParentDir(backupPath);
  fs.copyFileSync(DB_PATH, backupPath);
  return {
    backupPath,
    dbPath: DB_PATH,
    sizeBytes: fs.statSync(backupPath).size,
  };
}

function importGraph(sourcePath, mode = "replace") {
  if (!sourcePath || typeof sourcePath !== "string") {
    throw new Error("sourcePath la bat buoc.");
  }

  const importPath = path.resolve(sourcePath);
  if (!fs.existsSync(importPath)) {
    throw new Error(`Khong tim thay file import: ${importPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(importPath, "utf8"));
  const graph = raw.graph && Array.isArray(raw.graph.nodes)
    ? raw.graph
    : raw.nodes && Array.isArray(raw.nodes)
      ? { activeNodeId: raw.activeNodeId || null, nodes: raw.nodes }
      : null;

  if (!graph) {
    throw new Error("File import khong dung dinh dang Graph Memory.");
  }

  const normalizedMode = mode === "merge" ? "merge" : "replace";
  db.exec("BEGIN");
  try {
    if (normalizedMode === "replace") {
      db.prepare("DELETE FROM nodes").run();
    }

    graph.nodes.forEach((node, index) => {
      const existing = getNode(node.id);
      if (existing) {
        updateNode({
          ...existing,
          ...node,
          parentId: node.parentId !== undefined ? node.parentId : existing.parentId,
          files: uniqueStrings(node.files || existing.files || []),
          relations: uniqueStrings(node.relations || existing.relations || []),
          contextWindow: Array.isArray(node.contextWindow) ? node.contextWindow : existing.contextWindow,
          debugSignals: Array.isArray(node.debugSignals) ? node.debugSignals : existing.debugSignals,
          chatHistory: Array.isArray(node.chatHistory) ? node.chatHistory : existing.chatHistory,
          notes: Array.isArray(node.notes) ? node.notes : existing.notes,
          openIssues: Number(node.openIssues ?? existing.openIssues ?? 0),
        });
      } else {
        insertNode({
          id: node.id,
          parentId: node.parentId || null,
          name: node.name,
          type: node.type || "workspace",
          summary: node.summary || `Imported node ${node.id}`,
          severity: node.severity || "medium",
          files: uniqueStrings(node.files || []),
          relations: uniqueStrings(node.relations || []),
          contextWindow: Array.isArray(node.contextWindow) ? node.contextWindow : [],
          debugSignals: Array.isArray(node.debugSignals) ? node.debugSignals : [],
          chatHistory: Array.isArray(node.chatHistory) ? node.chatHistory : [],
          notes: Array.isArray(node.notes) ? node.notes : [],
          openIssues: Number(node.openIssues || 0),
        }, index);
      }
    });

    if (graph.activeNodeId) {
      setMeta("activeNodeId", graph.activeNodeId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    importPath,
    mode: normalizedMode,
    nodeCount: getStorageInfo().nodeCount,
    activeNodeId: getMeta("activeNodeId"),
  };
}

function mergeCrawledNodes(nodes, rootPath) {
  if (!Array.isArray(nodes) || !nodes.length) {
    return {
      rootPath,
      added: 0,
      updated: 0,
      total: getStorageInfo().nodeCount,
    };
  }

  let added = 0;
  let updated = 0;

  db.exec("BEGIN");
  try {
    nodes.forEach((node, index) => {
      const existing = getNode(node.id);
      if (existing) {
        updateNode({
          ...existing,
          parentId: node.parentId !== undefined ? node.parentId : existing.parentId,
          name: node.name,
          type: node.type,
          summary: node.summary,
          severity: node.severity,
          files: uniqueStrings([...(existing.files || []), ...(node.files || [])]),
          relations: uniqueStrings([...(existing.relations || []), ...(node.relations || [])]),
          contextWindow: Array.isArray(node.contextWindow) ? node.contextWindow : existing.contextWindow,
          notes: uniqueStrings([...(node.notes || []), ...(existing.notes || [])]),
          openIssues: Number(existing.openIssues || 0),
          debugSignals: existing.debugSignals || [],
          chatHistory: existing.chatHistory || [],
        });
        updated += 1;
      } else {
        insertNode(node, index);
        added += 1;
      }
    });
    repairGraphTopologyInTransaction();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    rootPath,
    added,
    updated,
    total: getStorageInfo().nodeCount,
  };
}

function repairGraphTopology() {
  db.exec("BEGIN");
  try {
    const result = repairGraphTopologyInTransaction();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function repairGraphTopologyInTransaction() {
  const nodes = listNodes().map((node) => ({
    ...node,
    files: uniqueStrings(node.files || []),
    relations: uniqueStrings(node.relations || []),
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let updated = 0;

  nodes.forEach((node) => {
    const nextParentId = inferParentIdForNode(node, nodes);
    if (nextParentId && nextParentId !== node.id) {
      node.parentId = nextParentId;
    }
  });

  nodes.forEach((node) => {
    if (node.parentId && nodesById.has(node.parentId) && node.parentId !== node.id) {
      const parentNode = nodesById.get(node.parentId);
      node.relations = uniqueStrings([...(node.relations || []), parentNode.id]);
      parentNode.relations = uniqueStrings([...(parentNode.relations || []), node.id]);
    }

    if (["error", "edit"].includes(node.type)) {
      const fileParent = findBestFileParent(node, nodes);
      if (fileParent) {
        node.parentId = fileParent.id;
        node.relations = uniqueStrings([...(node.relations || []), fileParent.id]);
        fileParent.relations = uniqueStrings([...(fileParent.relations || []), node.id]);
      }
    }

    if (node.type === "file") {
      const projectParent = findBestProjectParent(node, nodes);
      if (projectParent) {
        node.parentId = projectParent.id;
        node.relations = uniqueStrings([...(node.relations || []), projectParent.id]);
        projectParent.relations = uniqueStrings([...(projectParent.relations || []), node.id]);
      }
    }
  });

  nodes.forEach((node) => {
    const current = getNode(node.id);
    const normalizedRelations = uniqueStrings(
      (node.relations || []).filter((relationId) => relationId !== node.id && nodesById.has(relationId))
    );
    const parentId = node.parentId && node.parentId !== node.id && nodesById.has(node.parentId) ? node.parentId : null;
    const shouldUpdate =
      (current.parentId || null) !== parentId ||
      JSON.stringify(current.relations || []) !== JSON.stringify(normalizedRelations);

    if (shouldUpdate) {
      updateNode({
        ...current,
        parentId,
        relations: normalizedRelations,
      });
      updated += 1;
    }
  });

  return {
    updated,
    total: nodes.length,
  };
}

function restoreLatestBackup() {
  const latest = listRecentFiles(BACKUPS_DIR, ".db")[0];

  if (!latest) {
    throw new Error("Khong tim thay backup nao de restore.");
  }

  const backupDb = new DatabaseSync(latest.path);
  const metaRows = backupDb.prepare("SELECT key, value FROM meta").all();
  const nodeRows = backupDb.prepare("SELECT * FROM nodes ORDER BY sort_order ASC, updated_at DESC").all();

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM nodes").run();
    db.prepare("DELETE FROM meta").run();

    const insert = db.prepare(`
      INSERT INTO nodes (
        id, parent_id, name, type, summary, severity, open_issues,
        files_json, relations_json, context_window_json, debug_signals_json,
        chat_history_json, notes_json, sort_order, created_at, updated_at
      ) VALUES (
        @id, @parent_id, @name, @type, @summary, @severity, @open_issues,
        @files_json, @relations_json, @context_window_json, @debug_signals_json,
        @chat_history_json, @notes_json, @sort_order, @created_at, @updated_at
      )
    `);

    metaRows.forEach((row) => {
      db.prepare(`
        INSERT INTO meta(key, value)
        VALUES(?, ?)
      `).run(row.key, row.value);
    });

    nodeRows.forEach((row) => {
      row.parent_id = row.parent_id || null;
      insert.run(row);
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    backupDb.close();
  }

  return {
    restoredFrom: latest.path,
    restoredAt: nowIso(),
    nodeCount: getStorageInfo().nodeCount,
    activeNodeId: getMeta("activeNodeId"),
  };
}

function openStorageFolder(kind) {
  const folderPath =
    kind === "backups"
      ? BACKUPS_DIR
      : kind === "exports"
        ? EXPORTS_DIR
        : STORAGE_HOME;

  if (!fs.existsSync(folderPath)) {
    throw new Error(`Khong tim thay thu muc: ${folderPath}`);
  }

  spawn("explorer.exe", [folderPath], {
    detached: true,
    stdio: "ignore",
  }).unref();

  return {
    kind: kind || "storage",
    openedPath: folderPath,
  };
}

function insertNode(node, preferredSortOrder = null) {
  const now = nowIso();
  const sortOrderRow = db.prepare("SELECT MIN(sort_order) AS minSort FROM nodes").get();
  const nextSortOrder = preferredSortOrder ?? (sortOrderRow.minSort === null ? 0 : Number(sortOrderRow.minSort) - 1);

  db.prepare(`
    INSERT INTO nodes (
      id, parent_id, name, type, summary, severity, open_issues,
      files_json, relations_json, context_window_json, debug_signals_json,
      chat_history_json, notes_json, sort_order, created_at, updated_at
    ) VALUES (
      @id, @parentId, @name, @type, @summary, @severity, @openIssues,
      @filesJson, @relationsJson, @contextWindowJson, @debugSignalsJson,
      @chatHistoryJson, @notesJson, @sortOrder, @createdAt, @updatedAt
    )
  `).run(toRow(node, nextSortOrder, now));
}

function updateNode(node) {
  const updatedAt = nowIso();
  db.prepare(`
    UPDATE nodes
    SET
      parent_id = @parentId,
      name = @name,
      type = @type,
      summary = @summary,
      severity = @severity,
      open_issues = @openIssues,
      files_json = @filesJson,
      relations_json = @relationsJson,
      context_window_json = @contextWindowJson,
      debug_signals_json = @debugSignalsJson,
      chat_history_json = @chatHistoryJson,
      notes_json = @notesJson,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: node.id,
    parentId: node.parentId || null,
    name: node.name,
    type: node.type,
    summary: node.summary,
    severity: node.severity,
    openIssues: Number(node.openIssues || 0),
    filesJson: JSON.stringify(node.files || []),
    relationsJson: JSON.stringify(node.relations || []),
    contextWindowJson: JSON.stringify(node.contextWindow || []),
    debugSignalsJson: JSON.stringify(node.debugSignals || []),
    chatHistoryJson: JSON.stringify(node.chatHistory || []),
    notesJson: JSON.stringify(node.notes || []),
    updatedAt,
  });
}

function inferParentIdForNode(node, allNodes) {
  if (node.type === "file") {
    return findBestProjectParent(node, allNodes)?.id || null;
  }

  if (node.type === "error" || node.type === "edit") {
    return findBestFileParent(node, allNodes)?.id || findBestProjectParent(node, allNodes)?.id || null;
  }

  if (node.parentId && allNodes.some((entry) => entry.id === node.parentId && entry.id !== node.id)) {
    return node.parentId;
  }

  if (node.type === "project" || node.type === "workspace") {
    return findBestProjectParent(node, allNodes)?.id || null;
  }

  return findBestProjectParent(node, allNodes)?.id || null;
}

function findBestProjectParent(node, allNodes) {
  const nodePaths = uniqueStrings(node.files || []).map(normalizeWorkspacePath).filter(Boolean);
  if (!nodePaths.length) {
    return null;
  }

  return allNodes
    .filter((candidate) => {
      if (candidate.id === node.id) return false;
      if (!["project", "workspace"].includes(candidate.type)) return false;
      const candidatePaths = uniqueStrings(candidate.files || []).map(normalizeWorkspacePath).filter(Boolean);
      return candidatePaths.some((candidatePath) =>
        nodePaths.some(
          (nodePath) =>
            nodePath.toLowerCase().startsWith(`${candidatePath.toLowerCase()}${path.sep.toLowerCase()}`) &&
            nodePath.toLowerCase() !== candidatePath.toLowerCase()
        )
      );
    })
    .sort((left, right) => longestSharedPrefix((right.files || [])[0], nodePaths[0]) - longestSharedPrefix((left.files || [])[0], nodePaths[0]))[0] || null;
}

function findBestFileParent(node, allNodes) {
  const nodeFiles = uniqueStrings(node.files || []).map(normalizeWorkspacePath).filter(Boolean);
  if (!nodeFiles.length) {
    return null;
  }

  return allNodes
    .filter((candidate) => {
      if (candidate.id === node.id || candidate.type !== "file") return false;
      const candidateFiles = uniqueStrings(candidate.files || []).map(normalizeWorkspacePath).filter(Boolean);
      return candidateFiles.some((candidateFile) =>
        nodeFiles.some((nodeFile) => nodeFile.toLowerCase() === candidateFile.toLowerCase())
      );
    })
    .sort((left, right) => ((right.files || [])[0] || "").length - ((left.files || [])[0] || "").length)[0] || null;
}

function longestSharedPrefix(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  let index = 0;
  while (index < leftValue.length && index < rightValue.length && leftValue[index].toLowerCase() === rightValue[index].toLowerCase()) {
    index += 1;
  }
  return index;
}

function toRow(node, sortOrder, timestamp) {
  return {
    id: node.id,
    parentId: node.parentId || null,
    name: node.name,
    type: node.type,
    summary: node.summary,
    severity: node.severity,
    openIssues: Number(node.openIssues || 0),
    filesJson: JSON.stringify(node.files || []),
    relationsJson: JSON.stringify(node.relations || []),
    contextWindowJson: JSON.stringify(node.contextWindow || []),
    debugSignalsJson: JSON.stringify(node.debugSignals || []),
    chatHistoryJson: JSON.stringify(node.chatHistory || []),
    notesJson: JSON.stringify(node.notes || []),
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    type: row.type,
    summary: row.summary,
    severity: row.severity,
    files: parseJsonArray(row.files_json),
    relations: parseJsonArray(row.relations_json),
    contextWindow: parseJsonArray(row.context_window_json),
    debugSignals: parseJsonArray(row.debug_signals_json),
    chatHistory: parseJsonArray(row.chat_history_json),
    notes: parseJsonArray(row.notes_json),
    openIssues: Number(row.open_issues || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromActivityRunRow(row) {
  const projectNode = row.project_id ? getNode(row.project_id) : null;
  return {
    id: row.id,
    projectId: row.project_id || null,
    projectName: projectNode?.name || null,
    workspacePath: row.workspace_path,
    toolSource: row.tool_source,
    commandText: row.command_text || "",
    status: row.status,
    summary: row.summary || "",
    currentFile: row.current_file || null,
    latestError: row.latest_error || null,
    metadata: parseJsonObject(row.metadata_json),
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    endedAt: row.ended_at || null,
  };
}

function fromActivityEventRow(row) {
  return {
    id: Number(row.id),
    runId: row.run_id,
    projectId: row.project_id || null,
    kind: row.kind,
    message: row.message,
    filePath: row.file_path || null,
    createdAt: row.created_at,
    payload: parseJsonObject(row.payload_json),
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function setMeta(key, value) {
  db.prepare(`
    INSERT INTO meta(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function isSqliteBusyError(error) {
  return (
    error &&
    (error.code === "ERR_SQLITE_ERROR" || error.errcode === 5) &&
    /locked|busy/i.test(String(error.errstr || error.message || ""))
  );
}

function getMeta(key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function insertActivityEvent(runId, projectId, kind, message, filePath, payload = {}) {
  db.prepare(`
    INSERT INTO activity_events (
      run_id, project_id, kind, message, file_path, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    projectId || null,
    kind,
    message,
    normalizeOptionalPath(filePath),
    nowIso(),
    JSON.stringify(payload || {})
  );
}

function ensureProjectNodeForWorkspace(workspacePath, payload = {}) {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  if (!normalizedPath) {
    return null;
  }

  const nodes = listNodes();
  const existing = nodes
    .filter((node) => (node.type === "project" || node.type === "workspace") && node.files.some(Boolean))
    .sort((left, right) => longestPathMatch(right.files, normalizedPath) - longestPathMatch(left.files, normalizedPath))
    .find((node) => longestPathMatch(node.files, normalizedPath) > 0);

  if (existing) {
    return existing;
  }

  return createNode({
    id: `project-${sanitizeId(normalizedPath)}`,
    name: payload.projectName || path.basename(normalizedPath),
    type: "project",
    file: normalizedPath,
    summary: payload.projectSummary || `Workspace auto-linked at ${normalizedPath}.`,
    notes: [`Auto-created from activity tracker for ${normalizeToolSource(payload.toolSource)}.`],
    contextWindow: [
      {
        label: "Workspace root",
        detail: normalizedPath,
      },
    ],
  });
}

function longestPathMatch(paths, workspacePath) {
  const normalizedWorkspace = normalizePath(workspacePath);
  return (paths || []).reduce((max, entry) => {
    const normalizedEntry = normalizePath(entry);
    if (
      normalizedEntry &&
      (normalizedWorkspace === normalizedEntry || normalizedWorkspace.startsWith(`${normalizedEntry}/`))
    ) {
      return Math.max(max, normalizedEntry.length);
    }
    return max;
  }, 0);
}

function normalizeWorkspacePath(value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return "";
  }
  return path.resolve(cleanWindowsPath(value.trim()));
}

function normalizeOptionalPath(value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return null;
  }
  return cleanWindowsPath(value.trim());
}

function normalizeOptionalText(value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim();
}

function normalizeToolSource(value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return "manual";
  }
  return value.trim().toLowerCase();
}

function cleanWindowsPath(value) {
  return String(value || "")
    .trim()
    .replace(/^Microsoft\.PowerShell\.Core\\FileSystem::/i, "")
    .replace(/^\\\\\?\\/, "")
    .replace(/^\\\?\\/, "")
    .replace(/^([A-Za-z]:)\\\?\\([A-Za-z]:\\)/, "$2");
}

function normalizeActivityStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["running", "completed", "failed", "stopped"].includes(normalized)) {
    return normalized;
  }
  return "completed";
}

function mergeMetadata(base, patch) {
  const normalizedBase = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const normalizedPatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  return {
    ...normalizedBase,
    ...normalizedPatch,
  };
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

function sanitizeId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function autoLinkUnderParent(file, currentId = null) {
  if (!file) return null;
  const nodes = listNodes();
  // Khai thác các node dự án để làm cha
  const candidates = nodes.filter(n => n.id !== currentId && (n.type === 'project' || n.type === 'workspace') && n.files.some(f => file.toLowerCase().startsWith(f.toLowerCase()) && file.toLowerCase() !== f.toLowerCase()));
  
  if (candidates.length === 0) return null;
  let bestCandidate = null;
  let maxMatchLen = -1;
  for (const cand of candidates) {
    for (const candFile of cand.files) {
      if (file.toLowerCase().startsWith(candFile.toLowerCase()) && file.toLowerCase() !== candFile.toLowerCase()) {
        if (candFile.length > maxMatchLen) {
          maxMatchLen = candFile.length;
          bestCandidate = cand.id;
        }
      }
    }
  }
  return bestCandidate;
}

function deriveNodeName(value) {
  const source = String(value || "Untitled Node").replaceAll("\\", "/").split("/").pop() || "Untitled Node";
  return source
    .replace(/\.[^.]+$/, "")
    .split(/[-_.]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function formatTime() {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function nowIso() {
  return new Date().toISOString();
}

function addNode(collection, seen, node, graphRole) {
  if (seen.has(node.id)) {
    return;
  }
  seen.add(node.id);
  collection.push({
    ...node,
    graphRole,
  });
}

function getAncestorChain(allNodes, node) {
  const ancestors = [];
  let currentParentId = node.parentId;

  while (currentParentId) {
    const parent = allNodes.find((entry) => entry.id === currentParentId);
    if (!parent) {
      break;
    }
    ancestors.push(parent);
    currentParentId = parent.parentId;
  }

  return ancestors;
}

function resolveContextFileNodes(focal, allNodes) {
  if (focal.type === "file") {
    return [focal];
  }

  if (focal.type === "project" || focal.type === "workspace") {
    const roots = focal.files.map(normalizePath);
    const descendantFiles = allNodes
      .filter((node) => {
        if (node.type !== "file") {
          return false;
        }
        if (node.parentId === focal.id) {
          return true;
        }

        return node.files.some((file) =>
          roots.some((root) => isPathInside(normalizePath(file), root))
        );
      })
      .sort(sortNodesForContext)
      .slice(0, 8);

    if (descendantFiles.length) {
      return descendantFiles;
    }
  }

  return focal.files.map((file, index) => {
    const fileNode = allNodes.find((node) => node.type === "file" && node.files.includes(file));
    if (fileNode) {
      return fileNode;
    }

    return {
      id: `synthetic-file-${sanitizeId(`${focal.id}-${file}-${index}`)}`,
      name: path.basename(file),
      type: "file",
      summary: file,
      severity: "low",
      files: [file],
      relations: [focal.id],
      contextWindow: [{ label: "File path", detail: file }],
      debugSignals: [],
      chatHistory: [],
      notes: [],
      openIssues: 0,
      selectNodeId: focal.id,
    };
  });
}

function sharesFiles(leftFiles, rightFiles) {
  const left = new Set((leftFiles || []).map(normalizePath));
  return (rightFiles || []).some((file) => left.has(normalizePath(file)));
}

function matchFileAnchorForSignal(fileAnchors, signal) {
  const location = normalizePath(signal?.location || "");
  if (!location) {
    return null;
  }

  return fileAnchors.find((fileNode) =>
    (fileNode.files || []).some((file) => location.includes(normalizePath(file)))
  ) || null;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").toLowerCase();
}

function isPathInside(filePath, rootPath) {
  if (!rootPath) {
    return false;
  }

  if (filePath === rootPath) {
    return true;
  }

  return filePath.startsWith(`${rootPath}/`);
}

function sortNodesForContext(left, right) {
  const typeWeight = {
    error: 0,
    edit: 1,
    file: 2,
    service: 3,
    backend: 4,
    ui: 5,
    memory: 6,
    observability: 7,
    project: 8,
    workspace: 9,
  };

  const leftWeight = typeWeight[left.type] ?? 50;
  const rightWeight = typeWeight[right.type] ?? 50;
  if (leftWeight !== rightWeight) {
    return leftWeight - rightWeight;
  }

  return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
}

function sortContextNodes(nodes) {
  const roleWeight = {
    ancestor: 0,
    parent: 1,
    focus: 2,
    file: 3,
    error: 4,
    edit: 5,
    child: 6,
    related: 7,
  };

  return [...nodes].sort((left, right) => {
    const leftWeight = roleWeight[left.graphRole] ?? 99;
    const rightWeight = roleWeight[right.graphRole] ?? 99;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return sortNodesForContext(left, right);
  });
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.source}::${edge.target}::${edge.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildContextMetrics(nodes) {
  return nodes.reduce(
    (acc, node) => {
      acc.total += 1;
      acc.byRole[node.graphRole] = (acc.byRole[node.graphRole] || 0) + 1;
      acc.byType[node.type] = (acc.byType[node.type] || 0) + 1;
      acc.openIssues += Number(node.openIssues || 0);
      return acc;
    },
    {
      total: 0,
      openIssues: 0,
      byRole: {},
      byType: {},
    }
  );
}

function timestampForFile() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function listRecentFiles(directory, extension) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime())
    .slice(0, 10);
}

module.exports = {
  addChat,
  addDebugSignal,
  addNote,
  backupDatabase,
  createNode,
  deriveNodeName,
  exportGraph,
  finishActivity,
  getActivityOverview,
  getActivityRun,
  getContextGraph,
  getGraph,
  getNode,
  getStorageInfo,
  heartbeatActivity,
  importGraph,
  listActivityRuns,
  recordEdit,
  recordError,
  openStorageFolder,
  repairGraphTopology,
  restoreLatestBackup,
  mergeCrawledNodes,
  sanitizeId,
  searchNodes,
  setActiveNode,
  startActivity,
  traceNodes,
  upsertNodeFromTrace,
};
