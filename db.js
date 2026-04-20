const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { spawn, spawnSync } = require("node:child_process");
const { scanProjectPipeline } = require("./scanner");

const ROOT = __dirname;
const LEGACY_DATA_FILE = path.join(ROOT, "graph-data.json");
const STORAGE_HOME = process.env.GRAPH_MEMORY_HOME || path.join(os.homedir(), ".graph-memory");
const DB_PATH = process.env.GRAPH_MEMORY_DB_PATH || path.join(STORAGE_HOME, "graph.db");
const EXPORTS_DIR = path.join(STORAGE_HOME, "exports");
const BACKUPS_DIR = path.join(STORAGE_HOME, "backups");
const DEFAULT_VAULT_ROOT = process.env.GRAPH_MEMORY_VAULT_ROOT || path.join(os.homedir(), "KnowledgeVault");
const DEFAULT_VAULT_DIRS = [
  "raw",
  "projects",
  "modules",
  "concepts",
  "sources",
  "analyses",
  "skills",
  path.join("skills", "_git"),
  path.join("templates", "projects"),
  path.join("templates", "modules"),
  path.join("templates", "skills"),
];
const MODULE_CAPABILITY_PATTERNS = [
  { capability: "map", keywords: ["map", "maplibre", "leaflet", "geo", "geocode", "location"] },
  { capability: "ocr", keywords: ["ocr", "tesseract", "vision", "extract-text"] },
  { capability: "scanner", keywords: ["qr", "barcode", "scanner"] },
  { capability: "auth", keywords: ["auth", "login", "jwt", "session", "oauth"] },
  { capability: "camera", keywords: ["camera", "capture", "webcam"] },
  { capability: "upload", keywords: ["upload", "uploader", "dropzone", "multipart"] },
  { capability: "pdf", keywords: ["pdf", "document", "preview"] },
  { capability: "chart", keywords: ["chart", "graph", "visualization", "echarts", "recharts"] },
  { capability: "payment", keywords: ["payment", "stripe", "checkout", "billing"] },
  { capability: "search", keywords: ["search", "filter", "query", "autocomplete"] },
  { capability: "notification", keywords: ["notification", "toast", "alert", "email", "sms"] },
];
const MODULE_BUCKET_NAMES = new Set([
  "modules",
  "features",
  "components",
  "services",
  "service",
  "lib",
  "hooks",
  "utils",
  "shared",
  "domains",
  "domain",
  "providers",
  "stores",
  "widgets",
  "pages",
  "screens",
  "api",
]);
const MODULE_ENTRY_BASENAMES = new Set([
  "index",
  "main",
  "app",
  "module",
  "service",
  "controller",
  "provider",
  "client",
  "server",
  "hook",
  "view",
]);
const MODULE_IGNORE_FILE_PATTERNS = [
  /(^|\/)__tests__(\/|$)/i,
  /(^|\/)__mocks__(\/|$)/i,
  /\.(test|spec|stories)\.[^.]+$/i,
  /(^|\/)(vite|webpack|rollup|jest|playwright|eslint|babel|tailwind|postcss|next|nuxt|metro|tsconfig|package)\.[^.]+$/i,
];
const MODULE_REGISTRY_VERSION = "3";
const ENV_VAR_PATTERNS = [
  /process\.env\.([A-Z0-9_]+)/g,
  /import\.meta\.env\.([A-Z0-9_]+)/g,
  /Deno\.env\.get\(\s*["'`]([A-Z0-9_]+)["'`]\s*\)/g,
];
const CONFIG_ACCESS_PATTERNS = [
  /\bconfig(?:Service)?\.(?:get|getOrThrow)\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  /\bgetConfig\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
];
const ADAPTER_PATTERNS = [
  { label: "firebase", regex: /\bfirebase\b|firestore|auth0|supabase/i },
  { label: "http", regex: /\baxios\b|\bfetch\b|graphql-request|apollo-client/i },
  { label: "database", regex: /\bprisma\b|\bmongoose\b|\btypeorm\b|\bsequelize\b|\bsql\b/i },
  { label: "storage", regex: /\bs3\b|\buploadthing\b|\bcloudinary\b|\bblob\b/i },
  { label: "maps", regex: /\bmaplibre\b|\bleaflet\b|\bgoogle maps\b|\bgeo/i },
  { label: "vision", regex: /\bocr\b|\btesseract\b|\bvision\b|\bbarcode\b|\bqr\b/i },
];

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

    CREATE TABLE IF NOT EXISTS implementation_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      workspace_path TEXT NOT NULL,
      task_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      current_step TEXT,
      next_step TEXT,
      blocker TEXT,
      latest_run_id TEXT,
      last_tool_source TEXT,
      touched_files_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_implementation_threads_workspace_task
      ON implementation_threads(workspace_path, task_key);

    CREATE TABLE IF NOT EXISTS implementation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      file_path TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS module_adoptions (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      module_canonical_key TEXT,
      source_workspace_path TEXT,
      target_project_id TEXT,
      target_workspace_path TEXT NOT NULL,
      adoption_key TEXT NOT NULL,
      adoption_type TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      integration_pattern TEXT,
      adapter_changes_json TEXT NOT NULL DEFAULT '[]',
      dependency_changes_json TEXT NOT NULL DEFAULT '[]',
      env_changes_json TEXT NOT NULL DEFAULT '[]',
      touched_files_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      latest_run_id TEXT,
      implementation_thread_id TEXT,
      last_tool_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      adopted_at TEXT NOT NULL,
      validated_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_module_adoptions_target_key
      ON module_adoptions(target_workspace_path, adoption_key);

    CREATE TABLE IF NOT EXISTS module_adoption_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adoption_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS module_verifications (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      module_canonical_key TEXT,
      adoption_id TEXT,
      source_workspace_path TEXT,
      target_project_id TEXT,
      target_workspace_path TEXT NOT NULL,
      verification_key TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      passed_tests_json TEXT NOT NULL DEFAULT '[]',
      failed_tests_json TEXT NOT NULL DEFAULT '[]',
      integration_errors_json TEXT NOT NULL DEFAULT '[]',
      fix_patterns_json TEXT NOT NULL DEFAULT '[]',
      verification_notes_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      latest_run_id TEXT,
      implementation_thread_id TEXT,
      last_tool_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      validated_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_module_verifications_target_key
      ON module_verifications(target_workspace_path, verification_key);

    CREATE TABLE IF NOT EXISTS module_verification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verification_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS brain_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      source_ref TEXT,
      source_subdir TEXT,
      local_path TEXT NOT NULL,
      manifest_path TEXT,
      entry_file TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      usage_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      version_hash TEXT,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brain_skill_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS pipeline_cache (
      cache_key TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      max_depth INTEGER NOT NULL,
      max_files INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL
    );
  `);

  const tableInfo = db.prepare("PRAGMA table_info(nodes)").all();
  if (!tableInfo.some((col) => col.name === "parent_id")) {
    db.exec("ALTER TABLE nodes ADD COLUMN parent_id TEXT");
  }

  try {
    if (getMeta("schemaVersion") !== "5") {
      setMeta("schemaVersion", "5");
    }
    ensureDefaultConfig();
    migrateFromLegacyJsonIfNeeded();
  } catch (error) {
    if (!isSqliteBusyError(error)) {
      throw error;
    }
  }
}

function ensureDefaultConfig() {
  if (!getMeta("vaultRoot")) {
    setMeta("vaultRoot", DEFAULT_VAULT_ROOT);
  }
  if (!getMeta("vaultScaffoldVersion")) {
    setMeta("vaultScaffoldVersion", "1");
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

  const createdRun = getActivityRun(runId);
  syncImplementationThreadFromActivity(createdRun, payload, "start");

  if (projectNode) {
    setMeta("activeNodeId", projectNode.id);
  }

  return createdRun;
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

  const updatedRun = getActivityRun(runId);
  syncImplementationThreadFromActivity(updatedRun, payload, payload.kind || "heartbeat");
  return updatedRun;
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

  const finishedRun = getActivityRun(runId);
  syncImplementationThreadFromActivity(finishedRun, payload, "finish");
  return finishedRun;
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
  const activeThreads = listImplementationThreads({ statuses: ["active", "blocked", "paused"], limit: 8 });
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
    implementation: {
      activeCount: activeThreads.length,
      activeThreads: activeThreads.map((thread) => compactImplementationThread(thread)),
    },
    recent,
    recentEvents,
    projects: projectStats,
  };
}

function getStorageInfo() {
  const vaultConfig = getVaultConfig();
  return {
    storageHome: STORAGE_HOME,
    dbPath: DB_PATH,
    exportsDir: EXPORTS_DIR,
    backupsDir: BACKUPS_DIR,
    vaultRoot: vaultConfig.rootPath,
    vaultExists: vaultConfig.exists,
    vaultDirs: vaultConfig.directories,
    legacyDataFile: LEGACY_DATA_FILE,
    activeNodeId: getMeta("activeNodeId"),
    nodeCount: db.prepare("SELECT COUNT(*) AS count FROM nodes").get().count,
    runningActivityCount: db.prepare("SELECT COUNT(*) AS count FROM activity_runs WHERE status = 'running'").get().count,
    recentExports: listRecentFiles(EXPORTS_DIR, ".json"),
    recentBackups: listRecentFiles(BACKUPS_DIR, ".db"),
  };
}

function getVaultConfig() {
  const rootPath = normalizeWorkspacePath(getMeta("vaultRoot") || DEFAULT_VAULT_ROOT);
  const directories = DEFAULT_VAULT_DIRS.map((dir) => path.join(rootPath, dir));
  return {
    rootPath,
    exists: fs.existsSync(rootPath),
    directories,
    indexPath: path.join(rootPath, "index.md"),
    logPath: path.join(rootPath, "log.md"),
    scaffoldVersion: getMeta("vaultScaffoldVersion") || "1",
  };
}

function setVaultConfig(rootPath) {
  const normalizedPath = normalizeWorkspacePath(rootPath);
  if (!normalizedPath) {
    throw new Error("rootPath la bat buoc.");
  }
  setMeta("vaultRoot", normalizedPath);
  return getVaultConfig();
}

function scaffoldVault(rootPath) {
  const config = setVaultConfig(rootPath);
  fs.mkdirSync(config.rootPath, { recursive: true });
  config.directories.forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });

  writeUtf8FileIfMissing(
    config.indexPath,
    `# Knowledge Vault

## Projects

## Modules

## Concepts

## Sources

## Analyses
`
  );
  writeUtf8FileIfMissing(
    config.logPath,
    `# Vault Log

## [${new Date().toISOString().slice(0, 10)}] scaffold | Knowledge Vault initialized
- Root: ${config.rootPath}
- Purpose: Persistent Obsidian-style artifact layer for Graph Memory.
`
  );
  writeUtf8FileIfMissing(
    path.join(config.rootPath, "templates", "projects", "PROJECT_TEMPLATE.md"),
    `# {{project_name}}

## Summary

## Architecture

## Reusable Modules

## Known Risks

## Recent Decisions
`
  );
  writeUtf8FileIfMissing(
    path.join(config.rootPath, "templates", "modules", "MODULE_TEMPLATE.md"),
    `# {{module_name}}

## Capability

## What It Does

## Entry Paths

## Dependencies

## Integration Notes

## Adoption History
`
  );
  writeUtf8FileIfMissing(
    path.join(config.rootPath, "templates", "skills", "SKILL_TEMPLATE.md"),
    `# {{skill_name}}

## Summary

## When To Use

## Inputs

## Workflow

## Safety

## Source
`
  );
  writeUtf8FileIfMissing(
    path.join(config.rootPath, "skills", "README.md"),
    `# Brain Skills

Skills imported from Git live here. Graph Memory indexes SKILL.md, README.md, package metadata, tags, and capabilities so IDE/CLI agents can retrieve compact usage guidance before opening raw files.
`
  );

  return {
    ...config,
    created: true,
  };
}

function listBrainSkills(filters = {}) {
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const capability = sanitizeCapability(filters.capability || "");
  const status = normalizeOptionalText(filters.status) || "active";
  const limit = clampNumber(filters.limit, 12, 1, 80);
  const rows = db
    .prepare(`
      SELECT *
      FROM brain_skills
      WHERE (? = '' OR status = ?)
      ORDER BY updated_at DESC, name ASC
    `)
    .all(status, status)
    .map(fromBrainSkillRow)
    .filter((skill) => {
      if (capability && !(skill.capabilities || []).includes(capability)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return brainSkillMatchesQuery(skill, query);
    })
    .slice(0, limit);

  return {
    count: rows.length,
    skills: rows,
  };
}

function getBrainSkill(skillId) {
  const row = db.prepare("SELECT * FROM brain_skills WHERE id = ?").get(skillId);
  if (!row) {
    return null;
  }
  const skill = fromBrainSkillRow(row);
  return {
    ...skill,
    events: listBrainSkillEvents(skill.id, 20),
  };
}

function updateBrainSkillFromGit(payload = {}) {
  const sourceUrl = normalizeOptionalText(payload.sourceUrl || payload.gitUrl || payload.url);
  if (!sourceUrl) {
    throw new Error("sourceUrl la bat buoc.");
  }
  const sourceRef = normalizeOptionalText(payload.ref || payload.sourceRef || payload.branch) || "";
  const sourceSubdir = normalizeSkillSubdir(payload.subdir || payload.sourceSubdir || "");
  const explicitName = normalizeOptionalText(payload.name);
  const skillId = buildBrainSkillId(explicitName || sourceUrl, sourceSubdir);
  const config = getVaultConfig();
  fs.mkdirSync(path.join(config.rootPath, "skills", "_git"), { recursive: true });
  const cloneDir = path.join(config.rootPath, "skills", "_git", skillId);

  let operation = "clone";
  if (fs.existsSync(path.join(cloneDir, ".git"))) {
    operation = "update";
    runGitCommand(["-C", cloneDir, "fetch", "--all", "--tags", "--prune"]);
    if (sourceRef) {
      runGitCommand(["-C", cloneDir, "checkout", sourceRef]);
    } else {
      runGitCommand(["-C", cloneDir, "pull", "--ff-only"]);
    }
  } else {
    fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
    runGitCommand(["clone", sourceUrl, cloneDir]);
    if (sourceRef) {
      runGitCommand(["-C", cloneDir, "checkout", sourceRef]);
    }
  }

  const skillRoot = sourceSubdir ? path.join(cloneDir, sourceSubdir) : cloneDir;
  if (!fs.existsSync(skillRoot) || !fs.statSync(skillRoot).isDirectory()) {
    throw new Error(`Khong tim thay skill subdir: ${skillRoot}`);
  }

  const indexed = indexBrainSkillDirectory({
    skillId,
    rootPath: skillRoot,
    sourceUrl,
    sourceRef,
    sourceSubdir,
    explicitName,
    metadata: payload.metadata || {},
  });
  insertBrainSkillEvent(indexed.id, operation, `${operation} skill from ${sourceUrl}`, {
    sourceUrl,
    sourceRef,
    sourceSubdir,
    versionHash: indexed.versionHash,
  });
  upsertBrainSkillNode(indexed);
  appendVaultLog(`skill-${operation}`, `${indexed.name} | ${sourceUrl}`);
  return {
    operation,
    skill: indexed,
  };
}

function registerBrainSkill(payload = {}) {
  const localPath = normalizeWorkspacePath(payload.localPath || payload.path || "");
  if (!localPath) {
    throw new Error("localPath la bat buoc.");
  }
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
    throw new Error(`Khong tim thay thu muc skill: ${localPath}`);
  }
  const skillId = buildBrainSkillId(payload.name || localPath, "");
  const indexed = indexBrainSkillDirectory({
    skillId,
    rootPath: localPath,
    sourceUrl: normalizeOptionalText(payload.sourceUrl || ""),
    sourceRef: normalizeOptionalText(payload.sourceRef || payload.ref || ""),
    sourceSubdir: normalizeSkillSubdir(payload.sourceSubdir || payload.subdir || ""),
    explicitName: normalizeOptionalText(payload.name),
    metadata: payload.metadata || {},
  });
  insertBrainSkillEvent(indexed.id, "register", `registered local skill ${indexed.name}`, {
    localPath,
  });
  upsertBrainSkillNode(indexed);
  appendVaultLog("skill-register", `${indexed.name} | ${localPath}`);
  return indexed;
}

function recommendBrainSkills(options = {}) {
  const query = normalizeOptionalText(options.query) || "";
  const capability = sanitizeCapability(options.capability || query);
  const workspacePath = normalizeWorkspacePath(options.workspacePath || "");
  const limit = clampNumber(options.limit, 5, 1, 20);
  const skills = listBrainSkills({ status: "active", limit: 80 }).skills;
  const scored = skills
    .map((skill) => {
      let score = 0;
      const haystack = buildBrainSkillHaystack(skill);
      if (capability && skill.capabilities.includes(capability)) score += 50;
      if (query && haystack.includes(query.toLowerCase())) score += 24;
      if (workspacePath && haystack.includes(path.basename(workspacePath).toLowerCase())) score += 6;
      score += Math.min((skill.tags || []).length, 8);
      score += skill.entryFile ? 4 : 0;
      score += recencyScore(skill.updatedAt);
      return {
        ...skill,
        score,
        rationale: buildBrainSkillRationale(skill, { query, capability, workspacePath }),
      };
    })
    .filter((skill) => skill.score > 0 || (!query && !capability))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);

  return {
    query,
    capability,
    count: scored.length,
    skills: scored,
  };
}

function getBrainContext(options = {}) {
  const workspacePath = normalizeWorkspacePath(options.workspacePath || "");
  if (!workspacePath) {
    throw new Error("workspacePath la bat buoc.");
  }
  const query = normalizeOptionalText(options.query) || "";
  const capability = sanitizeCapability(options.capability || query);
  const lowToken = getLowTokenContext({
    ...options,
    workspacePath,
    query,
    capability,
    moduleLimit: options.moduleLimit || 4,
    matchLimit: options.matchLimit || 4,
  });
  const skillRecommendations = recommendBrainSkills({
    workspacePath,
    query,
    capability,
    limit: clampNumber(options.skillLimit, 5, 1, 12),
  });
  return {
    workspacePath,
    query,
    capability,
    brain: {
      mode: "graph-memory-brain",
      priorityOrder: [
        "resume implementation thread",
        "use recommended brain skill",
        "reuse verified module",
        "open smallest context window",
        "only then inspect raw source",
      ],
      rules: [
        "Do not read full repositories before checking this brain context.",
        "Prefer skills with matching capability and recent verification/adoption memory.",
        "If a useful skill is missing, import it with brain-skill-update and re-run brain-context.",
      ],
    },
    skills: skillRecommendations.skills,
    lowToken,
    recommendations: [
      skillRecommendations.skills.length
        ? "Use brain.skills[0] as the first operating playbook before coding."
        : "No matching brain skill found; install/update a skill from Git if this workflow repeats.",
      ...(lowToken.recommendations || []),
    ],
    tokenEstimate: estimateContextTokens({
      skills: skillRecommendations.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        summary: skill.summary,
        capabilities: skill.capabilities,
        usage: skill.usage,
      })),
      lowToken: {
        project: lowToken.project,
        recentWork: lowToken.recentWork,
        implementation: lowToken.implementation?.primaryThread
          ? compactImplementationThread(lowToken.implementation.primaryThread)
          : null,
      },
    }),
  };
}

function getPipelineCache(rootPath, maxDepth = 6, maxFiles = 220) {
  const normalizedRootPath = path.normalize(String(rootPath || "").trim());
  if (!normalizedRootPath) {
    return null;
  }
  const cacheKey = buildPipelineCacheKey(normalizedRootPath, maxDepth, maxFiles);
  const row = db.prepare("SELECT * FROM pipeline_cache WHERE cache_key = ?").get(cacheKey);
  if (!row) {
    return null;
  }
  const now = nowIso();
  db.prepare("UPDATE pipeline_cache SET last_accessed_at = ? WHERE cache_key = ?").run(now, cacheKey);
  try {
    const payload = JSON.parse(row.payload_json);
    return {
      ...payload,
      cached: true,
      cache: {
        key: cacheKey,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
      },
    };
  } catch {
    return null;
  }
}

function savePipelineCache(rootPath, maxDepth = 6, maxFiles = 220, payload = {}) {
  const normalizedRootPath = path.normalize(String(rootPath || "").trim());
  if (!normalizedRootPath) {
    throw new Error("rootPath la bat buoc de luu pipeline cache.");
  }
  const cacheKey = buildPipelineCacheKey(normalizedRootPath, maxDepth, maxFiles);
  const now = nowIso();
  const preparedPayload = {
    ...payload,
    cached: false,
    cache: {
      key: cacheKey,
      updatedAt: now,
      createdAt: payload?.cache?.createdAt || now,
    },
  };
  db.prepare(`
    INSERT INTO pipeline_cache (
      cache_key, root_path, max_depth, max_files, payload_json, created_at, updated_at, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at,
      last_accessed_at = excluded.last_accessed_at
  `).run(
    cacheKey,
    normalizedRootPath,
    Number(maxDepth || 6),
    Number(maxFiles || 220),
    JSON.stringify(preparedPayload),
    now,
    now,
    now
  );
  compactPipelineCache(40);
  return {
    key: cacheKey,
    updatedAt: now,
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

function fromBrainSkillRow(row) {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary || "",
    sourceUrl: row.source_url || null,
    sourceRef: row.source_ref || null,
    sourceSubdir: row.source_subdir || null,
    localPath: row.local_path,
    manifestPath: row.manifest_path || null,
    entryFile: row.entry_file || null,
    capabilities: parseJsonArray(row.capabilities_json),
    tags: parseJsonArray(row.tags_json),
    usage: parseJsonObject(row.usage_json),
    metadata: parseJsonObject(row.metadata_json),
    status: row.status || "active",
    versionHash: row.version_hash || null,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    lastIndexedAt: row.last_indexed_at,
  };
}

function fromBrainSkillEventRow(row) {
  return {
    id: row.id,
    skillId: row.skill_id,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
    payload: parseJsonObject(row.payload_json),
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

function fromImplementationThreadRow(row) {
  const projectNode = row.project_id ? getNode(row.project_id) : null;
  return {
    id: row.id,
    projectId: row.project_id || null,
    projectName: projectNode?.name || null,
    workspacePath: row.workspace_path,
    taskKey: row.task_key,
    title: row.title,
    status: row.status,
    summary: row.summary || "",
    currentStep: row.current_step || null,
    nextStep: row.next_step || null,
    blocker: row.blocker || null,
    latestRunId: row.latest_run_id || null,
    lastToolSource: row.last_tool_source || null,
    touchedFiles: parseJsonArray(row.touched_files_json),
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
    completedAt: row.completed_at || null,
  };
}

function fromImplementationEventRow(row) {
  return {
    id: Number(row.id),
    threadId: row.thread_id,
    runId: row.run_id || null,
    kind: row.kind,
    message: row.message,
    filePath: row.file_path || null,
    createdAt: row.created_at,
    payload: parseJsonObject(row.payload_json),
  };
}

function fromModuleAdoptionRow(row) {
  const moduleNode = row.module_id ? getNode(row.module_id) : null;
  const projectNode = row.target_project_id ? getNode(row.target_project_id) : null;
  return {
    id: row.id,
    moduleId: row.module_id,
    moduleName: moduleNode?.name || null,
    moduleCanonicalKey: row.module_canonical_key || null,
    sourceWorkspacePath: row.source_workspace_path || null,
    targetProjectId: row.target_project_id || null,
    targetProjectName: projectNode?.name || null,
    targetWorkspacePath: row.target_workspace_path,
    adoptionKey: row.adoption_key,
    adoptionType: row.adoption_type,
    status: row.status,
    summary: row.summary || "",
    integrationPattern: row.integration_pattern || null,
    adapterChanges: parseJsonArray(row.adapter_changes_json),
    dependencyChanges: parseJsonArray(row.dependency_changes_json),
    envChanges: parseJsonArray(row.env_changes_json),
    touchedFiles: parseJsonArray(row.touched_files_json),
    evidence: parseJsonObject(row.evidence_json),
    latestRunId: row.latest_run_id || null,
    implementationThreadId: row.implementation_thread_id || null,
    lastToolSource: row.last_tool_source || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adoptedAt: row.adopted_at,
    validatedAt: row.validated_at || null,
  };
}

function fromModuleAdoptionEventRow(row) {
  return {
    id: Number(row.id),
    adoptionId: row.adoption_id,
    runId: row.run_id || null,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
    payload: parseJsonObject(row.payload_json),
  };
}

function fromModuleVerificationRow(row) {
  const moduleNode = row.module_id ? getNode(row.module_id) : null;
  const projectNode = row.target_project_id ? getNode(row.target_project_id) : null;
  const adoption = row.adoption_id ? getModuleAdoption(row.adoption_id) : null;
  return {
    id: row.id,
    moduleId: row.module_id,
    moduleName: moduleNode?.name || null,
    moduleCanonicalKey: row.module_canonical_key || null,
    adoptionId: row.adoption_id || null,
    adoptionKey: adoption?.adoptionKey || null,
    sourceWorkspacePath: row.source_workspace_path || null,
    targetProjectId: row.target_project_id || null,
    targetProjectName: projectNode?.name || null,
    targetWorkspacePath: row.target_workspace_path,
    verificationKey: row.verification_key,
    status: row.status,
    summary: row.summary || "",
    passedTests: parseJsonArray(row.passed_tests_json),
    failedTests: parseJsonArray(row.failed_tests_json),
    integrationErrors: parseJsonArray(row.integration_errors_json),
    fixPatterns: parseJsonArray(row.fix_patterns_json),
    verificationNotes: parseJsonArray(row.verification_notes_json),
    evidence: parseJsonObject(row.evidence_json),
    latestRunId: row.latest_run_id || null,
    implementationThreadId: row.implementation_thread_id || null,
    lastToolSource: row.last_tool_source || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
    validatedAt: row.validated_at || null,
  };
}

function fromModuleVerificationEventRow(row) {
  return {
    id: Number(row.id),
    verificationId: row.verification_id,
    runId: row.run_id || null,
    kind: row.kind,
    message: row.message,
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

function getImplementationThread(threadId) {
  const row = db.prepare("SELECT * FROM implementation_threads WHERE id = ?").get(threadId);
  return row ? fromImplementationThreadRow(row) : null;
}

function findImplementationThreadByTaskKey(workspacePath, taskKey) {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
  const normalizedTaskKey = deriveTaskKeyFromText(taskKey);
  if (!normalizedWorkspace || !normalizedTaskKey) {
    return null;
  }
  const row = db
    .prepare("SELECT * FROM implementation_threads WHERE workspace_path = ? AND task_key = ?")
    .get(normalizedWorkspace, normalizedTaskKey);
  return row ? fromImplementationThreadRow(row) : null;
}

function listImplementationThreads(filters = {}) {
  const conditions = [];
  const values = [];
  const workspacePath = normalizeWorkspacePath(filters.workspacePath || "");
  const projectId = normalizeOptionalText(filters.projectId);
  const statuses = Array.isArray(filters.statuses)
    ? filters.statuses.map(normalizeImplementationStatus)
    : normalizeOptionalText(filters.status)
      ? [normalizeImplementationStatus(filters.status)]
      : [];
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const limit = clampNumber(filters.limit, 8, 1, 50);

  if (workspacePath) {
    conditions.push("workspace_path = ?");
    values.push(workspacePath);
  }
  if (projectId) {
    conditions.push("project_id = ?");
    values.push(projectId);
  }
  if (statuses.length) {
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    values.push(...statuses);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  let rows = db
    .prepare(`
      SELECT *
      FROM implementation_threads
      ${whereClause}
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'blocked' THEN 1
          WHEN 'paused' THEN 2
          WHEN 'failed' THEN 3
          ELSE 4
        END,
        datetime(last_active_at) DESC,
        datetime(updated_at) DESC
      LIMIT ${limit}
    `)
    .all(...values)
    .map(fromImplementationThreadRow);

  if (query) {
    rows = rows.filter((thread) => {
      const haystack = [
        thread.title,
        thread.summary,
        thread.currentStep,
        thread.nextStep,
        thread.blocker,
        ...(thread.touchedFiles || []),
        ...(thread.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  return rows;
}

function listImplementationEvents(threadId, limit = 10) {
  return db
    .prepare(`
      SELECT *
      FROM implementation_events
      WHERE thread_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(threadId, clampNumber(limit, 10, 1, 50))
    .map(fromImplementationEventRow);
}

function insertImplementationEvent(threadId, runId, kind, message, filePath, payload = {}) {
  db.prepare(`
    INSERT INTO implementation_events (
      thread_id, run_id, kind, message, file_path, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    threadId,
    normalizeOptionalText(runId),
    kind,
    message,
    normalizeOptionalPath(filePath),
    nowIso(),
    JSON.stringify(payload || {})
  );
}

function getModuleAdoption(adoptionId) {
  const row = db.prepare("SELECT * FROM module_adoptions WHERE id = ?").get(adoptionId);
  return row ? fromModuleAdoptionRow(row) : null;
}

function findModuleAdoptionByKey(targetWorkspacePath, adoptionKey) {
  const normalizedWorkspace = normalizeWorkspacePath(targetWorkspacePath);
  const normalizedAdoptionKey = deriveTaskKeyFromText(adoptionKey);
  if (!normalizedWorkspace || !normalizedAdoptionKey) {
    return null;
  }
  const row = db
    .prepare("SELECT * FROM module_adoptions WHERE target_workspace_path = ? AND adoption_key = ?")
    .get(normalizedWorkspace, normalizedAdoptionKey);
  return row ? fromModuleAdoptionRow(row) : null;
}

function findLatestModuleAdoptionForTarget(moduleId, targetWorkspacePath) {
  const normalizedModuleId = normalizeOptionalText(moduleId);
  const normalizedWorkspace = normalizeWorkspacePath(targetWorkspacePath);
  if (!normalizedModuleId || !normalizedWorkspace) {
    return null;
  }
  const row = db.prepare(`
    SELECT *
    FROM module_adoptions
    WHERE module_id = ? AND target_workspace_path = ?
    ORDER BY
      CASE status
        WHEN 'validated' THEN 0
        WHEN 'integrating' THEN 1
        WHEN 'planned' THEN 2
        WHEN 'failed' THEN 3
        ELSE 4
      END,
      datetime(updated_at) DESC,
      datetime(adopted_at) DESC
    LIMIT 1
  `).get(normalizedModuleId, normalizedWorkspace);
  return row ? fromModuleAdoptionRow(row) : null;
}

function listModuleAdoptionEvents(adoptionId, limit = 8) {
  return db
    .prepare(`
      SELECT *
      FROM module_adoption_events
      WHERE adoption_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(adoptionId, clampNumber(limit, 8, 1, 50))
    .map(fromModuleAdoptionEventRow);
}

function insertModuleAdoptionEvent(adoptionId, runId, kind, message, payload = {}) {
  db.prepare(`
    INSERT INTO module_adoption_events (
      adoption_id, run_id, kind, message, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    adoptionId,
    normalizeOptionalText(runId),
    kind,
    message,
    nowIso(),
    JSON.stringify(payload || {})
  );
}

function resolveModuleNodeReference(payload = {}) {
  const directId = normalizeOptionalText(payload.moduleId);
  if (directId) {
    const directNode = getNode(directId);
    if (directNode?.type === "module") {
      return directNode;
    }
  }

  const canonicalKey = normalizeOptionalText(payload.moduleCanonicalKey);
  if (canonicalKey) {
    const candidates = listNodes()
      .filter((node) => node.type === "module")
      .filter((node) => extractCanonicalKey(node) === canonicalKey)
      .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
    if (candidates.length) {
      return candidates[0];
    }
  }

  const moduleName = normalizeOptionalText(payload.moduleName);
  if (moduleName) {
    const candidates = listNodes()
      .filter((node) => node.type === "module")
      .filter((node) => String(node.name || "").toLowerCase() === moduleName.toLowerCase())
      .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
    if (candidates.length) {
      return candidates[0];
    }
  }

  return null;
}

function listModuleAdoptions(filters = {}) {
  const conditions = [];
  const values = [];
  const moduleId = normalizeOptionalText(filters.moduleId);
  const targetWorkspacePath = normalizeWorkspacePath(filters.targetWorkspacePath || filters.workspacePath || "");
  const sourceWorkspacePath = normalizeWorkspacePath(filters.sourceWorkspacePath || "");
  const statuses = Array.isArray(filters.statuses)
    ? filters.statuses.map(normalizeAdoptionStatus)
    : normalizeOptionalText(filters.status)
      ? [normalizeAdoptionStatus(filters.status)]
      : [];
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const limit = clampNumber(filters.limit, 12, 1, 200);

  if (moduleId) {
    conditions.push("module_id = ?");
    values.push(moduleId);
  }
  if (targetWorkspacePath) {
    conditions.push("target_workspace_path = ?");
    values.push(targetWorkspacePath);
  }
  if (sourceWorkspacePath) {
    conditions.push("source_workspace_path = ?");
    values.push(sourceWorkspacePath);
  }
  if (statuses.length) {
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    values.push(...statuses);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  let rows = db
    .prepare(`
      SELECT *
      FROM module_adoptions
      ${whereClause}
      ORDER BY datetime(updated_at) DESC, datetime(adopted_at) DESC
      LIMIT ${limit}
    `)
    .all(...values)
    .map(fromModuleAdoptionRow);

  if (query) {
    rows = rows.filter((adoption) => {
      const haystack = [
        adoption.moduleName,
        adoption.summary,
        adoption.integrationPattern,
        adoption.adoptionType,
        adoption.status,
        ...(adoption.adapterChanges || []),
        ...(adoption.dependencyChanges || []),
        ...(adoption.envChanges || []),
        ...(adoption.touchedFiles || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  return rows;
}

function summarizeModuleAdoptionList(adoptions = [], targetWorkspacePath = "") {
  const normalizedTarget = normalizeWorkspacePath(targetWorkspacePath || "");
  const validated = adoptions.filter((item) => item.status === "validated");
  const active = adoptions.filter((item) => ["planned", "integrating"].includes(item.status));
  const failed = adoptions.filter((item) => ["failed", "abandoned"].includes(item.status));
  const crossProjectTargets = new Set(
    adoptions
      .map((item) => normalizeWorkspacePath(item.targetWorkspacePath || ""))
      .filter(Boolean)
  );
  const sameTargetCount = normalizedTarget
    ? adoptions.filter((item) => normalizeWorkspacePath(item.targetWorkspacePath || "") === normalizedTarget).length
    : 0;

  const countTop = (items) => {
    const counts = new Map();
    items.forEach((item) => {
      const normalized = normalizeOptionalText(item);
      if (!normalized) {
        return;
      }
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([value, count]) => ({ value, count }));
  };

  const recentAdoptions = [...adoptions]
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .slice(0, 3);

  return {
    totalCount: adoptions.length,
    validatedCount: validated.length,
    activeCount: active.length,
    failedCount: failed.length,
    sameTargetCount,
    targetProjectCount: crossProjectTargets.size,
    recentPatterns: uniqueStrings(recentAdoptions.map((item) => item.integrationPattern).filter(Boolean)).slice(0, 3),
    topAdapterChanges: countTop(adoptions.flatMap((item) => item.adapterChanges || [])),
    topDependencyChanges: countTop(adoptions.flatMap((item) => item.dependencyChanges || [])),
    topEnvChanges: countTop(adoptions.flatMap((item) => item.envChanges || [])),
    lastValidatedAt: validated
      .map((item) => item.validatedAt || item.updatedAt)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null,
    recentAdoptions: recentAdoptions.map((item) => ({
      id: item.id,
      targetWorkspacePath: item.targetWorkspacePath,
      adoptionType: item.adoptionType,
      status: item.status,
      integrationPattern: item.integrationPattern,
      updatedAt: item.updatedAt,
    })),
  };
}

function buildModuleAdoptionIndex(targetWorkspacePath = "") {
  const groups = new Map();
  listModuleAdoptions({ limit: 200 }).forEach((adoption) => {
    if (!groups.has(adoption.moduleId)) {
      groups.set(adoption.moduleId, []);
    }
    groups.get(adoption.moduleId).push(adoption);
  });

  const index = new Map();
  groups.forEach((items, moduleId) => {
    index.set(moduleId, summarizeModuleAdoptionList(items, targetWorkspacePath));
  });
  return index;
}

function recordModuleAdoption(payload = {}) {
  const targetWorkspacePath = normalizeWorkspacePath(payload.targetWorkspacePath || payload.workspacePath);
  if (!targetWorkspacePath) {
    throw new Error("targetWorkspacePath la bat buoc.");
  }

  const moduleNode = resolveModuleNodeReference(payload);
  if (!moduleNode) {
    throw new Error("Khong tim thay module de ghi adoption memory.");
  }

  const targetProjectNode = ensureProjectNodeForWorkspace(targetWorkspacePath, payload);
  const existing =
    (normalizeOptionalText(payload.id) ? getModuleAdoption(payload.id) : null) ||
    findModuleAdoptionByKey(
      targetWorkspacePath,
      payload.adoptionKey ||
        payload.taskKey ||
        payload.implementationThreadId ||
        `${moduleNode.id}-${targetWorkspacePath}`
    );
  const sourceWorkspacePath =
    normalizeWorkspacePath(payload.sourceWorkspacePath || extractWorkspaceRootsFromNode(moduleNode)[0] || "") || null;
  const taskKey = deriveTaskKeyFromText(
    payload.taskKey ||
      payload.implementationThreadId ||
      payload.title ||
      payload.summary ||
      payload.integrationPattern ||
      moduleNode.name,
    "module-adoption"
  );
  const adoptionKey = deriveTaskKeyFromText(payload.adoptionKey || `${moduleNode.id}-${taskKey}`, "module-adoption");
  const adoptionId = normalizeOptionalText(payload.id) || existing?.id || `adoption-${sanitizeId(`${targetWorkspacePath}-${adoptionKey}`)}`;
  const now = nowIso();
  const status = normalizeAdoptionStatus(
    payload.status ||
      (payload.implementationStatus === "completed"
        ? "validated"
        : payload.implementationStatus === "failed"
          ? "failed"
          : "integrating")
  );
  const summary =
    normalizeOptionalText(payload.summary) ||
    existing?.summary ||
    `${normalizeAdoptionType(payload.adoptionType)} ${moduleNode.name} into ${path.basename(targetWorkspacePath)}.`;
  const integrationPattern =
    normalizeOptionalText(payload.integrationPattern) ||
    existing?.integrationPattern ||
    null;
  const adapterChanges = uniqueStrings([...(existing?.adapterChanges || []), ...normalizeStringArray(payload.adapterChanges)]);
  const dependencyChanges = uniqueStrings([...(existing?.dependencyChanges || []), ...normalizeStringArray(payload.dependencyChanges)]);
  const envChanges = uniqueStrings([...(existing?.envChanges || []), ...normalizeStringArray(payload.envChanges)]);
  const touchedFiles = uniqueStrings([...(existing?.touchedFiles || []), ...normalizeStringArray(payload.touchedFiles)]);
  const evidence = mergeMetadata(existing?.evidence, payload.evidence);
  const adoptionType = normalizeAdoptionType(payload.adoptionType || existing?.adoptionType);
  const validatedAt = status === "validated" ? now : existing?.validatedAt || null;

  db.prepare(`
    INSERT INTO module_adoptions (
      id, module_id, module_canonical_key, source_workspace_path, target_project_id, target_workspace_path,
      adoption_key, adoption_type, status, summary, integration_pattern, adapter_changes_json,
      dependency_changes_json, env_changes_json, touched_files_json, evidence_json, latest_run_id,
      implementation_thread_id, last_tool_source, created_at, updated_at, adopted_at, validated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id,
      module_canonical_key = excluded.module_canonical_key,
      source_workspace_path = excluded.source_workspace_path,
      target_project_id = excluded.target_project_id,
      target_workspace_path = excluded.target_workspace_path,
      adoption_key = excluded.adoption_key,
      adoption_type = excluded.adoption_type,
      status = excluded.status,
      summary = excluded.summary,
      integration_pattern = excluded.integration_pattern,
      adapter_changes_json = excluded.adapter_changes_json,
      dependency_changes_json = excluded.dependency_changes_json,
      env_changes_json = excluded.env_changes_json,
      touched_files_json = excluded.touched_files_json,
      evidence_json = excluded.evidence_json,
      latest_run_id = excluded.latest_run_id,
      implementation_thread_id = excluded.implementation_thread_id,
      last_tool_source = excluded.last_tool_source,
      updated_at = excluded.updated_at,
      adopted_at = excluded.adopted_at,
      validated_at = excluded.validated_at
  `).run(
    adoptionId,
    moduleNode.id,
    extractCanonicalKey(moduleNode) || null,
    sourceWorkspacePath,
    targetProjectNode?.id || existing?.targetProjectId || null,
    targetWorkspacePath,
    adoptionKey,
    adoptionType,
    status,
    summary,
    integrationPattern,
    JSON.stringify(adapterChanges),
    JSON.stringify(dependencyChanges),
    JSON.stringify(envChanges),
    JSON.stringify(touchedFiles),
    JSON.stringify(evidence),
    normalizeOptionalText(payload.runId) || existing?.latestRunId || null,
    normalizeOptionalText(payload.implementationThreadId) || existing?.implementationThreadId || null,
    normalizeToolSource(payload.toolSource || existing?.lastToolSource),
    existing?.createdAt || now,
    now,
    existing?.adoptedAt || now,
    validatedAt
  );

  const message =
    normalizeOptionalText(payload.message) ||
    normalizeOptionalText(payload.summary) ||
    normalizeOptionalText(payload.integrationPattern) ||
    `${adoptionType} ${moduleNode.name}`;
  if (message) {
    insertModuleAdoptionEvent(adoptionId, payload.runId, payload.eventKind || (existing ? "update" : "record"), message, {
      status,
      adoptionType,
      integrationPattern,
      adapterChanges,
      dependencyChanges,
      envChanges,
      touchedFiles,
      evidence,
    });
  }

  return getModuleAdoption(adoptionId);
}

function syncModuleAdoptionsFromImplementation(payload = {}, thread) {
  if (!thread) {
    return [];
  }
  const entries = Array.isArray(payload.moduleAdoptions)
    ? payload.moduleAdoptions
    : Array.isArray(payload.metadata?.moduleAdoptions)
      ? payload.metadata.moduleAdoptions
      : [];

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      try {
        return recordModuleAdoption({
          ...entry,
          targetWorkspacePath: entry.targetWorkspacePath || thread.workspacePath,
          implementationThreadId: thread.id,
          taskKey: entry.taskKey || thread.taskKey,
          summary: entry.summary || thread.summary,
          touchedFiles: entry.touchedFiles || thread.touchedFiles,
          status: entry.status || (
            thread.status === "completed"
              ? "validated"
              : thread.status === "failed"
                ? "failed"
                : "integrating"
          ),
          runId: entry.runId || thread.latestRunId,
          toolSource: entry.toolSource || thread.lastToolSource,
          message: entry.message || thread.currentStep || thread.summary,
          eventKind: entry.eventKind || "implementation-sync",
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getModuleVerification(verificationId) {
  const row = db.prepare("SELECT * FROM module_verifications WHERE id = ?").get(verificationId);
  return row ? fromModuleVerificationRow(row) : null;
}

function findModuleVerificationByKey(targetWorkspacePath, verificationKey) {
  const normalizedWorkspace = normalizeWorkspacePath(targetWorkspacePath);
  const normalizedVerificationKey = deriveTaskKeyFromText(verificationKey);
  if (!normalizedWorkspace || !normalizedVerificationKey) {
    return null;
  }
  const row = db
    .prepare("SELECT * FROM module_verifications WHERE target_workspace_path = ? AND verification_key = ?")
    .get(normalizedWorkspace, normalizedVerificationKey);
  return row ? fromModuleVerificationRow(row) : null;
}

function listModuleVerificationEvents(verificationId, limit = 8) {
  return db
    .prepare(`
      SELECT *
      FROM module_verification_events
      WHERE verification_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(verificationId, clampNumber(limit, 8, 1, 50))
    .map(fromModuleVerificationEventRow);
}

function insertModuleVerificationEvent(verificationId, runId, kind, message, payload = {}) {
  db.prepare(`
    INSERT INTO module_verification_events (
      verification_id, run_id, kind, message, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    verificationId,
    normalizeOptionalText(runId),
    kind,
    message,
    nowIso(),
    JSON.stringify(payload || {})
  );
}

function listModuleVerifications(filters = {}) {
  const conditions = [];
  const values = [];
  const moduleId = normalizeOptionalText(filters.moduleId);
  const adoptionId = normalizeOptionalText(filters.adoptionId);
  const targetWorkspacePath = normalizeWorkspacePath(filters.targetWorkspacePath || filters.workspacePath || "");
  const sourceWorkspacePath = normalizeWorkspacePath(filters.sourceWorkspacePath || "");
  const statuses = Array.isArray(filters.statuses)
    ? filters.statuses.map(normalizeVerificationStatus)
    : normalizeOptionalText(filters.status)
      ? [normalizeVerificationStatus(filters.status)]
      : [];
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const limit = clampNumber(filters.limit, 12, 1, 200);

  if (moduleId) {
    conditions.push("module_id = ?");
    values.push(moduleId);
  }
  if (adoptionId) {
    conditions.push("adoption_id = ?");
    values.push(adoptionId);
  }
  if (targetWorkspacePath) {
    conditions.push("target_workspace_path = ?");
    values.push(targetWorkspacePath);
  }
  if (sourceWorkspacePath) {
    conditions.push("source_workspace_path = ?");
    values.push(sourceWorkspacePath);
  }
  if (statuses.length) {
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    values.push(...statuses);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  let rows = db
    .prepare(`
      SELECT *
      FROM module_verifications
      ${whereClause}
      ORDER BY datetime(updated_at) DESC, datetime(verified_at) DESC
      LIMIT ${limit}
    `)
    .all(...values)
    .map(fromModuleVerificationRow);

  if (query) {
    rows = rows.filter((verification) => {
      const haystack = [
        verification.moduleName,
        verification.summary,
        verification.status,
        ...(verification.passedTests || []),
        ...(verification.failedTests || []),
        ...(verification.integrationErrors || []),
        ...(verification.fixPatterns || []),
        ...(verification.verificationNotes || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  return rows;
}

function summarizeModuleVerificationList(verifications = [], targetWorkspacePath = "") {
  const normalizedTarget = normalizeWorkspacePath(targetWorkspacePath || "");
  const passed = verifications.filter((item) => item.status === "passed");
  const failed = verifications.filter((item) => item.status === "failed");
  const mixed = verifications.filter((item) => item.status === "mixed");
  const pending = verifications.filter((item) => ["pending", "flaky"].includes(item.status));
  const crossProjectTargets = new Set(
    verifications
      .map((item) => normalizeWorkspacePath(item.targetWorkspacePath || ""))
      .filter(Boolean)
  );
  const sameTargetCount = normalizedTarget
    ? verifications.filter((item) => normalizeWorkspacePath(item.targetWorkspacePath || "") === normalizedTarget).length
    : 0;

  const countTop = (items) => {
    const counts = new Map();
    items.forEach((item) => {
      const normalized = normalizeOptionalText(item);
      if (!normalized) {
        return;
      }
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  };

  const recentVerifications = [...verifications]
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .slice(0, 4);

  return {
    totalCount: verifications.length,
    passedCount: passed.length,
    failedCount: failed.length,
    mixedCount: mixed.length,
    pendingCount: pending.length,
    sameTargetCount,
    targetProjectCount: crossProjectTargets.size,
    topPassedTests: countTop(verifications.flatMap((item) => item.passedTests || [])),
    topFailedTests: countTop(verifications.flatMap((item) => item.failedTests || [])),
    topIntegrationErrors: countTop(verifications.flatMap((item) => item.integrationErrors || [])),
    topFixPatterns: countTop(verifications.flatMap((item) => item.fixPatterns || [])),
    recentNotes: uniqueStrings(recentVerifications.flatMap((item) => item.verificationNotes || [])).slice(0, 4),
    lastVerifiedAt: verifications
      .map((item) => item.verifiedAt || item.updatedAt)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null,
    lastValidatedAt: passed
      .map((item) => item.validatedAt || item.verifiedAt || item.updatedAt)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null,
    recentVerifications: recentVerifications.map((item) => ({
      id: item.id,
      targetWorkspacePath: item.targetWorkspacePath,
      adoptionId: item.adoptionId,
      status: item.status,
      summary: item.summary,
      updatedAt: item.updatedAt,
    })),
  };
}

function buildModuleVerificationIndex(targetWorkspacePath = "") {
  const groups = new Map();
  listModuleVerifications({ limit: 300 }).forEach((verification) => {
    if (!groups.has(verification.moduleId)) {
      groups.set(verification.moduleId, []);
    }
    groups.get(verification.moduleId).push(verification);
  });

  const index = new Map();
  groups.forEach((items, moduleId) => {
    index.set(moduleId, summarizeModuleVerificationList(items, targetWorkspacePath));
  });
  return index;
}

function recordModuleVerification(payload = {}) {
  const targetWorkspacePath = normalizeWorkspacePath(payload.targetWorkspacePath || payload.workspacePath);
  if (!targetWorkspacePath) {
    throw new Error("targetWorkspacePath la bat buoc.");
  }

  const moduleNode = resolveModuleNodeReference(payload);
  if (!moduleNode) {
    throw new Error("Khong tim thay module de ghi verification memory.");
  }

  const targetProjectNode = ensureProjectNodeForWorkspace(targetWorkspacePath, payload);
  const adoption =
    (normalizeOptionalText(payload.adoptionId) ? getModuleAdoption(payload.adoptionId) : null) ||
    (normalizeOptionalText(payload.adoptionKey) ? findModuleAdoptionByKey(targetWorkspacePath, payload.adoptionKey) : null) ||
    findLatestModuleAdoptionForTarget(moduleNode.id, targetWorkspacePath);
  const existing =
    (normalizeOptionalText(payload.id) ? getModuleVerification(payload.id) : null) ||
    findModuleVerificationByKey(
      targetWorkspacePath,
      payload.verificationKey ||
        payload.taskKey ||
        payload.implementationThreadId ||
        adoption?.adoptionKey ||
        `${moduleNode.id}-${targetWorkspacePath}`
    );
  const sourceWorkspacePath =
    normalizeWorkspacePath(
      payload.sourceWorkspacePath ||
      adoption?.sourceWorkspacePath ||
      extractWorkspaceRootsFromNode(moduleNode)[0] ||
      ""
    ) || null;
  const taskKey = deriveTaskKeyFromText(
    payload.taskKey ||
      payload.implementationThreadId ||
      payload.title ||
      payload.summary ||
      adoption?.adoptionKey ||
      moduleNode.name,
    "module-verification"
  );
  const verificationKey = deriveTaskKeyFromText(
    payload.verificationKey || `${moduleNode.id}-${adoption?.adoptionKey || taskKey}`,
    "module-verification"
  );
  const verificationId =
    normalizeOptionalText(payload.id) ||
    existing?.id ||
    `verification-${sanitizeId(`${targetWorkspacePath}-${verificationKey}`)}`;
  const now = nowIso();
  const status = deriveVerificationStatusFromPayload(payload, existing);
  const passedTests = uniqueStrings([...(existing?.passedTests || []), ...normalizeStringArray(payload.passedTests || payload.passingTests)]);
  const failedTests = uniqueStrings([...(existing?.failedTests || []), ...normalizeStringArray(payload.failedTests)]);
  const integrationErrors = uniqueStrings([...(existing?.integrationErrors || []), ...normalizeStringArray(payload.integrationErrors)]);
  const fixPatterns = uniqueStrings([...(existing?.fixPatterns || []), ...normalizeStringArray(payload.fixPatterns)]);
  const verificationNotes = uniqueStrings([...(existing?.verificationNotes || []), ...normalizeStringArray(payload.verificationNotes)]);
  const evidence = mergeMetadata(existing?.evidence, payload.evidence);
  const summary =
    normalizeOptionalText(payload.summary) ||
    existing?.summary ||
    (passedTests.length
      ? `Verified ${moduleNode.name} in ${path.basename(targetWorkspacePath)} with ${passedTests.length} passing test(s).`
      : failedTests.length || integrationErrors.length
        ? `Captured verification issues for ${moduleNode.name} in ${path.basename(targetWorkspacePath)}.`
        : `Recorded verification state for ${moduleNode.name} in ${path.basename(targetWorkspacePath)}.`);
  const validatedAt = status === "passed" ? now : existing?.validatedAt || null;

  db.prepare(`
    INSERT INTO module_verifications (
      id, module_id, module_canonical_key, adoption_id, source_workspace_path, target_project_id,
      target_workspace_path, verification_key, status, summary, passed_tests_json, failed_tests_json,
      integration_errors_json, fix_patterns_json, verification_notes_json, evidence_json, latest_run_id,
      implementation_thread_id, last_tool_source, created_at, updated_at, verified_at, validated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id,
      module_canonical_key = excluded.module_canonical_key,
      adoption_id = excluded.adoption_id,
      source_workspace_path = excluded.source_workspace_path,
      target_project_id = excluded.target_project_id,
      target_workspace_path = excluded.target_workspace_path,
      verification_key = excluded.verification_key,
      status = excluded.status,
      summary = excluded.summary,
      passed_tests_json = excluded.passed_tests_json,
      failed_tests_json = excluded.failed_tests_json,
      integration_errors_json = excluded.integration_errors_json,
      fix_patterns_json = excluded.fix_patterns_json,
      verification_notes_json = excluded.verification_notes_json,
      evidence_json = excluded.evidence_json,
      latest_run_id = excluded.latest_run_id,
      implementation_thread_id = excluded.implementation_thread_id,
      last_tool_source = excluded.last_tool_source,
      updated_at = excluded.updated_at,
      verified_at = excluded.verified_at,
      validated_at = excluded.validated_at
  `).run(
    verificationId,
    moduleNode.id,
    extractCanonicalKey(moduleNode) || null,
    adoption?.id || existing?.adoptionId || null,
    sourceWorkspacePath,
    targetProjectNode?.id || existing?.targetProjectId || adoption?.targetProjectId || null,
    targetWorkspacePath,
    verificationKey,
    status,
    summary,
    JSON.stringify(passedTests),
    JSON.stringify(failedTests),
    JSON.stringify(integrationErrors),
    JSON.stringify(fixPatterns),
    JSON.stringify(verificationNotes),
    JSON.stringify(evidence),
    normalizeOptionalText(payload.runId) || existing?.latestRunId || null,
    normalizeOptionalText(payload.implementationThreadId) || existing?.implementationThreadId || null,
    normalizeToolSource(payload.toolSource || existing?.lastToolSource),
    existing?.createdAt || now,
    now,
    now,
    validatedAt
  );

  const message =
    normalizeOptionalText(payload.message) ||
    normalizeOptionalText(payload.summary) ||
    (passedTests.length
      ? `Verified with passing tests: ${passedTests.slice(0, 2).join(", ")}`
      : integrationErrors.length
        ? `Integration issues: ${integrationErrors.slice(0, 2).join(", ")}`
        : status);

  insertModuleVerificationEvent(
    verificationId,
    payload.runId,
    payload.eventKind || "verification-recorded",
    message,
    {
      status,
      summary,
      passedTests,
      failedTests,
      integrationErrors,
      fixPatterns,
      verificationNotes,
      adoptionId: adoption?.id || null,
      evidence,
    }
  );

  return getModuleVerification(verificationId);
}

function syncModuleVerificationsFromImplementation(payload = {}, thread) {
  if (!thread) {
    return [];
  }
  const entries = Array.isArray(payload.moduleVerifications)
    ? payload.moduleVerifications
    : Array.isArray(payload.metadata?.moduleVerifications)
      ? payload.metadata.moduleVerifications
      : [];

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object" || !hasVerificationSignals(entry)) {
        return null;
      }
      try {
        return recordModuleVerification({
          ...entry,
          targetWorkspacePath: entry.targetWorkspacePath || thread.workspacePath,
          implementationThreadId: thread.id,
          taskKey: entry.taskKey || thread.taskKey,
          summary: entry.summary || thread.summary,
          runId: entry.runId || thread.latestRunId,
          toolSource: entry.toolSource || thread.lastToolSource,
          message: entry.message || thread.currentStep || thread.summary,
          implementationStatus:
            entry.implementationStatus ||
            (thread.status === "completed" ? "completed" : thread.status === "failed" ? "failed" : null),
          eventKind: entry.eventKind || "implementation-sync",
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getModuleVerificationMemory(filters = {}) {
  const verifications = listModuleVerifications({
    moduleId: filters.moduleId,
    adoptionId: filters.adoptionId,
    targetWorkspacePath: filters.targetWorkspacePath || filters.workspacePath,
    sourceWorkspacePath: filters.sourceWorkspacePath,
    status: filters.status,
    statuses: filters.statuses,
    query: filters.query,
    limit: clampNumber(filters.limit, 8, 1, 80),
  });
  const summary = summarizeModuleVerificationList(verifications, filters.targetWorkspacePath || filters.workspacePath || "");

  return {
    filters: {
      moduleId: normalizeOptionalText(filters.moduleId) || null,
      adoptionId: normalizeOptionalText(filters.adoptionId) || null,
      targetWorkspacePath: normalizeWorkspacePath(filters.targetWorkspacePath || filters.workspacePath || "") || null,
      sourceWorkspacePath: normalizeWorkspacePath(filters.sourceWorkspacePath || "") || null,
      query: normalizeOptionalText(filters.query) || null,
    },
    summary,
    count: verifications.length,
    verifications: verifications.map((verification) => ({
      id: verification.id,
      moduleId: verification.moduleId,
      moduleName: verification.moduleName,
      adoptionId: verification.adoptionId,
      targetWorkspacePath: verification.targetWorkspacePath,
      status: verification.status,
      summary: verification.summary,
      passedTests: verification.passedTests.slice(0, 6),
      failedTests: verification.failedTests.slice(0, 6),
      integrationErrors: verification.integrationErrors.slice(0, 6),
      fixPatterns: verification.fixPatterns.slice(0, 6),
      verificationNotes: verification.verificationNotes.slice(0, 4),
      updatedAt: verification.updatedAt,
    })),
    tokenEstimate: estimateContextTokens({
      summary,
      verifications: verifications.slice(0, 4).map((verification) => ({
        id: verification.id,
        moduleId: verification.moduleId,
        status: verification.status,
        passedTests: verification.passedTests.slice(0, 3),
        integrationErrors: verification.integrationErrors.slice(0, 2),
        fixPatterns: verification.fixPatterns.slice(0, 2),
      })),
    }),
  };
}

function getModuleAdoptionMemory(filters = {}) {
  const adoptions = listModuleAdoptions({
    moduleId: filters.moduleId,
    targetWorkspacePath: filters.targetWorkspacePath || filters.workspacePath,
    sourceWorkspacePath: filters.sourceWorkspacePath,
    status: filters.status,
    statuses: filters.statuses,
    query: filters.query,
    limit: clampNumber(filters.limit, 8, 1, 80),
  });
  const summary = summarizeModuleAdoptionList(adoptions, filters.targetWorkspacePath || filters.workspacePath || "");

  return {
    filters: {
      moduleId: normalizeOptionalText(filters.moduleId) || null,
      targetWorkspacePath: normalizeWorkspacePath(filters.targetWorkspacePath || filters.workspacePath || "") || null,
      sourceWorkspacePath: normalizeWorkspacePath(filters.sourceWorkspacePath || "") || null,
      query: normalizeOptionalText(filters.query) || null,
    },
    summary,
    count: adoptions.length,
    adoptions: adoptions.map((adoption) => ({
      id: adoption.id,
      moduleId: adoption.moduleId,
      moduleName: adoption.moduleName,
      targetWorkspacePath: adoption.targetWorkspacePath,
      adoptionType: adoption.adoptionType,
      status: adoption.status,
      summary: adoption.summary,
      integrationPattern: adoption.integrationPattern,
      adapterChanges: adoption.adapterChanges.slice(0, 6),
      dependencyChanges: adoption.dependencyChanges.slice(0, 6),
      envChanges: adoption.envChanges.slice(0, 6),
      touchedFiles: adoption.touchedFiles.slice(0, 6),
      updatedAt: adoption.updatedAt,
    })),
    tokenEstimate: estimateContextTokens({
      summary,
      adoptions: adoptions.slice(0, 4).map((adoption) => ({
        id: adoption.id,
        moduleId: adoption.moduleId,
        status: adoption.status,
        integrationPattern: adoption.integrationPattern,
      })),
    }),
  };
}

function formatTopCountItems(items = [], prefix) {
  return items
    .filter((item) => item?.value)
    .map((item) => `${prefix}${item.value}${item.count > 1 ? ` (${item.count}x)` : ""}`);
}

function buildRecipeStepList(items = []) {
  return uniqueStrings(
    items
      .map((item) => normalizeOptionalText(item))
      .filter(Boolean)
  ).slice(0, 6);
}

function buildAdoptionRecipe(payload = {}) {
  const moduleNode = resolveModuleNodeReference(payload);
  if (!moduleNode) {
    throw new Error("Khong tim thay module de tao adoption recipe.");
  }

  const targetWorkspacePath = normalizeWorkspacePath(payload.targetWorkspacePath || payload.workspacePath);
  if (!targetWorkspacePath) {
    throw new Error("targetWorkspacePath la bat buoc.");
  }

  const profile = buildProjectProfile(targetWorkspacePath, payload);
  const memory = getModuleAdoptionMemory({
    moduleId: moduleNode.id,
    targetWorkspacePath,
    limit: clampNumber(payload.limit, 8, 1, 40),
  });
  const verificationMemory = getModuleVerificationMemory({
    moduleId: moduleNode.id,
    targetWorkspacePath,
    limit: clampNumber(payload.limit, 8, 1, 40),
  });
  const moduleCapabilities = extractCapabilitiesFromNode(moduleNode);
  const integrationHint = extractContextDetail(moduleNode, "Integration hint");
  const entryPath = extractContextDetail(moduleNode, "Entry path") || moduleNode.files?.[0] || "";
  const envVars = extractContextList(moduleNode, "Env vars");
  const configKeys = extractContextList(moduleNode, "Config keys");
  const dependencies = extractContextList(moduleNode, "Dependencies");
  const reuseRecommendation = extractContextDetail(moduleNode, "Reuse recommendation") || null;
  const adapterBoundary = extractContextDetail(moduleNode, "Adapter boundary") || null;
  const recentPattern = memory.summary.recentPatterns[0] || null;
  const dependencyOverlap = dependencies.filter((dep) => profile.dependencies.includes(dep) || profile.peerDependencies.includes(dep));
  const missingDependencies = dependencies.filter((dep) => !dependencyOverlap.includes(dep)).slice(0, 6);

  const prepare = buildRecipeStepList([
    `Open module entry at ${entryPath}.`,
    integrationHint ? `Start from the module hint: ${integrationHint}` : null,
    recentPattern ? `Prefer the validated pattern: ${recentPattern}` : null,
    dependencyOverlap.length ? `Keep existing deps already present: ${dependencyOverlap.join(", ")}.` : null,
    missingDependencies.length ? `Check whether these deps must be added or wrapped: ${missingDependencies.join(", ")}.` : null,
    ...formatTopCountItems(memory.summary.topDependencyChanges, "Dependency pattern: "),
  ]);

  const integrate = buildRecipeStepList([
    recentPattern ? `Integrate via this pattern: ${recentPattern}` : null,
    ...formatTopCountItems(memory.summary.topAdapterChanges, "Adapter change: "),
    envVars.length ? `Map env vars: ${envVars.join(", ")}.` : null,
    configKeys.length ? `Map config keys: ${configKeys.join(", ")}.` : null,
    ...formatTopCountItems(memory.summary.topEnvChanges, "Env/config pattern: "),
    adapterBoundary ? `Keep adapter boundary ${adapterBoundary} by isolating project-specific wiring.` : null,
  ]);

  const verify = buildRecipeStepList([
    `Smoke test the adopted ${moduleNode.name} flow in ${path.basename(targetWorkspacePath)}.`,
    memory.summary.validatedCount ? `Compare against ${memory.summary.validatedCount} previously validated adoption(s).` : null,
    ...formatTopCountItems(verificationMemory.summary.topPassedTests, "Previously passed test: "),
    ...formatTopCountItems(verificationMemory.summary.topIntegrationErrors, "Common integration error: "),
    ...formatTopCountItems(verificationMemory.summary.topFixPatterns, "Effective fix pattern: "),
    reuseRecommendation ? `Validate that the resulting integration still fits ${reuseRecommendation}.` : null,
    verificationMemory.summary.lastValidatedAt
      ? `Latest passing verification was recorded at ${verificationMemory.summary.lastValidatedAt}.`
      : null,
    memory.summary.lastValidatedAt ? `Latest validated adoption was recorded at ${memory.summary.lastValidatedAt}.` : null,
  ]);

  const checklist = [...prepare, ...integrate, ...verify].slice(0, 10);
  const confidence =
    memory.summary.validatedCount >= 2 ? "high" : memory.summary.validatedCount === 1 ? "medium" : "low";
  const strategy =
    memory.summary.validatedCount > 0
      ? "follow-validated-pattern"
      : reuseRecommendation === "ready-to-copy"
        ? "copy-with-light-adapters"
        : "adapt-from-module-card";

  return {
    moduleId: moduleNode.id,
    moduleName: moduleNode.name,
    targetWorkspacePath,
    strategy,
    confidence,
    summary: recentPattern
      ? `Reuse ${moduleNode.name} by following the validated integration pattern first, then apply target-specific adapter/env adjustments.`
      : `Reuse ${moduleNode.name} from its module card and dependency/env signals, then validate integration in the target workspace.`,
    checklist,
    sections: {
      prepare,
      integrate,
      verify,
    },
    sourceSignals: {
      capabilities: moduleCapabilities,
      reuseRecommendation,
      adapterBoundary,
      validatedAdoptions: memory.summary.validatedCount,
      passedVerifications: verificationMemory.summary.passedCount,
      targetProjectCount: memory.summary.targetProjectCount,
      recentPatterns: memory.summary.recentPatterns,
    },
    supportingAdoptions: memory.adoptions.slice(0, 3),
    supportingVerifications: verificationMemory.verifications.slice(0, 3),
    tokenEstimate: estimateContextTokens({
      checklist,
      sections: {
        prepare,
        integrate,
        verify,
      },
      sourceSignals: {
        capabilities: moduleCapabilities,
        reuseRecommendation,
        adapterBoundary,
        validatedAdoptions: memory.summary.validatedCount,
        passedVerifications: verificationMemory.summary.passedCount,
      },
    }),
  };
}

function loadProjectPipelineSnapshot(workspacePath, options = {}) {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath || "");
  if (!normalizedWorkspace) {
    throw new Error("workspacePath la bat buoc.");
  }
  const maxDepth = clampNumber(options.maxDepth, 5, 1, 8);
  const maxFiles = clampNumber(options.maxFiles, 260, 40, 2000);
  const cachedPipeline = getPipelineCache(normalizedWorkspace, maxDepth, maxFiles);
  const pipeline = cachedPipeline || scanProjectPipeline(normalizedWorkspace, { maxDepth, maxFiles });
  if (!cachedPipeline) {
    savePipelineCache(normalizedWorkspace, maxDepth, maxFiles, pipeline);
  }
  return {
    workspacePath: normalizedWorkspace,
    maxDepth,
    maxFiles,
    pipeline,
  };
}

function pickTargetSourcePrefix(pipeline) {
  const relativePaths = (pipeline.nodes || []).map((node) => String(node.relativePath || "").replaceAll("\\", "/"));
  if (relativePaths.some((entry) => entry.startsWith("src/"))) {
    return "src";
  }
  return "";
}

function getPipelineRelativePaths(pipeline) {
  return (pipeline.nodes || []).map((node) => String(node.relativePath || "").replaceAll("\\", "/"));
}

function buildProjectDependencySet(profile = {}) {
  return new Set(
    uniqueStrings([
      ...normalizeStringArray(profile.dependencies),
      ...normalizeStringArray(profile.peerDependencies),
      ...normalizeStringArray(profile.devDependencies),
    ]).map((entry) => entry.toLowerCase())
  );
}

function detectProjectFrameworkKind(profile = {}, pipeline = {}) {
  const relativePaths = getPipelineRelativePaths(pipeline);
  const dependencies = buildProjectDependencySet(profile);
  const adapters = new Set(normalizeStringArray(profile.frameworkAdapters).map((entry) => entry.toLowerCase()));

  if (
    dependencies.has("next") ||
    relativePaths.some((entry) =>
      entry.startsWith("app/") ||
      entry.startsWith("src/app/") ||
      entry.startsWith("pages/") ||
      entry.startsWith("src/pages/")
    )
  ) {
    return "nextjs";
  }

  if (
    dependencies.has("react-native") ||
    dependencies.has("expo") ||
    ((dependencies.has("react") || adapters.has("react")) && relativePaths.some((entry) =>
      /(^|\/)App\.(tsx|jsx)$/i.test(entry) ||
      entry.startsWith("src/screens/") ||
      entry.startsWith("screens/")
    ))
  ) {
    return "react-native";
  }

  if (dependencies.has("@nestjs/core") || dependencies.has("@nestjs/common") || adapters.has("nest")) {
    return "nest";
  }

  if (dependencies.has("express") || dependencies.has("fastify") || adapters.has("express")) {
    return "express";
  }

  if (dependencies.has("react") || adapters.has("react")) {
    return "react";
  }

  return "generic";
}

function getFrameworkDisplayName(kind) {
  switch (kind) {
    case "nextjs":
      return "Next.js";
    case "react-native":
      return "React Native";
    case "nest":
      return "NestJS";
    case "express":
      return "Express";
    case "react":
      return "React";
    default:
      return "Generic";
  }
}

function isUiCapability(capability) {
  return ["camera", "scanner", "map", "chart"].includes(sanitizeCapability(capability || ""));
}

function isServerCapability(capability) {
  return ["auth", "ocr", "payment", "upload", "file-upload"].includes(sanitizeCapability(capability || ""));
}

function buildFrameworkContext(profile, pipeline, moduleNode) {
  const kind = detectProjectFrameworkKind(profile, pipeline);
  const primaryCapability = getPrimaryCapabilityForModule(moduleNode);
  const uiCapability = isUiCapability(primaryCapability);
  const serverCapability = isServerCapability(primaryCapability);
  let wiringTarget = "app-entry";
  let wiringStrategy = "Wire the adopted module through the closest existing app entry or barrel file.";

  if (kind === "nextjs") {
    wiringTarget = uiCapability ? "next-page" : "next-api-route";
    wiringStrategy = uiCapability
      ? "Prefer a page or layout entry so the adopted UI becomes visible in the App Router or Pages Router."
      : "Prefer a route handler under app/api or pages/api so server-side behavior lands in a Next-native boundary.";
  } else if (kind === "express") {
    wiringTarget = "express-router";
    wiringStrategy = "Prefer an app/server entry or route index so the module is mounted through Express routing instead of a generic barrel.";
  } else if (kind === "nest") {
    wiringTarget = "nest-module";
    wiringStrategy = "Prefer a Nest module or app.module registration so providers and exports follow Nest conventions.";
  } else if (kind === "react-native") {
    wiringTarget = "react-native-app";
    wiringStrategy = "Prefer App.tsx or a navigation/screen entry so the adopted module is reachable from the native app shell.";
  } else if (kind === "react") {
    wiringTarget = "react-app";
    wiringStrategy = "Prefer App/main/page-style entry files so the adopted module is exposed through the React tree.";
  }

  return {
    kind,
    displayName: getFrameworkDisplayName(kind),
    primaryCapability,
    uiCapability,
    serverCapability,
    wiringTarget,
    wiringStrategy,
    relativeNodes: getPipelineRelativePaths(pipeline),
  };
}

function pickRelativeProjectPath(workspacePath, relativeNodes, candidates = [], fallback = "") {
  const normalizedNodes = new Set(relativeNodes.map((entry) => String(entry || "").replaceAll("\\", "/")));
  const normalizedCandidates = uniqueStrings(
    candidates
      .map((entry) => normalizeOptionalText(entry))
      .filter(Boolean)
      .map((entry) => entry.replaceAll("\\", "/"))
  );
  const match = normalizedCandidates.find((entry) => normalizedNodes.has(entry) || fs.existsSync(path.join(workspacePath, entry)));
  return match || normalizedCandidates.find(Boolean) || fallback;
}

function getSourceBucketFromModule(moduleNode) {
  const moduleRoot = extractContextDetail(moduleNode, "Module root") || "";
  const entryPath = extractContextDetail(moduleNode, "Entry path") || moduleNode.files?.[0] || "";
  const normalizedRoot = moduleRoot.replaceAll("\\", "/");
  if (normalizedRoot) {
    const segments = normalizedRoot.split("/").filter(Boolean);
    if (segments[0] === "src" && segments[1]) {
      return segments[1];
    }
    if (segments[0]) {
      return segments[0];
    }
  }
  const extless = path.basename(entryPath, path.extname(entryPath));
  const guessed = deriveModuleRootFromRelativePath(extless) || "";
  return guessed.split("/")[0] || "";
}

function getPrimaryCapabilityForModule(moduleNode) {
  return extractCapabilitiesFromNode(moduleNode)[0] || sanitizeCapability(moduleNode.name || "") || "module";
}

function buildTargetBaseDir(workspacePath, pipeline, moduleNode, frameworkContext = null) {
  const prefix = pickTargetSourcePrefix(pipeline);
  const sourceBucket = getSourceBucketFromModule(moduleNode);
  const primaryCapability = getPrimaryCapabilityForModule(moduleNode);
  const normalizedNodes = getPipelineRelativePaths(pipeline);
  const frameworkKind = frameworkContext?.kind || "generic";
  const uiCapability = frameworkContext?.uiCapability || isUiCapability(primaryCapability);
  let candidateBuckets = [];

  if (frameworkKind === "nextjs") {
    candidateBuckets = [
      sourceBucket,
      uiCapability ? "components" : "lib",
      uiCapability ? "features" : "services",
      uiCapability ? "app" : "server",
      "lib",
    ];
  } else if (frameworkKind === "react-native") {
    candidateBuckets = [
      sourceBucket,
      uiCapability ? "components" : "services",
      uiCapability ? "screens" : "features",
      "lib",
    ];
  } else if (frameworkKind === "nest") {
    candidateBuckets = [
      sourceBucket,
      primaryCapability,
      "modules",
      "services",
      "common",
    ];
  } else if (frameworkKind === "express") {
    candidateBuckets = [
      sourceBucket,
      primaryCapability === "auth" ? "services" : "",
      "services",
      "controllers",
      "lib",
    ];
  } else if (frameworkKind === "react") {
    candidateBuckets = [
      sourceBucket,
      uiCapability ? "components" : "services",
      "hooks",
      "lib",
    ];
  } else {
    candidateBuckets = [
      sourceBucket,
      primaryCapability === "auth" ? "services" : "",
      primaryCapability === "camera" || primaryCapability === "scanner" ? "components" : "",
      primaryCapability === "map" ? "components" : "",
      "lib",
    ];
  }

  candidateBuckets = uniqueStrings(candidateBuckets);

  const preferredBucket =
    candidateBuckets.find((bucket) => bucket && normalizedNodes.some((entry) => entry.startsWith(`${prefix ? `${prefix}/` : ""}${bucket}/`))) ||
    candidateBuckets.find(Boolean) ||
    "lib";

  const baseDir = prefix ? path.join(workspacePath, prefix, preferredBucket) : path.join(workspacePath, preferredBucket);
  return {
    prefix,
    bucket: preferredBucket,
    baseDir,
  };
}

function buildExecutionPatchPlan(recipe, profile, pipeline, moduleNode) {
  const targetWorkspacePath = profile.workspacePath;
  const entryPath = extractContextDetail(moduleNode, "Entry path") || moduleNode.files?.[0] || "";
  const ext = path.extname(entryPath) || ".ts";
  const baseName = path.basename(entryPath, ext) || sanitizeId(moduleNode.name || "module");
  const frameworkContext = buildFrameworkContext(profile, pipeline, moduleNode);
  const scriptExt = getScriptExtension(ext);
  const componentExt = getComponentExtension(ext);
  const entryExt =
    frameworkContext.uiCapability && ["nextjs", "react-native", "react"].includes(frameworkContext.kind)
      ? componentExt
      : frameworkContext.kind === "nest"
        ? scriptExt
        : ext;
  const entryFileName =
    frameworkContext.kind === "nest" && !frameworkContext.uiCapability
      ? `${toKebabCase(baseName)}.service${scriptExt}`
      : `${baseName}${entryExt}`;
  const baseDirInfo = buildTargetBaseDir(targetWorkspacePath, pipeline, moduleNode, frameworkContext);
  const adapterBoundary = extractContextDetail(moduleNode, "Adapter boundary") || "low";
  const envVars = extractContextList(moduleNode, "Env vars");
  const configKeys = extractContextList(moduleNode, "Config keys");
  const primaryCapability = getPrimaryCapabilityForModule(moduleNode);
  const relativeNodes = frameworkContext.relativeNodes;
  const packageJsonPath = path.join(targetWorkspacePath, "package.json");
  const prefixPath = baseDirInfo.prefix ? `${baseDirInfo.prefix}/` : "";
  const targetEntryPath = path.join(baseDirInfo.baseDir, entryFileName);
  const adapterDirRelative = pickRelativeProjectPath(
    targetWorkspacePath,
    relativeNodes,
    frameworkContext.kind === "nest"
      ? [`${prefixPath}${primaryCapability}/adapters`, `${prefixPath}adapters`, "adapters"]
      : frameworkContext.kind === "react-native"
        ? [`${prefixPath}adapters`, `${prefixPath}services`, "adapters"]
        : [`${prefixPath}adapters`, "adapters"],
    `${prefixPath}adapters`
  );
  const adapterDir = path.join(targetWorkspacePath, adapterDirRelative);
  const adapterPath = path.join(adapterDir, `${baseName}Adapter${ext}`);
  const configDirRelative = pickRelativeProjectPath(
    targetWorkspacePath,
    relativeNodes,
    frameworkContext.kind === "nextjs"
      ? [`${prefixPath}lib`, `${prefixPath}config`, "config"]
      : frameworkContext.kind === "nest"
        ? [`${prefixPath}config`, `${prefixPath}common/config`, "config"]
        : [`${prefixPath}config`, "config", `${prefixPath}lib`],
    `${prefixPath}config`
  );
  const configDir = path.join(targetWorkspacePath, configDirRelative);
  const configExt = frameworkContext.kind === "nextjs" || frameworkContext.kind === "nest" ? scriptExt : ext;
  const configFileName =
    frameworkContext.kind === "nest"
      ? `${toKebabCase(primaryCapability)}.config${scriptExt}`
      : `${primaryCapability}${configExt}`;
  const configPath = path.join(configDir, configFileName);
  const smokeDirRelative = pickRelativeProjectPath(
    targetWorkspacePath,
    relativeNodes,
    frameworkContext.kind === "nest"
      ? ["test", `${prefixPath}__tests__`]
      : [`${prefixPath}__tests__`, "__tests__", `${prefixPath}tests`],
    frameworkContext.kind === "nest" ? "test" : `${prefixPath}__tests__`
  );
  const smokeDir = path.join(targetWorkspacePath, smokeDirRelative);
  const smokeExt = frameworkContext.uiCapability ? componentExt : scriptExt;
  const smokeFileName =
    frameworkContext.kind === "nest"
      ? `${toKebabCase(baseName)}.adoption.spec${scriptExt}`
      : `${baseName}.adoption.test${smokeExt === ".py" ? ".py" : smokeExt}`;
  const smokePath = path.join(smokeDir, smokeFileName);
  const barrelPath = path.join(baseDirInfo.baseDir, `index${entryExt}`);
  const wiringRelativeCandidates =
    frameworkContext.kind === "nextjs"
      ? frameworkContext.uiCapability
        ? [
            `${prefixPath}app/${primaryCapability}/page${componentExt}`,
            `${prefixPath}app/page${componentExt}`,
            `${prefixPath}app/layout${componentExt}`,
            `${prefixPath}pages/index${componentExt}`,
            `${prefixPath}pages/_app${componentExt}`,
          ]
        : [
            `${prefixPath}app/api/${primaryCapability}/route${scriptExt}`,
            `${prefixPath}pages/api/${primaryCapability}${scriptExt}`,
            `${prefixPath}pages/api/${primaryCapability}/index${scriptExt}`,
            `${prefixPath}app/page${componentExt}`,
          ]
      : frameworkContext.kind === "express"
        ? [
            `${prefixPath}routes/${primaryCapability}${scriptExt}`,
            `${prefixPath}routes/index${scriptExt}`,
            `${prefixPath}app${scriptExt}`,
            `${prefixPath}server${scriptExt}`,
            `app${scriptExt}`,
            `server${scriptExt}`,
          ]
        : frameworkContext.kind === "nest"
          ? [
              `${prefixPath}${primaryCapability}/${toKebabCase(primaryCapability)}.module${scriptExt}`,
              `${prefixPath}app.module${scriptExt}`,
            ]
          : frameworkContext.kind === "react-native"
            ? [
                "App.tsx",
                "App.jsx",
                `${prefixPath}App${componentExt}`,
                `${prefixPath}navigation/index${componentExt}`,
                `${prefixPath}screens/${baseName}${componentExt}`,
              ]
            : frameworkContext.kind === "react"
              ? [
                  `${prefixPath}App${componentExt}`,
                  `App${componentExt}`,
                  `${prefixPath}main${componentExt}`,
                  `${prefixPath}pages/index${componentExt}`,
                ]
              : relativeNodes.filter((entry) => /(^|\/)(app|main|index|routes?|router)\./i.test(entry) || /(^|\/)(app|main|index|routes?|router)\//i.test(entry)).slice(0, 4);
  const wiringRelativePath =
    frameworkContext.kind === "nextjs" && !frameworkContext.uiCapability
      ? pickRelativeProjectPath(
          targetWorkspacePath,
          relativeNodes,
          wiringRelativeCandidates.slice(0, 3),
          wiringRelativeCandidates[0]
        )
      : pickRelativeProjectPath(
          targetWorkspacePath,
          relativeNodes,
          wiringRelativeCandidates,
          path.relative(targetWorkspacePath, barrelPath).replaceAll("\\", "/")
        );
  const wiringPath = path.join(targetWorkspacePath, wiringRelativePath);

  const patchPlan = [];
  const push = (role, action, filePath, intent, reason) => {
    patchPlan.push({
      order: patchPlan.length + 1,
      role,
      action,
      filePath,
      intent,
      reason,
    });
  };

  push(
    "dependencies",
    "modify",
    packageJsonPath,
    "Add or confirm required dependencies before any code moves.",
    "Dependency alignment avoids writing integration code against missing packages."
  );
  push(
    "module-entry",
    fs.existsSync(targetEntryPath) ? "modify" : "create",
    targetEntryPath,
    `Bring ${moduleNode.name} into the target codebase at the most compatible bucket.`,
    "This is the primary target file and should anchor the adoption first."
  );
  if (recipe.strategy !== "copy-with-light-adapters" || adapterBoundary !== "low" || recipe.sections.integrate.some((item) => /Adapter change:/i.test(item))) {
    push(
      "adapter",
      fs.existsSync(adapterPath) ? "modify" : "create",
      adapterPath,
      "Wrap source-specific behavior behind a local adapter boundary.",
      "Starting with a dedicated adapter keeps project-specific wiring isolated and matches the adoption recipe."
    );
  }
  if (envVars.length || configKeys.length || recipe.sections.integrate.some((item) => /Env\/config pattern:/i.test(item))) {
    push(
      "config",
      fs.existsSync(configPath) ? "modify" : "create",
      configPath,
      "Map env/config requirements into the target project's configuration layer.",
      "Config translation is a common integration failure point, so capture it explicitly."
    );
  }
  push(
    "wiring",
    fs.existsSync(wiringPath) ? "modify" : "create",
    wiringPath,
    "Wire the adopted module into the app entrypoint, route layer, or export barrel.",
    "The adopted module is only usable after the target project imports and exposes it."
  );
  push(
    "verify",
    fs.existsSync(smokePath) ? "modify" : "create",
    smokePath,
    "Add a smoke test or execution check that proves the adopted flow still works.",
    "Verification should be codified so future adoptions can trust this pattern."
  );

  return {
    frameworkContext,
    startHere: patchPlan[0] || null,
    targetBaseDir: baseDirInfo.baseDir,
    targetEntryPath,
    adapterPath,
    configPath,
    wiringPath,
    smokePath,
    patchPlan,
  };
}

function toPascalCase(value) {
  const parts = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!parts.length) {
    return "Module";
  }
  return parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("");
}

function toCamelCase(value) {
  const pascal = toPascalCase(value);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

function toKebabCase(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "module";
}

function getComponentExtension(ext) {
  return ext === ".js" || ext === ".jsx" ? ".jsx" : ".tsx";
}

function getScriptExtension(ext) {
  if (ext === ".tsx") {
    return ".ts";
  }
  if (ext === ".jsx") {
    return ".js";
  }
  return ext || ".ts";
}

function getLanguageFromPath(filePath) {
  switch (path.extname(filePath || "").toLowerCase()) {
    case ".ts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".js":
      return "js";
    case ".jsx":
      return "jsx";
    case ".json":
      return "json";
    case ".py":
      return "py";
    case ".md":
      return "md";
    default:
      return "txt";
  }
}

function getCommentPrefix(language) {
  if (language === "py") {
    return "#";
  }
  if (language === "json") {
    return "";
  }
  return "//";
}

function maybeComment(prefix, text) {
  if (!text) {
    return null;
  }
  return prefix ? `${prefix} ${text}` : text;
}

function buildPatchDraftChecklist(items = []) {
  return uniqueStrings(
    items
      .map((item) => normalizeOptionalText(item))
      .filter(Boolean)
  ).slice(0, 6);
}

function normalizeImportPath(importPath) {
  const normalized = String(importPath || "").replaceAll("\\", "/").replace(/\.(tsx?|jsx?|py)$/i, "");
  if (!normalized) {
    return "./module";
  }
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function buildPatchDraftSnippet(payload = {}) {
  const language = payload.language || "txt";
  const prefix = getCommentPrefix(language);
  const moduleExportName = toPascalCase(payload.baseName || payload.moduleName || "Module");
  const moduleFactoryName =
    payload.primaryCapability === "auth"
      ? `create${moduleExportName}`
      : payload.primaryCapability === "camera" || payload.primaryCapability === "scanner"
        ? `mount${moduleExportName}`
        : `setup${moduleExportName}`;
  const adapterFactoryName = `create${moduleExportName}Adapter`;
  const moduleImportPath = payload.moduleImportPath || "./module";
  const adapterImportPath = payload.adapterImportPath || "./adapter";
  const dependencyNames = payload.missingDependencies?.length
    ? payload.missingDependencies
    : payload.dependencies?.slice(0, 2) || [];
  const exportedRef = toCamelCase(moduleExportName);
  const frameworkKind = payload.frameworkKind || "generic";
  const wiringTarget = payload.wiringTarget || "app-entry";
  const uiCapability = Boolean(payload.uiCapability);

  if (payload.role === "dependencies") {
    const dependencies = dependencyNames.length
      ? Object.fromEntries(dependencyNames.map((dependency) => [dependency, "<version>"]))
      : { "<dependency-name>": "<version>" };
    return {
      language: "json",
      content: `${JSON.stringify({ dependencies }, null, 2)}\n`,
    };
  }

  if (payload.role === "module-entry") {
    if (frameworkKind === "nest") {
      const serviceName = /Service$/i.test(moduleExportName) ? moduleExportName : `${moduleExportName}Service`;
      return {
        language: scriptExtFromLanguage(language),
        content: [
          maybeComment(prefix, `NestJS service scaffold for ${payload.moduleName}.`),
          'import { Injectable } from "@nestjs/common";',
          `import { ${adapterFactoryName} } from "${adapterImportPath}";`,
          "",
          "@Injectable()",
          `export class ${serviceName} {`,
          "  constructor() {",
          `    this.adapter = ${adapterFactoryName}();`,
          "  }",
          "",
          "  adapter;",
          "",
          "  execute() {",
          "    // TODO: Port the validated source flow into this service.",
          "    return this.adapter;",
          "  }",
          "}",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (uiCapability && (language === "tsx" || language === "jsx")) {
      return {
        language,
        content: [
          maybeComment(prefix, `UI scaffold for adopting ${payload.moduleName} in a ${payload.frameworkDisplayName || "UI"} project.`),
          `export function ${moduleExportName}() {`,
          "  // TODO: Port the validated visual flow into this component.",
          "  return null;",
          "}",
          "",
          `export default ${moduleExportName};`,
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (language === "py") {
      return {
        language,
        content: [
          maybeComment(prefix, `Draft scaffold for adopting ${payload.moduleName}.`),
          `from ${adapterImportPath.replaceAll("/", ".").replace(/^\.+/, "")} import ${adapterFactoryName}`,
          "",
          `def ${toCamelCase(moduleFactoryName)}(options=None):`,
          "    options = options or {}",
          `    adapter = ${adapterFactoryName}(options)`,
          "    # TODO: Port the validated source flow into this target module.",
          "    return {",
          '        "adapter": adapter,',
          "    }",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    return {
      language,
      content: [
        maybeComment(prefix, `Draft scaffold for adopting ${payload.moduleName}.`),
        `import { ${adapterFactoryName} } from "${adapterImportPath}";`,
        "",
        `export function ${moduleFactoryName}(options = {}) {`,
        `  const adapter = ${adapterFactoryName}(options);`,
        "  // TODO: Port the validated source flow into this target module.",
        "  return {",
        "    adapter,",
        "  };",
        "}",
        "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (payload.role === "adapter") {
    if (frameworkKind === "nest") {
      return {
        language: scriptExtFromLanguage(language),
        content: [
          maybeComment(prefix, `NestJS adapter boundary for ${payload.moduleName}.`),
          'import { Injectable } from "@nestjs/common";',
          "",
          "@Injectable()",
          `export class ${adapterFactoryName} {`,
          "  constructor(options = {}) {",
          "    this.transport = options.transport;",
          "    this.logger = options.logger;",
          "  }",
          "",
          "  transport;",
          "",
          "  logger;",
          "}",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (language === "py") {
      return {
        language,
        content: [
          maybeComment(prefix, `Local adapter boundary for ${payload.moduleName}.`),
          `def ${adapterFactoryName}(options=None):`,
          "    options = options or {}",
          "    return {",
          '        "transport": options.get("transport"),',
          '        "logger": options.get("logger"),',
          "    }",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    return {
      language,
      content: [
        maybeComment(prefix, `Local adapter boundary for ${payload.moduleName}.`),
        `export function ${adapterFactoryName}(options = {}) {`,
        "  return {",
        "    transport: options.transport,",
        "    logger: options.logger,",
        "  };",
        "}",
        "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (payload.role === "config") {
    if (frameworkKind === "nest") {
      return {
        language: scriptExtFromLanguage(language),
        content: [
          maybeComment(prefix, `NestJS config factory for ${payload.moduleName}.`),
          "export default () => ({",
          `  ${toCamelCase(payload.primaryCapability || "module")}: {`,
          `    env: ${JSON.stringify((payload.envVars?.length ? payload.envVars : ["<ENV_VAR>"]).slice(0, 4))},`,
          `    configKeys: ${JSON.stringify((payload.configKeys?.length ? payload.configKeys : ["<config.key>"]).slice(0, 4))},`,
          "  },",
          "});",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (language === "json") {
      return {
        language,
        content: `${JSON.stringify({
          [payload.primaryCapability || "module"]: {
            env: payload.envVars?.length ? payload.envVars.map((envVar) => `<${envVar}>`) : ["<ENV_VAR>"],
            configKeys: payload.configKeys?.length ? payload.configKeys : ["<config.key>"],
          },
        }, null, 2)}\n`,
      };
    }

    return {
      language,
      content: [
        maybeComment(prefix, `Config mapping for ${payload.moduleName}.`),
        `export const ${toCamelCase(payload.primaryCapability || "module")}Config = {`,
        `  env: ${JSON.stringify((payload.envVars?.length ? payload.envVars : ["<ENV_VAR>"]).slice(0, 4))},`,
        `  configKeys: ${JSON.stringify((payload.configKeys?.length ? payload.configKeys : ["<config.key>"]).slice(0, 4))},`,
        "};",
        "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (payload.role === "wiring") {
    if (frameworkKind === "nextjs" && wiringTarget === "next-api-route") {
      const httpMethod = payload.primaryCapability === "auth" ? "POST" : "GET";
      return {
        language: scriptExtFromLanguage(language),
        content: [
          maybeComment(prefix, `Next.js route scaffold for ${payload.moduleName}.`),
          `import { ${moduleFactoryName} } from "${moduleImportPath}";`,
          "",
          `const ${exportedRef} = ${moduleFactoryName}();`,
          "",
          `export async function ${httpMethod}() {`,
          `  return Response.json({ ok: true, moduleReady: Boolean(${exportedRef}) });`,
          "}",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (frameworkKind === "nextjs" && uiCapability && (language === "tsx" || language === "jsx")) {
      return {
        language,
        content: [
          maybeComment(prefix, `Next.js page scaffold for ${payload.moduleName}.`),
          `import ${moduleExportName} from "${moduleImportPath}";`,
          "",
          "export default function Page() {",
          `  return <${moduleExportName} />;`,
          "}",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (frameworkKind === "express") {
      return {
        language: scriptExtFromLanguage(language),
        content: [
          maybeComment(prefix, `Express wiring scaffold for ${payload.moduleName}.`),
          'import express from "express";',
          `import { ${moduleFactoryName} } from "${moduleImportPath}";`,
          "",
          "const router = express.Router();",
          `const ${exportedRef} = ${moduleFactoryName}();`,
          "",
          `router.get("/${payload.primaryCapability || "module"}", async (_request, response) => {`,
          `  response.json({ ok: true, moduleReady: Boolean(${exportedRef}) });`,
          "});",
          "",
          "export default router;",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (frameworkKind === "nest") {
      const serviceName = /Service$/i.test(moduleExportName) ? moduleExportName : `${moduleExportName}Service`;
      return {
        language: scriptExtFromLanguage(language),
        content: [
          maybeComment(prefix, `NestJS module registration scaffold for ${payload.moduleName}.`),
          'import { Module } from "@nestjs/common";',
          `import { ${serviceName} } from "${moduleImportPath}";`,
          "",
          "@Module({",
          `  providers: [${serviceName}],`,
          `  exports: [${serviceName}],`,
          "})",
          `export class ${moduleExportName}Module {}`,
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if ((frameworkKind === "react-native" || frameworkKind === "react") && uiCapability && (language === "tsx" || language === "jsx")) {
      return {
        language,
        content: [
          maybeComment(prefix, `UI entry scaffold for ${payload.moduleName}.`),
          `import ${moduleExportName} from "${moduleImportPath}";`,
          "",
          "export default function App() {",
          `  return <${moduleExportName} />;`,
          "}",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (language === "py") {
      return {
        language,
        content: [
          maybeComment(prefix, `Wire ${payload.moduleName} into the target application entrypoint.`),
          `from ${moduleImportPath.replaceAll("/", ".").replace(/^\.+/, "")} import ${toCamelCase(moduleFactoryName)}`,
          "",
          `${toCamelCase(moduleFactoryName)}()`,
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    return {
      language,
      content: [
        maybeComment(prefix, `Wire ${payload.moduleName} into the target application entrypoint.`),
        `import { ${moduleFactoryName} } from "${moduleImportPath}";`,
        "",
        `const ${exportedRef} = ${moduleFactoryName}();`,
        `void ${exportedRef};`,
        "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (payload.role === "verify") {
    if (uiCapability && (language === "tsx" || language === "jsx")) {
      return {
        language,
        content: [
          maybeComment(prefix, `Component smoke test draft for ${payload.moduleName}.`),
          'import { render } from "@testing-library/react";',
          `import ${moduleExportName} from "${moduleImportPath}";`,
          "",
          `describe("${payload.moduleName} adoption", () => {`,
          '  it("renders the adopted flow", () => {',
          `    render(<${moduleExportName} />);`,
          "  });",
          "});",
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    if (language === "py") {
      return {
        language,
        content: [
          maybeComment(prefix, `Smoke test draft for ${payload.moduleName}.`),
          `def test_${exportedRef}_adoption_smoke():`,
          `    assert ${JSON.stringify(payload.verifyTarget || moduleExportName)} is not None`,
          "",
        ].filter(Boolean).join("\n"),
      };
    }

    return {
      language,
      content: [
        maybeComment(prefix, `Smoke test draft for ${payload.moduleName}.`),
        `describe("${payload.moduleName} adoption", () => {`,
        '  it("keeps the adopted flow reachable", () => {',
        `    expect(${payload.verifyTarget || exportedRef}).toBeDefined();`,
        "  });",
        "});",
        "",
      ].filter(Boolean).join("\n"),
    };
  }

  return {
    language,
    content: [
      maybeComment(prefix, `Patch draft placeholder for ${payload.moduleName}.`),
      maybeComment(prefix, "TODO: Apply the validated adoption pattern here."),
      "",
    ].filter(Boolean).join("\n"),
  };
}

function scriptExtFromLanguage(language) {
  if (language === "tsx") {
    return "ts";
  }
  if (language === "jsx") {
    return "js";
  }
  return language;
}

function buildPatchDraftEntry(planEntry, context) {
  const language = getLanguageFromPath(planEntry.filePath);
  const sourceRelativePath = context.entryPath
    ? path.relative(context.targetWorkspacePath, context.entryPath).replaceAll("\\", "/")
    : "";
  const targetRelativePath = context.execution.targetEntryPath
    ? path.relative(path.dirname(planEntry.filePath), context.execution.targetEntryPath)
    : "";
  const adapterRelativePath = context.execution.adapterPath
    ? path.relative(path.dirname(planEntry.filePath), context.execution.adapterPath)
    : "";
  const snippet = buildPatchDraftSnippet({
    role: planEntry.role,
    language,
    moduleName: context.moduleNode.name,
    baseName: context.baseName,
    primaryCapability: context.primaryCapability,
    envVars: context.envVars,
    configKeys: context.configKeys,
    dependencies: context.dependencies,
    missingDependencies: context.missingDependencies,
    moduleImportPath: normalizeImportPath(targetRelativePath),
    adapterImportPath: normalizeImportPath(adapterRelativePath),
    verifyTarget: toCamelCase(context.baseName || context.moduleNode.name),
    frameworkKind: context.frameworkContext?.kind,
    frameworkDisplayName: context.frameworkContext?.displayName,
    wiringTarget: context.frameworkContext?.wiringTarget,
    uiCapability: context.frameworkContext?.uiCapability,
  });

  return {
    order: planEntry.order,
    role: planEntry.role,
    action: planEntry.action,
    filePath: planEntry.filePath,
    fileName: path.basename(planEntry.filePath || ""),
    exists: fs.existsSync(planEntry.filePath),
    intent: planEntry.intent,
    reason: planEntry.reason,
    checklist: buildPatchDraftChecklist([
      planEntry.intent,
      planEntry.reason,
      planEntry.role === "dependencies" && context.missingDependencies.length
        ? `Add the missing packages: ${context.missingDependencies.join(", ")}.`
        : null,
      planEntry.role === "dependencies" && !context.missingDependencies.length && context.dependencies.length
        ? `Confirm the target already has: ${context.dependencies.slice(0, 4).join(", ")}.`
        : null,
      planEntry.role === "module-entry" && sourceRelativePath
        ? `Mirror the validated flow from source entry ${sourceRelativePath}.`
        : null,
      planEntry.role === "adapter" && context.adapterBoundary
        ? `Keep adapter boundary ${context.adapterBoundary} by isolating target-specific wiring.`
        : null,
      planEntry.role === "config" && context.envVars.length
        ? `Map env vars: ${context.envVars.join(", ")}.`
        : null,
      planEntry.role === "config" && context.configKeys.length
        ? `Map config keys: ${context.configKeys.join(", ")}.`
        : null,
      planEntry.role === "wiring"
        ? `Import the adopted module from ${path.basename(context.execution.targetEntryPath)} and expose it through the ${context.frameworkContext?.displayName || "project"} wiring layer.`
        : null,
      planEntry.role === "wiring" && context.frameworkContext?.wiringStrategy
        ? context.frameworkContext.wiringStrategy
        : null,
      planEntry.role === "verify"
        ? `Turn the smoke step into a reproducible test around ${context.moduleNode.name}.`
        : null,
    ]),
    snippetLanguage: snippet.language,
    snippet: snippet.content,
  };
}

function buildAdoptionPatchDraft(payload = {}) {
  const moduleNode = resolveModuleNodeReference(payload);
  if (!moduleNode) {
    throw new Error("Khong tim thay module de tao patch draft.");
  }

  const targetWorkspacePath = normalizeWorkspacePath(payload.targetWorkspacePath || payload.workspacePath);
  if (!targetWorkspacePath) {
    throw new Error("targetWorkspacePath la bat buoc.");
  }

  const recipe = buildAdoptionRecipe(payload);
  const profile = buildProjectProfile(targetWorkspacePath, payload);
  const snapshot = loadProjectPipelineSnapshot(targetWorkspacePath, payload);
  const execution = buildExecutionPatchPlan(recipe, profile, snapshot.pipeline, moduleNode);
  const entryPath = extractContextDetail(moduleNode, "Entry path") || moduleNode.files?.[0] || "";
  const envVars = extractContextList(moduleNode, "Env vars");
  const configKeys = extractContextList(moduleNode, "Config keys");
  const dependencies = extractContextList(moduleNode, "Dependencies");
  const dependencyOverlap = dependencies.filter((dependency) => profile.dependencies.includes(dependency) || profile.peerDependencies.includes(dependency));
  const missingDependencies = dependencies.filter((dependency) => !dependencyOverlap.includes(dependency)).slice(0, 6);
  const primaryCapability = getPrimaryCapabilityForModule(moduleNode);
  const baseName = path.basename(
    execution.targetEntryPath || entryPath,
    path.extname(execution.targetEntryPath || entryPath)
  ) || sanitizeId(moduleNode.name || "module");
  const adapterBoundary = extractContextDetail(moduleNode, "Adapter boundary") || null;
  const draftFiles = execution.patchPlan.map((planEntry) =>
    buildPatchDraftEntry(planEntry, {
      moduleNode,
      targetWorkspacePath,
      entryPath,
      execution,
      envVars,
      configKeys,
      dependencies,
      missingDependencies,
      primaryCapability,
      baseName,
      adapterBoundary,
      frameworkContext: execution.frameworkContext,
    })
  );

  return {
    moduleId: moduleNode.id,
    moduleName: moduleNode.name,
    targetWorkspacePath,
    summary: `Draft the adoption by starting at ${path.basename(execution.startHere?.filePath || execution.targetEntryPath)} and applying the file skeletons in order.`,
    recipe: {
      strategy: recipe.strategy,
      confidence: recipe.confidence,
      summary: recipe.summary,
      checklist: recipe.checklist,
    },
    execution: {
      startHere: execution.startHere,
      patchPlan: execution.patchPlan,
      frameworkContext: execution.frameworkContext,
    },
    patchDraft: {
      startHere: execution.startHere,
      draftFiles,
      applyNotes: buildPatchDraftChecklist([
        missingDependencies.length ? `Resolve dependency placeholders first: ${missingDependencies.join(", ")}.` : "Confirm dependency alignment before writing code.",
        `Use ${path.basename(execution.targetEntryPath)} as the anchor file for the adoption.`,
        draftFiles.some((entry) => entry.role === "adapter")
          ? `Keep project-specific wiring behind ${path.basename(execution.adapterPath)}.`
          : null,
        draftFiles.some((entry) => entry.role === "config")
          ? "Translate config and env requirements before wiring the module into the app."
          : null,
        execution.frameworkContext?.wiringStrategy || null,
        `Finish by validating the smoke path at ${path.basename(execution.smokePath)}.`,
      ]),
    },
    tokenEstimate: estimateContextTokens({
      recipe: recipe.checklist.slice(0, 6),
      patchDraft: draftFiles.map((entry) => ({
        role: entry.role,
        action: entry.action,
        fileName: entry.fileName,
        checklist: entry.checklist.slice(0, 2),
      })),
    }),
  };
}

function normalizeBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizePathArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeWorkspacePath(entry))
    .filter(Boolean);
}

function normalizeDependencyVersionMap(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      return normalizeDependencyVersionMap(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, version]) => [normalizeOptionalText(key), normalizeOptionalText(version)])
      .filter(([key, version]) => key && version)
  );
}

function isPathInsideWorkspace(filePath, workspacePath) {
  const normalizedFile = normalizeWorkspacePath(filePath);
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
  if (!normalizedFile || !normalizedWorkspace) {
    return false;
  }
  const fileLower = normalizedFile.toLowerCase();
  const workspaceLower = normalizedWorkspace.toLowerCase();
  return fileLower === workspaceLower || fileLower.startsWith(`${workspaceLower}${path.sep}`.toLowerCase());
}

function snippetHasPlaceholders(snippet) {
  return /<[^>\r\n]+>/.test(String(snippet || ""));
}

function buildScaffoldBlockMarkers(moduleId, role, language) {
  const prefix = getCommentPrefix(language);
  const id = sanitizeId(`${moduleId || "module"}-${role || "block"}`);
  if (!prefix) {
    return {
      start: `__GRAPH_MEMORY_SCAFFOLD_${id}_START__`,
      end: `__GRAPH_MEMORY_SCAFFOLD_${id}_END__`,
    };
  }
  return {
    start: `${prefix} graph-memory scaffold:${id}:start`,
    end: `${prefix} graph-memory scaffold:${id}:end`,
  };
}

function wrapScaffoldBlock(moduleId, role, language, snippet) {
  const markers = buildScaffoldBlockMarkers(moduleId, role, language);
  return `${markers.start}\n${String(snippet || "").trimEnd()}\n${markers.end}\n`;
}

function scaffoldBlockExists(content, moduleId, role, language) {
  const markers = buildScaffoldBlockMarkers(moduleId, role, language);
  return String(content || "").includes(markers.start);
}

function parsePackageJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildAdoptionApplyPreview(payload = {}) {
  const patchDraft = buildAdoptionPatchDraft(payload);
  const targetWorkspacePath = patchDraft.targetWorkspacePath;
  const selectedRoles = new Set(normalizeStringArray(payload.roles || payload.selectedRoles));
  const selectedFiles = new Set(normalizePathArray(payload.filePaths || payload.selectedFiles));
  const appendExisting = normalizeBooleanFlag(payload.appendExisting, false);
  const overwriteExisting = normalizeBooleanFlag(payload.overwriteExisting, false);
  const allowPackageJson = normalizeBooleanFlag(payload.allowPackageJson, false);
  const allowPlaceholders = normalizeBooleanFlag(payload.allowPlaceholders, true);
  const dependencyVersions = normalizeDependencyVersionMap(payload.dependencyVersions);

  const previewFiles = patchDraft.patchDraft.draftFiles.map((entry) => {
    const insideWorkspace = isPathInsideWorkspace(entry.filePath, targetWorkspacePath);
    const placeholders = snippetHasPlaceholders(entry.snippet);
    const roleSelected = !selectedRoles.size || selectedRoles.has(entry.role);
    const fileSelected = !selectedFiles.size || selectedFiles.has(normalizeWorkspacePath(entry.filePath));
    const riskFlags = [];
    let status = "ready";
    let strategy = entry.exists ? "skip" : "create";
    let reason = "Ready to scaffold this file.";

    if (!roleSelected) {
      status = "skipped_role";
      strategy = "skip";
      reason = `Role ${entry.role} is not selected.`;
    } else if (!fileSelected) {
      status = "skipped_file";
      strategy = "skip";
      reason = "File is outside the selected file filter.";
    } else if (!insideWorkspace) {
      status = "blocked_outside_workspace";
      strategy = "block";
      reason = "Target file path is outside the target workspace.";
      riskFlags.push("outside_workspace");
    } else if (entry.role === "dependencies" && !allowPackageJson) {
      status = "blocked_manifest_guard";
      strategy = "block";
      reason = "package.json updates are blocked until allowPackageJson is enabled.";
      riskFlags.push("manifest");
    } else if (entry.role === "dependencies" && allowPackageJson && placeholders && !Object.keys(dependencyVersions).length) {
      status = "blocked_dependency_versions";
      strategy = "block";
      reason = "Dependency versions are required before updating package.json.";
      riskFlags.push("placeholder");
      riskFlags.push("manifest");
    } else if (placeholders && !allowPlaceholders) {
      status = "blocked_placeholder";
      strategy = "block";
      reason = "Snippet still contains placeholders and allowPlaceholders is disabled.";
      riskFlags.push("placeholder");
    } else if (entry.exists && entry.role !== "dependencies") {
      if (overwriteExisting) {
        status = "ready";
        strategy = "overwrite";
        reason = "Existing file will be overwritten because overwriteExisting is enabled.";
        riskFlags.push("overwrite_existing");
      } else if (appendExisting) {
        status = "ready";
        strategy = "append";
        reason = "Existing file will receive an appended scaffold block.";
        riskFlags.push("append_existing");
      } else {
        status = "blocked_existing_file";
        strategy = "block";
        reason = "Existing file changes are blocked until appendExisting or overwriteExisting is enabled.";
        riskFlags.push("existing_file");
      }
    } else if (entry.exists) {
      status = "ready";
      strategy = "merge";
      reason = "Existing manifest will be merged with the requested dependencies.";
      riskFlags.push("manifest");
    }

    return {
      ...entry,
      status,
      strategy,
      reason,
      insideWorkspace,
      hasPlaceholders: placeholders,
      riskFlags: uniqueStrings(riskFlags),
      selected: status === "ready",
    };
  });

  const counts = previewFiles.reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] || 0) + 1;
    return summary;
  }, {});
  counts.ready = previewFiles.filter((entry) => entry.selected).length;
  counts.total = previewFiles.length;

  return {
    moduleId: patchDraft.moduleId,
    moduleName: patchDraft.moduleName,
    targetWorkspacePath,
    summary: `Preview ${counts.ready || 0} ready scaffold change(s) out of ${previewFiles.length} draft file(s).`,
    policy: {
      appendExisting,
      overwriteExisting,
      allowPackageJson,
      allowPlaceholders,
      selectedRoles: [...selectedRoles],
      selectedFiles: [...selectedFiles],
    },
    recipe: patchDraft.recipe,
    execution: patchDraft.execution,
    patchDraft: patchDraft.patchDraft,
    preview: {
      files: previewFiles,
      counts,
      applyNotes: patchDraft.patchDraft.applyNotes,
    },
    tokenEstimate: estimateContextTokens({
      policy: {
        appendExisting,
        overwriteExisting,
        allowPackageJson,
        allowPlaceholders,
      },
      preview: previewFiles.map((entry) => ({
        role: entry.role,
        status: entry.status,
        strategy: entry.strategy,
      })),
    }),
  };
}

function applyDraftEntry(previewEntry, previewContext, payload = {}) {
  const dependencyVersions = normalizeDependencyVersionMap(payload.dependencyVersions);
  if (previewEntry.role === "dependencies") {
    const manifest = parsePackageJson(previewEntry.filePath);
    if (!manifest || typeof manifest !== "object") {
      throw new Error(`Khong the doc package.json tai ${previewEntry.filePath}.`);
    }
    manifest.dependencies = manifest.dependencies && typeof manifest.dependencies === "object"
      ? { ...manifest.dependencies }
      : {};
    Object.entries(dependencyVersions).forEach(([dependency, version]) => {
      manifest.dependencies[dependency] = version;
    });
    const nextContent = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.writeFileSync(previewEntry.filePath, nextContent, "utf8");
    return {
      filePath: previewEntry.filePath,
      action: "merge",
      role: previewEntry.role,
      bytesWritten: Buffer.byteLength(nextContent, "utf8"),
      strategy: previewEntry.strategy,
    };
  }

  ensureParentDir(previewEntry.filePath);
  if (previewEntry.strategy === "create") {
    fs.writeFileSync(previewEntry.filePath, previewEntry.snippet, "utf8");
    return {
      filePath: previewEntry.filePath,
      action: "create",
      role: previewEntry.role,
      bytesWritten: Buffer.byteLength(previewEntry.snippet, "utf8"),
      strategy: previewEntry.strategy,
    };
  }

  if (previewEntry.strategy === "overwrite") {
    fs.writeFileSync(previewEntry.filePath, previewEntry.snippet, "utf8");
    return {
      filePath: previewEntry.filePath,
      action: "overwrite",
      role: previewEntry.role,
      bytesWritten: Buffer.byteLength(previewEntry.snippet, "utf8"),
      strategy: previewEntry.strategy,
    };
  }

  if (previewEntry.strategy === "append") {
    const existingContent = fs.readFileSync(previewEntry.filePath, "utf8");
    if (scaffoldBlockExists(existingContent, previewContext.moduleId, previewEntry.role, previewEntry.snippetLanguage)) {
      return {
        filePath: previewEntry.filePath,
        action: "append",
        role: previewEntry.role,
        bytesWritten: 0,
        strategy: "already_applied",
        skipped: true,
        reason: "Scaffold block already exists in the target file.",
      };
    }
    const block = wrapScaffoldBlock(previewContext.moduleId, previewEntry.role, previewEntry.snippetLanguage, previewEntry.snippet);
    const nextContent = `${existingContent.trimEnd()}\n\n${block}`;
    fs.writeFileSync(previewEntry.filePath, nextContent, "utf8");
    return {
      filePath: previewEntry.filePath,
      action: "append",
      role: previewEntry.role,
      bytesWritten: Buffer.byteLength(block, "utf8"),
      strategy: previewEntry.strategy,
    };
  }

  throw new Error(`Khong ho tro strategy ${previewEntry.strategy} cho ${previewEntry.filePath}.`);
}

function applyAdoptionPatchDraft(payload = {}) {
  const preview = buildAdoptionApplyPreview(payload);
  const apply = normalizeBooleanFlag(payload.apply, true);
  const readyEntries = preview.preview.files.filter((entry) => entry.status === "ready");
  const blockedEntries = preview.preview.files.filter((entry) => entry.status !== "ready");

  if (!apply) {
    return {
      ...preview,
      applyResult: {
        applied: [],
        blocked: blockedEntries,
        skipped: [],
        counts: {
          applied: 0,
          blocked: blockedEntries.length,
          ready: readyEntries.length,
        },
      },
    };
  }

  const applied = [];
  const skipped = [];
  readyEntries.forEach((entry) => {
    const result = applyDraftEntry(entry, preview, payload);
    if (result.skipped) {
      skipped.push(result);
      return;
    }
    applied.push(result);
  });

  return {
    ...preview,
    applyResult: {
      applied,
      blocked: blockedEntries,
      skipped,
      counts: {
        applied: applied.length,
        blocked: blockedEntries.length,
        skipped: skipped.length,
        ready: readyEntries.length,
      },
    },
  };
}

function buildAdoptionExecutionAssist(payload = {}) {
  const moduleNode = resolveModuleNodeReference(payload);
  if (!moduleNode) {
    throw new Error("Khong tim thay module de tao execution assist.");
  }

  const targetWorkspacePath = normalizeWorkspacePath(payload.targetWorkspacePath || payload.workspacePath);
  if (!targetWorkspacePath) {
    throw new Error("targetWorkspacePath la bat buoc.");
  }

  const recipe = buildAdoptionRecipe(payload);
  const profile = buildProjectProfile(targetWorkspacePath, payload);
  const snapshot = loadProjectPipelineSnapshot(targetWorkspacePath, payload);
  const execution = buildExecutionPatchPlan(recipe, profile, snapshot.pipeline, moduleNode);

  return {
    moduleId: moduleNode.id,
    moduleName: moduleNode.name,
    targetWorkspacePath,
    summary: `Start from ${path.basename(execution.startHere?.filePath || execution.targetEntryPath)} and follow the patch plan in order to apply the adoption recipe with minimal guesswork.`,
    recipe: {
      strategy: recipe.strategy,
      confidence: recipe.confidence,
      summary: recipe.summary,
      checklist: recipe.checklist,
    },
    execution: {
      startHere: execution.startHere,
      patchPlan: execution.patchPlan,
      targetBaseDir: execution.targetBaseDir,
      targetEntryPath: execution.targetEntryPath,
      adapterPath: execution.adapterPath,
      configPath: execution.configPath,
      wiringPath: execution.wiringPath,
      smokePath: execution.smokePath,
      frameworkContext: execution.frameworkContext,
    },
    tokenEstimate: estimateContextTokens({
      recipe: recipe.checklist.slice(0, 6),
      execution: {
        framework: execution.frameworkContext?.kind,
        startHere: execution.startHere,
        patchPlan: execution.patchPlan,
      },
    }),
  };
}

function deriveImplementationStatusFromActivity(activityStatus, blocker) {
  const normalized = normalizeActivityStatus(activityStatus);
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "stopped") {
    return blocker ? "blocked" : "paused";
  }
  if (normalized === "completed") {
    return "completed";
  }
  return blocker ? "blocked" : "active";
}

function upsertImplementationThread(payload = {}) {
  const workspacePath = normalizeWorkspacePath(payload.workspacePath);
  if (!workspacePath) {
    throw new Error("workspacePath la bat buoc.");
  }

  const projectNode = ensureProjectNodeForWorkspace(workspacePath, payload);
  const taskKey = deriveTaskKeyFromText(
    payload.taskKey ||
      payload.metadata?.taskKey ||
      payload.title ||
      payload.summary ||
      payload.commandText ||
      payload.currentStep,
    "general-work"
  );
  const explicitThreadId = normalizeOptionalText(payload.threadId);
  const existing = explicitThreadId
    ? getImplementationThread(explicitThreadId)
    : findImplementationThreadByTaskKey(workspacePath, taskKey);
  const threadId = explicitThreadId || existing?.id || `impl-${sanitizeId(`${workspacePath}-${taskKey}`)}`;
  const now = nowIso();
  const title =
    normalizeOptionalText(payload.title) ||
    existing?.title ||
    normalizeOptionalText(payload.summary) ||
    normalizeOptionalText(payload.commandText) ||
    `${path.basename(workspacePath)} implementation`;
  const blocker =
    normalizeOptionalText(payload.blocker) ||
    normalizeOptionalText(payload.latestError) ||
    existing?.blocker ||
    null;
  const status = normalizeImplementationStatus(
    payload.status || deriveImplementationStatusFromActivity(payload.activityStatus || "running", blocker)
  );
  const touchedFiles = uniqueStrings([
    ...(existing?.touchedFiles || []),
    ...normalizeStringArray(payload.touchedFiles),
    ...(normalizeOptionalPath(payload.currentFile || payload.file) ? [normalizeOptionalPath(payload.currentFile || payload.file)] : []),
  ]);
  const tags = uniqueStrings([...(existing?.tags || []), ...normalizeStringArray(payload.tags)]);
  const metadata = mergeMetadata(existing?.metadata, payload.metadata);
  const summary =
    normalizeOptionalText(payload.summary) ||
    normalizeOptionalText(payload.message) ||
    existing?.summary ||
    "";
  const currentStep =
    normalizeOptionalText(payload.currentStep) ||
    normalizeOptionalText(payload.message) ||
    (status === "completed" ? existing?.currentStep : null) ||
    existing?.currentStep ||
    null;
  const nextStep = normalizeOptionalText(payload.nextStep) || existing?.nextStep || null;
  const completedAt = status === "completed" || status === "failed" ? now : null;

  db.prepare(`
    INSERT INTO implementation_threads (
      id, project_id, workspace_path, task_key, title, status, summary, current_step,
      next_step, blocker, latest_run_id, last_tool_source, touched_files_json, tags_json,
      metadata_json, created_at, updated_at, last_active_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      workspace_path = excluded.workspace_path,
      task_key = excluded.task_key,
      title = excluded.title,
      status = excluded.status,
      summary = excluded.summary,
      current_step = excluded.current_step,
      next_step = excluded.next_step,
      blocker = excluded.blocker,
      latest_run_id = excluded.latest_run_id,
      last_tool_source = excluded.last_tool_source,
      touched_files_json = excluded.touched_files_json,
      tags_json = excluded.tags_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at,
      last_active_at = excluded.last_active_at,
      completed_at = excluded.completed_at
  `).run(
    threadId,
    projectNode?.id || existing?.projectId || null,
    workspacePath,
    taskKey,
    title,
    status,
    summary,
    currentStep,
    nextStep,
    blocker,
    normalizeOptionalText(payload.runId) || existing?.latestRunId || null,
    normalizeToolSource(payload.toolSource || existing?.lastToolSource),
    JSON.stringify(touchedFiles),
    JSON.stringify(tags),
    JSON.stringify(metadata),
    existing?.createdAt || now,
    now,
    now,
    completedAt
  );

  const message =
    normalizeOptionalText(payload.message) ||
    normalizeOptionalText(payload.summary) ||
    normalizeOptionalText(payload.currentStep) ||
    normalizeOptionalText(payload.nextStep) ||
    title;

  if (message) {
    insertImplementationEvent(
      threadId,
      payload.runId,
      payload.eventKind || (existing ? "update" : "start"),
      message,
      payload.currentFile || payload.file,
      {
        status,
        blocker,
        currentStep,
        nextStep,
        metadata,
      }
    );
  }

  const thread = getImplementationThread(threadId);
  syncModuleAdoptionsFromImplementation(payload, thread);
  syncModuleVerificationsFromImplementation(payload, thread);
  return thread;
}

function getImplementationContext(options = {}) {
  const workspacePath = normalizeWorkspacePath(options.workspacePath || "");
  if (!workspacePath) {
    throw new Error("workspacePath la bat buoc.");
  }

  const active = listImplementationThreads({
    workspacePath,
    statuses: ["active", "blocked", "paused"],
    limit: clampNumber(options.limit, 5, 1, 20),
    query: options.query,
  });
  const recentCompleted = listImplementationThreads({
    workspacePath,
    statuses: ["completed", "failed"],
    limit: clampNumber(options.recentLimit, 4, 1, 12),
  });
  const primary = active[0] || recentCompleted[0] || null;
  const recentEvents = primary ? listImplementationEvents(primary.id, clampNumber(options.eventLimit, 6, 1, 20)) : [];
  const adoptionMemory = getModuleAdoptionMemory({
    workspacePath,
    limit: clampNumber(options.adoptionLimit, 4, 1, 20),
  });
  const verificationMemory = getModuleVerificationMemory({
    workspacePath,
    limit: clampNumber(options.verificationLimit, 4, 1, 20),
  });

  return {
    workspacePath,
    activeCount: active.length,
    activeThreads: active,
    recentCompleted,
    primaryThread: primary,
    recentEvents,
    adoptionMemory,
    verificationMemory,
    resumeHint: primary
      ? primary.nextStep || primary.currentStep || primary.summary || `Resume ${primary.title}`
      : "No resumable implementation thread found.",
    tokenEstimate: estimateContextTokens({
      activeThreads: active.map((thread) => compactImplementationThread(thread)),
      recentCompleted: recentCompleted.map((thread) => compactImplementationThread(thread)),
      adoptionMemory: {
        summary: adoptionMemory.summary,
        adoptions: adoptionMemory.adoptions.slice(0, 3),
      },
      verificationMemory: {
        summary: verificationMemory.summary,
        verifications: verificationMemory.verifications.slice(0, 3),
      },
      recentEvents: recentEvents.slice(0, 4),
    }),
  };
}

function syncImplementationThreadFromActivity(run, payload = {}, eventKind = "update") {
  if (!run?.workspacePath) {
    return null;
  }

  const mergedMetadata = mergeMetadata(run.metadata, payload.metadata);
  return upsertImplementationThread({
    workspacePath: run.workspacePath,
    projectId: run.projectId,
    threadId: payload.threadId || mergedMetadata.threadId,
    taskKey: payload.taskKey || mergedMetadata.taskKey,
    title: payload.taskTitle || mergedMetadata.taskTitle || run.summary || run.commandText,
    summary: payload.summary || run.summary,
    currentStep: payload.currentStep || mergedMetadata.currentStep || payload.message || run.summary,
    nextStep: payload.nextStep || mergedMetadata.nextStep,
    blocker: payload.blocker || mergedMetadata.blocker || payload.latestError || run.latestError,
    runId: run.id,
    toolSource: payload.toolSource || run.toolSource,
    currentFile: payload.currentFile || run.currentFile,
    touchedFiles: payload.touchedFiles || mergedMetadata.touchedFiles,
    tags: payload.tags || mergedMetadata.tags,
    metadata: mergedMetadata,
    status: payload.implementationStatus,
    activityStatus: payload.status || run.status,
    latestError: payload.latestError || run.latestError,
    message: payload.message,
    eventKind,
    commandText: payload.commandText || run.commandText,
  });
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeOptionalText(entry))
    .filter(Boolean);
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

function normalizeImplementationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["active", "blocked", "paused", "completed", "failed"].includes(normalized)) {
    return normalized;
  }
  return "active";
}

function normalizeAdoptionType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["copy", "adapt", "reference"].includes(normalized)) {
    return normalized;
  }
  return "adapt";
}

function normalizeAdoptionStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["planned", "integrating", "validated", "failed", "abandoned"].includes(normalized)) {
    return normalized;
  }
  return "integrating";
}

function normalizeVerificationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["pending", "passed", "failed", "mixed", "flaky"].includes(normalized)) {
    return normalized;
  }
  return "pending";
}

function deriveVerificationStatusFromPayload(payload = {}, existing = null) {
  const explicit = normalizeOptionalText(payload.status);
  if (explicit) {
    return normalizeVerificationStatus(explicit);
  }

  const passedTests = normalizeStringArray(payload.passedTests || payload.passingTests);
  const failedTests = normalizeStringArray(payload.failedTests);
  const integrationErrors = normalizeStringArray(payload.integrationErrors);
  const fixPatterns = normalizeStringArray(payload.fixPatterns);

  if (passedTests.length && !failedTests.length && !integrationErrors.length) {
    return "passed";
  }
  if ((failedTests.length || integrationErrors.length) && passedTests.length) {
    return "mixed";
  }
  if (failedTests.length || integrationErrors.length) {
    return "failed";
  }
  if (fixPatterns.length && existing?.status === "failed") {
    return "mixed";
  }
  if (payload.implementationStatus === "completed") {
    return "passed";
  }
  if (payload.implementationStatus === "failed") {
    return "failed";
  }
  return existing?.status || "pending";
}

function hasVerificationSignals(payload = {}) {
  return Boolean(
    normalizeOptionalText(payload.status) ||
    normalizeOptionalText(payload.verificationKey) ||
    normalizeStringArray(payload.passedTests || payload.passingTests).length ||
    normalizeStringArray(payload.failedTests).length ||
    normalizeStringArray(payload.integrationErrors).length ||
    normalizeStringArray(payload.fixPatterns).length ||
    normalizeStringArray(payload.verificationNotes).length ||
    (payload.evidence && typeof payload.evidence === "object" && Object.keys(payload.evidence).length)
  );
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

function sanitizeCapability(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveTaskKeyFromText(text, fallback = "general-work") {
  const normalized = sanitizeCapability(text || "");
  return normalized || fallback;
}

function deriveAdoptionKey({ moduleId, taskKey, targetWorkspacePath }) {
  return deriveTaskKeyFromText(`${moduleId || "module"}-${taskKey || targetWorkspacePath || "adoption"}`, "module-adoption");
}

function inferCapabilitiesFromText(text) {
  const normalized = String(text || "").toLowerCase();
  return MODULE_CAPABILITY_PATTERNS
    .filter((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)))
    .map((entry) => entry.capability);
}

function isIgnoredModuleFile(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/").toLowerCase();
  return MODULE_IGNORE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function deriveModuleRootFromRelativePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\.?\//, "");
  if (!normalized || isIgnoredModuleFile(normalized)) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const withoutFile = segments.slice(0, -1);
  if (!withoutFile.length) {
    return null;
  }

  if (segments[0] === "src") {
    if (segments.length >= 4 && MODULE_BUCKET_NAMES.has(segments[1].toLowerCase())) {
      return path.posix.join("src", segments[1], segments[2]);
    }
    if (segments.length === 3 && MODULE_BUCKET_NAMES.has(segments[1].toLowerCase())) {
      return path.posix.join("src", segments[1], path.basename(segments[2], path.extname(segments[2])));
    }
    if (segments.length >= 3) {
      return path.posix.join("src", segments[1]);
    }
  }

  if (MODULE_BUCKET_NAMES.has(segments[0].toLowerCase()) && segments.length >= 3) {
    return path.posix.join(segments[0], segments[1]);
  }
  if (MODULE_BUCKET_NAMES.has(segments[0].toLowerCase()) && segments.length === 2) {
    return path.posix.join(segments[0], path.basename(segments[1], path.extname(segments[1])));
  }

  if (withoutFile.length >= 2) {
    return path.posix.join(...withoutFile);
  }

  return null;
}

function loadProjectDependencyManifest(rootPath) {
  const manifestPath = path.join(rootPath, "package.json");
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = {};
  }

  return {
    dependencies: Object.keys(manifest.dependencies || {}),
    devDependencies: Object.keys(manifest.devDependencies || {}),
    peerDependencies: Object.keys(manifest.peerDependencies || {}),
  };
}

function extractImportSpecifiersFromContent(content, ext) {
  const specifiers = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      specifiers.add(value.trim());
    }
  };

  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    const importRegex = /import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/g;
    const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) add(match[1]);
    while ((match = requireRegex.exec(content)) !== null) add(match[1]);
  } else if (ext === ".py") {
    const fromRegex = /^\s*from\s+([a-zA-Z0-9_./-]+)\s+import\s+/gm;
    const importRegex = /^\s*import\s+([a-zA-Z0-9_./-]+)/gm;
    let match;
    while ((match = fromRegex.exec(content)) !== null) add(match[1]);
    while ((match = importRegex.exec(content)) !== null) add(match[1]);
  }

  return [...specifiers];
}

function normalizeExternalDependency(specifier) {
  const normalized = String(specifier || "").trim();
  if (
    !normalized ||
    normalized.startsWith(".") ||
    normalized.startsWith("/") ||
    normalized.startsWith("@/") ||
    normalized.startsWith("~/") ||
    normalized.startsWith("src/") ||
    normalized.startsWith("node:")
  ) {
    return null;
  }

  if (normalized.startsWith("@")) {
    const scoped = normalized.split("/").slice(0, 2).join("/");
    return scoped || null;
  }

  return normalized.split("/")[0] || null;
}

function collectDependencyFingerprint(filePaths) {
  const dependencySet = new Set();
  const internalLinkSet = new Set();

  filePaths.forEach((filePath) => {
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    extractImportSpecifiersFromContent(content, ext).forEach((specifier) => {
      const dependencyName = normalizeExternalDependency(specifier);
      if (dependencyName) {
        dependencySet.add(dependencyName);
      } else if (specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("~/") || specifier.startsWith("src/")) {
        internalLinkSet.add(specifier);
      }
    });
  });

  return {
    externalDependencies: [...dependencySet].sort(),
    internalLinks: [...internalLinkSet].sort(),
  };
}

function collectModuleSourceSignals(filePaths, workspacePath, moduleRoot) {
  const envVars = new Set();
  const configKeys = new Set();
  const adapterSignals = new Set();
  const warnings = [];
  let contentBytes = 0;

  filePaths.forEach((filePath) => {
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return;
    }

    contentBytes += content.length;
    ENV_VAR_PATTERNS.forEach((pattern) => {
      for (const match of content.matchAll(pattern)) {
        if (match[1]) {
          envVars.add(match[1]);
        }
      }
    });
    CONFIG_ACCESS_PATTERNS.forEach((pattern) => {
      for (const match of content.matchAll(pattern)) {
        if (match[1]) {
          configKeys.add(match[1]);
        }
      }
    });
    ADAPTER_PATTERNS.forEach((pattern) => {
      if (pattern.regex.test(content)) {
        adapterSignals.add(pattern.label);
      }
    });
    if (/TODO|FIXME|HACK/i.test(content)) {
      warnings.push(`Implementation markers found in ${path.basename(filePath)}.`);
    }
  });

  const evidence = findReuseEvidence(workspacePath, moduleRoot, filePaths);
  return {
    envVars: [...envVars].sort(),
    configKeys: [...configKeys].sort(),
    adapterSignals: [...adapterSignals].sort(),
    warnings: uniqueStrings(warnings),
    contentBytes,
    evidence,
  };
}

function findReuseEvidence(workspacePath, moduleRoot, filePaths) {
  const normalizedRoot = path.join(workspacePath, moduleRoot.replaceAll("/", path.sep));
  const candidateDirs = uniqueStrings([
    path.dirname(filePaths[0] || normalizedRoot),
    normalizedRoot,
    path.dirname(normalizedRoot),
  ]);
  const examples = new Set();
  const tests = new Set();
  const docs = new Set();

  candidateDirs.forEach((dirPath) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (/^(examples?|demo|sample|playground)$/i.test(entry.name)) {
          examples.add(fullPath);
        }
        if (/^(__tests__|tests?)$/i.test(entry.name)) {
          tests.add(fullPath);
        }
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      if (/\.(test|spec)\.[^.]+$/i.test(entry.name)) {
        tests.add(fullPath);
      }
      if (/(example|demo|sample)/i.test(entry.name)) {
        examples.add(fullPath);
      }
      if (/\.(md|mdx)$/i.test(entry.name)) {
        docs.add(fullPath);
      }
    });
  });

  return {
    tests: [...tests].sort(),
    examples: [...examples].sort(),
    docs: [...docs].sort(),
  };
}

function deriveAdapterBoundary(candidate) {
  const adapterCount =
    candidate.externalDependencies.length +
    candidate.frameworkAdapters.length +
    candidate.sourceSignals.adapterSignals.length +
    candidate.sourceSignals.envVars.length +
    candidate.sourceSignals.configKeys.length;

  if (adapterCount >= 8) {
    return "high";
  }
  if (adapterCount >= 4) {
    return "medium";
  }
  return "low";
}

function scoreCopyabilityReadiness(candidate, dependencyManifest) {
  let score = candidate.copyabilityScore;
  score += candidate.sourceSignals.evidence.tests.length ? 10 : -8;
  score += candidate.sourceSignals.evidence.examples.length ? 8 : 0;
  score += candidate.sourceSignals.evidence.docs.length ? 4 : 0;
  score -= Math.min(candidate.sourceSignals.envVars.length * 4, 16);
  score -= Math.min(candidate.sourceSignals.configKeys.length * 3, 12);
  score -= candidate.adapterBoundary === "high" ? 18 : candidate.adapterBoundary === "medium" ? 8 : 0;
  score -= Math.min(candidate.externalDependencies.length, 6);

  const devOnlyDeps = candidate.externalDependencies.filter((dep) => dependencyManifest.devDependencies.includes(dep));
  score -= Math.min(devOnlyDeps.length * 3, 9);

  return clampNumber(score, 0, 0, 100);
}

function scoreAdaptationCost(candidate) {
  let score = candidate.adaptationCost;
  score += Math.min(candidate.sourceSignals.envVars.length * 5, 20);
  score += Math.min(candidate.sourceSignals.configKeys.length * 4, 16);
  score += candidate.adapterBoundary === "high" ? 16 : candidate.adapterBoundary === "medium" ? 8 : 0;
  score += candidate.sourceSignals.evidence.tests.length ? -8 : 6;
  score += candidate.sourceSignals.evidence.examples.length ? -6 : 0;
  return clampNumber(score, 0, 0, 100);
}

function deriveReuseRecommendation(candidate) {
  if (candidate.copyabilityScore >= 78 && candidate.adaptationCost <= 35 && candidate.adapterBoundary === "low") {
    return "ready-to-copy";
  }
  if (candidate.copyabilityScore >= 55 && candidate.adaptationCost <= 60) {
    return "adapt-with-care";
  }
  return "reference-only";
}

function buildReuseNotes(candidate) {
  return uniqueStrings([
    candidate.sourceSignals.envVars.length
      ? `Requires env vars: ${candidate.sourceSignals.envVars.slice(0, 8).join(", ")}`
      : "",
    candidate.sourceSignals.configKeys.length
      ? `Requires config keys: ${candidate.sourceSignals.configKeys.slice(0, 8).join(", ")}`
      : "",
    candidate.sourceSignals.adapterSignals.length
      ? `Touches adapters: ${candidate.sourceSignals.adapterSignals.join(", ")}`
      : "",
    candidate.sourceSignals.evidence.tests.length
      ? `Test coverage nearby: ${candidate.sourceSignals.evidence.tests.slice(0, 4).map((item) => path.basename(item)).join(", ")}`
      : "No nearby tests detected.",
    candidate.sourceSignals.evidence.examples.length
      ? `Example/demo files: ${candidate.sourceSignals.evidence.examples.slice(0, 4).map((item) => path.basename(item)).join(", ")}`
      : "",
    ...candidate.sourceSignals.warnings,
  ]);
}

function cleanupModuleRegistry(workspacePath, options = {}) {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath || "");
  if (!normalizedWorkspace) {
    throw new Error("workspacePath la bat buoc.");
  }

  const activeCanonicalKeys = new Set(
    normalizeStringArray(options.activeCanonicalKeys).map((entry) => entry.toLowerCase())
  );
  const dryRun = Boolean(options.dryRun);
  const workspaceModules = listNodes()
    .filter((node) => node.type === "module")
    .filter((node) => extractWorkspaceRootsFromNode(node).some((root) => normalizePath(root) === normalizePath(normalizedWorkspace)));

  const actions = [];
  const groups = new Map();

  workspaceModules.forEach((node) => {
    const canonicalKey =
      extractCanonicalKey(node) ||
      buildModuleCanonicalKey({
        workspacePath: normalizedWorkspace,
        moduleRoot: extractContextDetail(node, "Module root"),
        entryPath: extractContextDetail(node, "Entry path") || node.files?.[0] || "",
      });
    if (!groups.has(canonicalKey)) {
      groups.set(canonicalKey, []);
    }
    groups.get(canonicalKey).push(node);
  });

  groups.forEach((groupNodes, canonicalKey) => {
    const sorted = [...groupNodes].sort((left, right) => {
      const leftFresh = extractRegistryVersion(left) === MODULE_REGISTRY_VERSION ? 1 : 0;
      const rightFresh = extractRegistryVersion(right) === MODULE_REGISTRY_VERSION ? 1 : 0;
      if (leftFresh !== rightFresh) {
        return rightFresh - leftFresh;
      }
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    });

    const winner = sorted[0];
    sorted.forEach((node, index) => {
      let nextStatus = "active";
      let reason = "";

      if (index > 0) {
        nextStatus = "duplicate";
        reason = `Superseded by ${winner.id}`;
      } else if (extractRegistryVersion(node) !== MODULE_REGISTRY_VERSION && isManagedHarvestedModule(node)) {
        nextStatus = "legacy";
        reason = `Old registry version ${extractRegistryVersion(node) || "unknown"}`;
      } else if (activeCanonicalKeys.size && !activeCanonicalKeys.has(canonicalKey.toLowerCase()) && isManagedHarvestedModule(node)) {
        nextStatus = "stale";
        reason = "Missing from latest harvest";
      }

      const currentStatus = extractRegistryStatus(node) || "active";
      if (currentStatus !== nextStatus || (nextStatus !== "active" && reason)) {
        actions.push({
          nodeId: node.id,
          canonicalKey,
          from: currentStatus,
          to: nextStatus,
          reason,
        });
        if (!dryRun) {
          updateModuleRegistryStatus(node, nextStatus, reason);
        }
      }
    });
  });

  return {
    workspacePath: normalizedWorkspace,
    registryVersion: MODULE_REGISTRY_VERSION,
    dryRun,
    actionCount: actions.length,
    actions,
  };
}

function extractContextList(node, label) {
  return extractContextDetail(node, label)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function deriveProjectCapabilitiesFromPipeline(pipeline, dependencyManifest, workspacePath, query = "") {
  const capabilityCounts = new Map();
  const add = (value, weight = 1) => {
    inferCapabilitiesFromText(value).forEach((capability) => {
      capabilityCounts.set(capability, (capabilityCounts.get(capability) || 0) + weight);
    });
  };

  (pipeline.nodes || []).slice(0, 400).forEach((node) => {
    add(node.relativePath || node.path || "", 2);
    add(node.name || "", 1);
    (node.exportedSymbols || []).slice(0, 12).forEach((symbol) => add(symbol, 1));
    (node.routeDefs || []).slice(0, 6).forEach((route) => add(`${route.method || ""} ${route.path || ""}`, 2));
  });

  [
    ...dependencyManifest.dependencies,
    ...dependencyManifest.peerDependencies,
    ...dependencyManifest.devDependencies.slice(0, 40),
    workspacePath,
    query,
  ].forEach((value) => add(value, 2));

  return [...capabilityCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([capability, score]) => ({ capability, score }));
}

function buildProjectProfile(workspacePath, options = {}) {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath || "");
  if (!normalizedWorkspace) {
    throw new Error("workspacePath la bat buoc.");
  }

  const maxDepth = clampNumber(options.maxDepth, 5, 1, 8);
  const maxFiles = clampNumber(options.maxFiles, 260, 40, 2000);
  const cachedPipeline = getPipelineCache(normalizedWorkspace, maxDepth, maxFiles);
  const pipeline = cachedPipeline || scanProjectPipeline(normalizedWorkspace, { maxDepth, maxFiles });
  if (!cachedPipeline) {
    savePipelineCache(normalizedWorkspace, maxDepth, maxFiles, pipeline);
  }

  const dependencyManifest = loadProjectDependencyManifest(normalizedWorkspace);
  const frameworkAdapters = Object.entries(pipeline.frameworkAdapters || {})
    .filter(([, detail]) => detail?.enabled)
    .map(([name]) => name);
  const capabilities = deriveProjectCapabilitiesFromPipeline(
    pipeline,
    dependencyManifest,
    normalizedWorkspace,
    options.query || options.capability || ""
  );
  const framework = detectProjectFrameworkKind({
    dependencies: dependencyManifest.dependencies,
    peerDependencies: dependencyManifest.peerDependencies,
    devDependencies: dependencyManifest.devDependencies,
    frameworkAdapters,
  }, pipeline);

  return {
    workspacePath: normalizedWorkspace,
    projectName: path.basename(normalizedWorkspace),
    filesAnalyzed: Number(pipeline.filesAnalyzed || 0),
    traceCount: Number(pipeline.traceCount || 0),
    framework,
    frameworkLabel: getFrameworkDisplayName(framework),
    frameworkAdapters,
    dependencies: dependencyManifest.dependencies,
    peerDependencies: dependencyManifest.peerDependencies,
    devDependencies: dependencyManifest.devDependencies,
    capabilities,
    topRoutes: (pipeline.traces || []).slice(0, 5).map((trace) => trace?.route || trace?.label).filter(Boolean),
    summary: `Profiled ${path.basename(normalizedWorkspace)} as ${getFrameworkDisplayName(framework)} with ${Number(pipeline.filesAnalyzed || 0)} files, ${frameworkAdapters.length} framework adapters, and ${capabilities.length} candidate capabilities.`,
  };
}

function scoreModuleForProjectMatch(node, profile, filters = {}, adoptionIndex = new Map(), verificationIndex = new Map()) {
  const desiredCapability = sanitizeCapability(filters.capability || "");
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const capabilities = extractCapabilitiesFromNode(node);
  const dependencies = extractContextList(node, "Dependencies");
  const frameworkAdapters = extractContextList(node, "Framework adapters").map((item) => item.toLowerCase());
  const workspaceRoots = extractWorkspaceRootsFromNode(node);
  const recommendation = extractContextDetail(node, "Reuse recommendation");
  const adapterBoundary = extractContextDetail(node, "Adapter boundary");
  const envVars = extractContextList(node, "Env vars");
  const configKeys = extractContextList(node, "Config keys");
  const adoptionMemory = adoptionIndex.get(node.id) || null;
  const verificationMemory = verificationIndex.get(node.id) || null;
  const projectCapabilities = profile.capabilities.map((entry) => entry.capability);
  const capabilityOverlap = capabilities.filter((capability) => projectCapabilities.includes(capability));
  const dependencyOverlap = dependencies.filter((dependency) => (
    profile.dependencies.includes(dependency) || profile.peerDependencies.includes(dependency)
  ));
  const frameworkOverlap = frameworkAdapters.filter((adapter) => profile.frameworkAdapters.includes(adapter));
  const sameWorkspace = workspaceRoots.some((root) => normalizePath(root) === normalizePath(profile.workspacePath));

  let score = recencyScore(node.updatedAt) + 18;
  if (desiredCapability && capabilities.includes(desiredCapability)) score += 40;
  if (query && matchesQuery(node, query)) score += 14;
  score += Math.min(capabilityOverlap.length * 12, 36);
  score += Math.min(dependencyOverlap.length * 5, 20);
  score += Math.min(frameworkOverlap.length * 8, 24);
  score += Math.round(extractNumericContextValue(node, "Copyability score") / 8);
  score += Math.round(extractNumericContextValue(node, "Maturity score") / 20);
  score -= Math.round(extractNumericContextValue(node, "Adaptation cost") / 18);
  score -= Math.min(envVars.length * 3, 12);
  score -= Math.min(configKeys.length * 3, 12);
  if (sameWorkspace) score -= 6;
  else score += 8;
  if (recommendation === "ready-to-copy") score += 16;
  if (recommendation === "adapt-with-care") score += 8;
  if (recommendation === "reference-only") score -= 8;
  if (adapterBoundary === "high") score -= 10;
  if (adapterBoundary === "medium") score -= 4;
  if (adoptionMemory) {
    score += Math.min(adoptionMemory.validatedCount * 6, 18);
    score += Math.min(adoptionMemory.targetProjectCount * 4, 12);
    score += Math.min(adoptionMemory.sameTargetCount * 6, 12);
    score += adoptionMemory.recentPatterns.length ? 4 : 0;
  }
  if (verificationMemory) {
    score += Math.min(verificationMemory.passedCount * 5, 15);
    score += Math.min(verificationMemory.sameTargetCount * 4, 12);
    score += verificationMemory.topFixPatterns.length ? 4 : 0;
    score -= Math.min(verificationMemory.failedCount * 2, 8);
  }

  let recommendedAction = "reference";
  if (score >= 90 && (recommendation === "ready-to-copy" || adoptionMemory?.validatedCount > 0 || verificationMemory?.passedCount > 0)) {
    recommendedAction = "copy-first";
  } else if (score >= 68 || adoptionMemory?.validatedCount > 0 || verificationMemory?.passedCount > 0) {
    recommendedAction = "adapt-first";
  }

  const rationale = uniqueStrings([
    desiredCapability && capabilities.includes(desiredCapability)
      ? `Matches requested capability ${desiredCapability}.`
      : "",
    capabilityOverlap.length
      ? `Capability overlap: ${capabilityOverlap.slice(0, 4).join(", ")}.`
      : "",
    dependencyOverlap.length
      ? `Dependency overlap: ${dependencyOverlap.slice(0, 5).join(", ")}.`
      : "",
    frameworkOverlap.length
      ? `Framework overlap: ${frameworkOverlap.slice(0, 4).join(", ")}.`
      : "",
    adoptionMemory?.validatedCount
      ? `Validated adoptions: ${adoptionMemory.validatedCount}.`
      : "",
    adoptionMemory?.recentPatterns?.length
      ? `Known pattern: ${adoptionMemory.recentPatterns[0]}.`
      : "",
    verificationMemory?.passedCount
      ? `Passing verifications: ${verificationMemory.passedCount}.`
      : "",
    verificationMemory?.topFixPatterns?.length
      ? `Known fix pattern: ${verificationMemory.topFixPatterns[0].value}.`
      : "",
    recommendation ? `Reuse recommendation: ${recommendation}.` : "",
    adapterBoundary ? `Adapter boundary: ${adapterBoundary}.` : "",
    !sameWorkspace && workspaceRoots[0] ? `Source project: ${path.basename(workspaceRoots[0])}.` : "",
  ]);

  return {
    node,
    score,
    capabilities,
    dependencyOverlap,
    frameworkOverlap,
    adoptionMemory,
    verificationMemory,
    recommendedAction,
    rationale,
  };
}

function matchProjectToReusableModules(options = {}) {
  const workspacePath = normalizeWorkspacePath(options.workspacePath || "");
  if (!workspacePath) {
    throw new Error("workspacePath la bat buoc.");
  }

  const limit = clampNumber(options.limit, 6, 1, 20);
  const profile = buildProjectProfile(workspacePath, options);
  const adoptionIndex = buildModuleAdoptionIndex(workspacePath);
  const verificationIndex = buildModuleVerificationIndex(workspacePath);
  const candidates = listReusableModules({
    includeLegacy: Boolean(options.includeLegacy),
    capability: options.capability,
    limit: 120,
  })
    .map((node) => scoreModuleForProjectMatch(node, profile, options, adoptionIndex, verificationIndex))
    .filter((entry) => entry.score > 24)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    workspacePath,
    projectProfile: {
      projectName: profile.projectName,
      summary: profile.summary,
      framework: profile.framework,
      frameworkLabel: profile.frameworkLabel,
      capabilities: profile.capabilities,
      frameworkAdapters: profile.frameworkAdapters,
      dependencies: profile.dependencies.slice(0, 12),
      filesAnalyzed: profile.filesAnalyzed,
      traceCount: profile.traceCount,
    },
    recommendationSummary: candidates.length
      ? "Copy or adapt the top matched modules before generating new implementation from scratch."
      : "No strong reusable module match found; continue with focused local implementation.",
    count: candidates.length,
    matches: candidates.map(({ node, score, capabilities, dependencyOverlap, frameworkOverlap, adoptionMemory, verificationMemory, recommendedAction, rationale }) => {
      const adoptionRecipe = buildAdoptionRecipe({
        moduleId: node.id,
        targetWorkspacePath: workspacePath,
        query: options.query,
        capability: options.capability,
        limit: 6,
      });
      const executionAssist = buildAdoptionExecutionAssist({
        moduleId: node.id,
        targetWorkspacePath: workspacePath,
        query: options.query,
        capability: options.capability,
        limit: 6,
      });
      const patchDraft = buildAdoptionPatchDraft({
        moduleId: node.id,
        targetWorkspacePath: workspacePath,
        query: options.query,
        capability: options.capability,
        limit: 6,
      });
      return {
        id: node.id,
        name: node.name,
        score,
        recommendedAction,
        capabilities,
        summary: node.summary,
        workspaceRoots: extractWorkspaceRootsFromNode(node).slice(0, 2),
        reuseRecommendation: extractContextDetail(node, "Reuse recommendation") || null,
        adapterBoundary: extractContextDetail(node, "Adapter boundary") || null,
        dependencyOverlap,
        frameworkOverlap,
        integrationHint: extractContextDetail(node, "Integration hint") || null,
        files: (node.files || []).slice(0, 4),
        adoptionMemory: adoptionMemory
          ? {
              totalCount: adoptionMemory.totalCount,
              validatedCount: adoptionMemory.validatedCount,
              targetProjectCount: adoptionMemory.targetProjectCount,
              recentPatterns: adoptionMemory.recentPatterns,
              topAdapterChanges: adoptionMemory.topAdapterChanges,
              topDependencyChanges: adoptionMemory.topDependencyChanges,
            }
          : null,
        verificationMemory: verificationMemory
          ? {
              totalCount: verificationMemory.totalCount,
              passedCount: verificationMemory.passedCount,
              failedCount: verificationMemory.failedCount,
              topPassedTests: verificationMemory.topPassedTests,
              topIntegrationErrors: verificationMemory.topIntegrationErrors,
              topFixPatterns: verificationMemory.topFixPatterns,
            }
          : null,
        adoptionRecipe: {
          strategy: adoptionRecipe.strategy,
          confidence: adoptionRecipe.confidence,
          summary: adoptionRecipe.summary,
          checklist: adoptionRecipe.checklist,
          sections: adoptionRecipe.sections,
        },
        executionAssist: {
          summary: executionAssist.summary,
          frameworkContext: executionAssist.execution.frameworkContext,
          startHere: executionAssist.execution.startHere,
          patchPlan: executionAssist.execution.patchPlan,
        },
        patchDraft: {
          summary: patchDraft.summary,
          frameworkContext: patchDraft.execution.frameworkContext,
          startHere: patchDraft.patchDraft.startHere,
          draftFiles: patchDraft.patchDraft.draftFiles,
          applyNotes: patchDraft.patchDraft.applyNotes,
        },
        rationale,
        updatedAt: node.updatedAt,
      };
    }),
    tokenEstimate: estimateContextTokens({
      projectProfile: {
        capabilities: profile.capabilities,
        frameworkAdapters: profile.frameworkAdapters,
      },
      matches: candidates.map((entry) => ({
        id: entry.node.id,
        score: entry.score,
        recommendedAction: entry.recommendedAction,
      })),
    }),
  };
}

function detectCandidateFrameworkAdapters(candidate) {
  const haystack = [
    candidate.externalDependencies.join(" "),
    candidate.routeFrameworks.join(" "),
    candidate.roles.join(" "),
    candidate.capabilityText,
  ]
    .join(" ")
    .toLowerCase();

  return uniqueStrings([
    /\bexpress\b|\bfastify\b/.test(haystack) || candidate.routeCount ? "express" : "",
    /\b@nestjs\b|\bnest\b/.test(haystack) ? "nest" : "",
    /\b@prisma\/client\b|\bprisma\b/.test(haystack) ? "prisma" : "",
    /\btypeorm\b/.test(haystack) ? "typeorm" : "",
    /\bmongoose\b/.test(haystack) ? "mongoose" : "",
    /\breact\b|\bnext\b/.test(haystack) ? "react" : "",
  ]);
}

function pickBestEntryFile(candidate) {
  return [...candidate.fileRecords]
    .sort((left, right) => scoreEntryFile(right) - scoreEntryFile(left))[0]?.path || candidate.files[0] || "";
}

function scoreEntryFile(record) {
  const basename = path.basename(record.relativePath || record.path, path.extname(record.path)).toLowerCase();
  let score = 0;
  if (MODULE_ENTRY_BASENAMES.has(basename)) score += 30;
  if ((record.exportedSymbolCount || 0) > 0) score += Math.min(record.exportedSymbolCount * 4, 16);
  if ((record.inbound || 0) > 0) score += Math.min(record.inbound * 3, 15);
  if ((record.outbound || 0) > 0) score += Math.min(record.outbound * 2, 10);
  if ((record.routeCount || 0) > 0) score += 10;
  return score;
}

function scoreModuleCandidate(candidate, dependencyManifest) {
  let score = 0;
  score += Math.min(candidate.fileCount * 8, 32);
  score += Math.min(candidate.exportedSymbolCount * 4, 20);
  score += Math.min(candidate.inbound * 3, 18);
  score += Math.min(candidate.routeCount * 8, 16);
  score += Math.min(candidate.roleCount * 4, 12);
  score += candidate.entryPath ? 10 : 0;
  score += candidate.frameworkAdapters.length ? Math.min(candidate.frameworkAdapters.length * 4, 12) : 0;
  score += candidate.externalDependencies.length ? Math.min(candidate.externalDependencies.length * 2, 10) : 0;
  score += candidate.capabilities.length ? Math.min(candidate.capabilities.length * 8, 16) : 0;

  if (candidate.fileCount === 1 && candidate.exportedSymbolCount === 0 && candidate.routeCount === 0) {
    score -= 25;
  }

  if (candidate.fileCount === 1 && candidate.capabilities.length > 0 && (candidate.inbound > 0 || candidate.outbound > 0)) {
    score += 18;
  }

  if (!candidate.capabilities.length && candidate.fileCount < 2) {
    score -= 20;
  }

  if (dependencyManifest.dependencies.length) {
    const matchedProjectDeps = candidate.externalDependencies.filter((dep) =>
      dependencyManifest.dependencies.includes(dep) || dependencyManifest.peerDependencies.includes(dep)
    );
    score += Math.min(matchedProjectDeps.length * 2, 8);
  }

  return clampNumber(score, 0, 0, 100);
}

function inferCapabilitiesFromCandidate(candidate) {
  const textSignals = [
    candidate.moduleRoot,
    candidate.name,
    candidate.summary,
    candidate.exportedSymbols.join(" "),
    candidate.roles.join(" "),
    candidate.externalDependencies.join(" "),
    candidate.routePaths.join(" "),
  ].join(" ");

  return uniqueStrings([
    ...inferCapabilitiesFromText(textSignals),
    ...candidate.frameworkAdapters.flatMap((adapter) => inferCapabilitiesFromText(adapter)),
  ]);
}

function inferSurfaceCapabilities(candidate) {
  return uniqueStrings(
    inferCapabilitiesFromText(
      [
        candidate.moduleRoot,
        candidate.name,
        candidate.entryPath ? path.basename(candidate.entryPath) : "",
        candidate.exportedSymbols.join(" "),
      ].join(" ")
    )
  );
}

function selectPrimaryCapabilityForCandidate(candidate) {
  const surfaceMatches = inferSurfaceCapabilities(candidate);
  if (surfaceMatches.length) {
    return surfaceMatches[0];
  }

  if (candidate.fileCount <= 1) {
    const fallbackSegment = sanitizeCapability(
      path.basename(candidate.entryPath || candidate.moduleRoot || candidate.name || "module", path.extname(candidate.entryPath || ""))
    );
    return fallbackSegment || "module";
  }

  const fallbackSegment = String(candidate.moduleRoot || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return sanitizeCapability(fallbackSegment || candidate.name || "module");
}

function buildModuleHarvestCandidates(workspacePath, options = {}) {
  const pipeline = scanProjectPipeline(workspacePath, options);
  const dependencyManifest = loadProjectDependencyManifest(workspacePath);
  const candidatesByRoot = new Map();

  (pipeline.nodes || []).forEach((node) => {
    if (!node?.relativePath || isIgnoredModuleFile(node.relativePath)) {
      return;
    }

    const moduleRoot = deriveModuleRootFromRelativePath(node.relativePath);
    if (!moduleRoot) {
      return;
    }

    const absolutePath = normalizeWorkspacePath(node.path);
    if (!absolutePath) {
      return;
    }

    const record = {
      path: absolutePath,
      relativePath: node.relativePath.replaceAll("\\", "/"),
      role: node.role || "unknown",
      inbound: Number(node.inbound || 0),
      outbound: Number(node.outbound || 0),
      exportedSymbolCount: Array.isArray(node.exportedSymbols) ? node.exportedSymbols.length : 0,
      routeCount: Array.isArray(node.routeDefs) ? node.routeDefs.length : 0,
      exportedSymbols: Array.isArray(node.exportedSymbols) ? node.exportedSymbols : [],
      routeDefs: Array.isArray(node.routeDefs) ? node.routeDefs : [],
    };

    if (!candidatesByRoot.has(moduleRoot)) {
      candidatesByRoot.set(moduleRoot, {
        moduleRoot,
        workspacePath,
        fileRecords: [],
        files: [],
        roles: new Set(),
        exportedSymbols: new Set(),
        routePaths: new Set(),
        routeFrameworks: new Set(),
      });
    }

    const candidate = candidatesByRoot.get(moduleRoot);
    candidate.fileRecords.push(record);
    candidate.files.push(record.path);
    candidate.roles.add(record.role);
    record.exportedSymbols.forEach((symbol) => candidate.exportedSymbols.add(symbol));
    record.routeDefs.forEach((routeDef) => {
      if (routeDef.path) candidate.routePaths.add(routeDef.path);
      if (routeDef.framework) candidate.routeFrameworks.add(routeDef.framework);
    });
  });

  return [...candidatesByRoot.values()]
    .map((candidate) => {
      const fingerprint = collectDependencyFingerprint(candidate.files);
      const roleList = [...candidate.roles].sort();
      const exportedSymbols = [...candidate.exportedSymbols].sort();
      const routePaths = [...candidate.routePaths].sort();
      const routeFrameworks = [...candidate.routeFrameworks].sort();
      const name = deriveNodeName(candidate.moduleRoot);
      const entryPath = pickBestEntryFile(candidate);
      const frameworkAdapters = detectCandidateFrameworkAdapters({
        ...candidate,
        externalDependencies: fingerprint.externalDependencies,
        routeFrameworks,
        roles: roleList,
        capabilityText: `${candidate.moduleRoot} ${name}`,
        routeCount: candidate.fileRecords.reduce((sum, record) => sum + record.routeCount, 0),
      });
      const hydrated = {
        workspacePath,
        moduleRoot: candidate.moduleRoot,
        fileRecords: candidate.fileRecords,
        files: uniqueStrings(candidate.files),
        fileCount: candidate.fileRecords.length,
        roleCount: roleList.length,
        roles: roleList,
        entryPath,
        exportedSymbols,
        exportedSymbolCount: exportedSymbols.length,
        routePaths,
        routeFrameworks,
        routeCount: routePaths.length,
        inbound: candidate.fileRecords.reduce((sum, record) => sum + record.inbound, 0),
        outbound: candidate.fileRecords.reduce((sum, record) => sum + record.outbound, 0),
        externalDependencies: fingerprint.externalDependencies,
        internalLinkCount: fingerprint.internalLinks.length,
        frameworkAdapters,
        name,
        summary: `Structured reusable module candidate at ${candidate.moduleRoot}.`,
      };
      hydrated.capabilities = inferCapabilitiesFromCandidate(hydrated);
      hydrated.structureScore = scoreModuleCandidate(hydrated, dependencyManifest);
      hydrated.copyabilityScore = clampNumber(
        38 + Math.round(hydrated.structureScore * 0.5) + Math.min(hydrated.exportedSymbolCount * 2, 10),
        0,
        0,
        100
      );
      hydrated.adaptationCost = clampNumber(
        70 - Math.round(hydrated.structureScore * 0.35) + Math.min(hydrated.externalDependencies.length * 4, 20),
        25,
        0,
        100
      );
      hydrated.maturityScore = clampNumber(
        28 + Math.round(hydrated.structureScore * 0.45) + Math.min(hydrated.inbound, 15),
        0,
        0,
        100
      );
      hydrated.confidence = clampNumber(
        20 + Math.round(hydrated.structureScore * 0.6) + (hydrated.capabilities.length ? 10 : 0),
        0,
        0,
        100
      );
      hydrated.sourceSignals = collectModuleSourceSignals(hydrated.files, workspacePath, hydrated.moduleRoot);
      hydrated.adapterBoundary = deriveAdapterBoundary(hydrated);
      hydrated.copyabilityScore = scoreCopyabilityReadiness(hydrated, dependencyManifest);
      hydrated.adaptationCost = scoreAdaptationCost(hydrated);
      hydrated.reuseRecommendation = deriveReuseRecommendation(hydrated);
      hydrated.reuseNotes = buildReuseNotes(hydrated);
      return hydrated;
    })
    .filter((candidate) => candidate.structureScore >= 45)
    .filter(
      (candidate) =>
        candidate.fileCount >= 2 ||
        candidate.exportedSymbolCount >= 2 ||
        candidate.routeCount >= 1 ||
        (candidate.exportedSymbolCount >= 1 && candidate.capabilities.length > 0 && candidate.structureScore >= 55)
    )
    .sort((left, right) => right.structureScore - left.structureScore);
}

function extractCapabilitiesFromNode(node) {
  const capabilityDetail = (node.contextWindow || []).find((item) => item.label === "Capability")?.detail || "";
  return uniqueStrings(
    capabilityDetail
      .split(",")
      .map((entry) => sanitizeCapability(entry))
      .filter(Boolean)
  );
}

function extractWorkspaceRootsFromNode(node) {
  return uniqueStrings(
    (node.contextWindow || [])
      .filter((item) => item.label === "Workspace root")
      .map((item) => item.detail)
  );
}

function extractNumericContextValue(node, label) {
  const raw = (node.contextWindow || []).find((item) => item.label === label)?.detail || "";
  const match = String(raw).match(/(\d{1,3})/);
  return match ? Number(match[1]) : 0;
}

function extractContextDetail(node, label) {
  return (node.contextWindow || []).find((item) => item.label === label)?.detail || "";
}

function extractRegistryVersion(node) {
  return extractContextDetail(node, "Registry version") || "";
}

function extractRegistryStatus(node) {
  return extractContextDetail(node, "Registry status") || "";
}

function extractCanonicalKey(node) {
  return extractContextDetail(node, "Canonical key") || "";
}

function isManagedHarvestedModule(node) {
  if (!node || node.type !== "module") {
    return false;
  }
  const tags = extractContextDetail(node, "Tags");
  return /harvested|structured|auto/i.test(tags) || /harvested reusable/i.test(node.summary || "");
}

function buildModuleCanonicalKey({ workspacePath, moduleRoot, entryPath }) {
  const normalizedWorkspace = normalizePath(workspacePath);
  const normalizedModuleRoot = normalizePath(moduleRoot);
  if (normalizedWorkspace && normalizedModuleRoot) {
    return `module::${normalizedWorkspace}::${normalizedModuleRoot}`;
  }
  return `module::${normalizedWorkspace}::${normalizePath(entryPath)}`;
}

function setNodeContextDetail(contextWindow, label, detail) {
  const next = Array.isArray(contextWindow) ? [...contextWindow] : [];
  const index = next.findIndex((item) => item.label === label);
  if (detail === null || detail === undefined || detail === "") {
    if (index >= 0) {
      next.splice(index, 1);
    }
    return next;
  }
  const value = { label, detail: String(detail) };
  if (index >= 0) {
    next[index] = value;
  } else {
    next.push(value);
  }
  return next;
}

function updateModuleRegistryStatus(node, status, reason = "") {
  if (!node) {
    return null;
  }
  const existingNotes = Array.isArray(node.notes) ? node.notes : [];
  const nextNotes = uniqueStrings([
    ...existingNotes,
    reason ? `Registry cleanup: ${reason}` : "",
  ]);
  const nextContext = setNodeContextDetail(
    setNodeContextDetail(node.contextWindow || [], "Registry status", status),
    "Registry version",
    extractRegistryVersion(node) || MODULE_REGISTRY_VERSION
  );

  updateNode({
    ...node,
    contextWindow: nextContext,
    notes: nextNotes,
  });
  return getNode(node.id);
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

function writeUtf8FileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.writeFileSync(filePath, content, "utf8");
}

function appendVaultLog(kind, detail) {
  try {
    const config = getVaultConfig();
    fs.mkdirSync(config.rootPath, { recursive: true });
    const line = `\n## [${nowIso()}] ${kind}\n- ${detail}\n`;
    fs.appendFileSync(config.logPath, line, "utf8");
  } catch {}
}

function runGitCommand(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`git failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function buildBrainSkillId(value, subdir = "") {
  const base = sanitizeId(path.basename(String(value || "skill").replace(/\.git$/i, ""))) || "skill";
  const digest = crypto.createHash("sha1").update(`${value}::${subdir}`).digest("hex").slice(0, 10);
  return `skill-${base}-${digest}`;
}

function normalizeSkillSubdir(value) {
  const text = normalizeOptionalText(value);
  if (!text) {
    return "";
  }
  const normalized = text.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (normalized.includes("..")) {
    throw new Error("sourceSubdir khong duoc chua '..'.");
  }
  return normalized;
}

function indexBrainSkillDirectory(options = {}) {
  const rootPath = normalizeWorkspacePath(options.rootPath || "");
  if (!rootPath) {
    throw new Error("rootPath skill la bat buoc.");
  }
  const manifest = readBrainSkillManifest(rootPath);
  const packageInfo = readJsonFileIfExists(path.join(rootPath, "package.json")) || {};
  const readmePath = findFirstExistingFile(rootPath, ["SKILL.md", "README.md", "readme.md"]);
  const readmeContent = readmePath ? readTextFileHead(readmePath, 12000) : "";
  const name = options.explicitName
    || normalizeOptionalText(manifest.name)
    || normalizeOptionalText(packageInfo.name)
    || extractMarkdownTitle(readmeContent)
    || path.basename(rootPath);
  const summary = normalizeOptionalText(manifest.summary || manifest.description)
    || normalizeOptionalText(packageInfo.description)
    || extractMarkdownSummary(readmeContent)
    || "Reusable brain skill imported into Graph Memory.";
  const capabilities = uniqueStrings([
    ...normalizeStringArray(manifest.capabilities),
    ...normalizeStringArray(manifest.skills),
    ...inferCapabilitiesFromText(`${name} ${summary} ${readmeContent.slice(0, 2000)}`),
  ]).slice(0, 12);
  const tags = uniqueStrings([
    ...normalizeStringArray(manifest.tags),
    ...normalizeStringArray(packageInfo.keywords),
    ...capabilities,
  ]).slice(0, 20);
  const usage = {
    whenToUse: normalizeStringArray(manifest.whenToUse || manifest.when_to_use),
    inputs: normalizeStringArray(manifest.inputs),
    workflow: extractMarkdownSectionList(readmeContent, "Workflow").slice(0, 8),
    safety: extractMarkdownSectionList(readmeContent, "Safety").slice(0, 6),
  };
  const versionHash = getGitHeadHash(rootPath) || hashSkillDirectory(rootPath);
  const now = nowIso();
  const existing = db.prepare("SELECT * FROM brain_skills WHERE id = ?").get(options.skillId);
  const installedAt = existing?.installed_at || now;
  const skill = {
    id: options.skillId,
    name,
    summary,
    sourceUrl: normalizeOptionalText(options.sourceUrl || ""),
    sourceRef: normalizeOptionalText(options.sourceRef || ""),
    sourceSubdir: normalizeSkillSubdir(options.sourceSubdir || ""),
    localPath: rootPath,
    manifestPath: manifest.__path || null,
    entryFile: readmePath || null,
    capabilities,
    tags,
    usage,
    metadata: {
      ...(options.metadata || {}),
      packageName: packageInfo.name || null,
      packageVersion: packageInfo.version || null,
      indexedBy: "graph-memory",
    },
    status: "active",
    versionHash,
    installedAt,
    updatedAt: now,
    lastIndexedAt: now,
  };

  db.prepare(`
    INSERT INTO brain_skills (
      id, name, summary, source_url, source_ref, source_subdir, local_path,
      manifest_path, entry_file, capabilities_json, tags_json, usage_json,
      metadata_json, status, version_hash, installed_at, updated_at, last_indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      summary = excluded.summary,
      source_url = excluded.source_url,
      source_ref = excluded.source_ref,
      source_subdir = excluded.source_subdir,
      local_path = excluded.local_path,
      manifest_path = excluded.manifest_path,
      entry_file = excluded.entry_file,
      capabilities_json = excluded.capabilities_json,
      tags_json = excluded.tags_json,
      usage_json = excluded.usage_json,
      metadata_json = excluded.metadata_json,
      status = excluded.status,
      version_hash = excluded.version_hash,
      updated_at = excluded.updated_at,
      last_indexed_at = excluded.last_indexed_at
  `).run(
    skill.id,
    skill.name,
    skill.summary,
    skill.sourceUrl,
    skill.sourceRef,
    skill.sourceSubdir,
    skill.localPath,
    skill.manifestPath,
    skill.entryFile,
    JSON.stringify(skill.capabilities),
    JSON.stringify(skill.tags),
    JSON.stringify(skill.usage),
    JSON.stringify(skill.metadata),
    skill.status,
    skill.versionHash,
    skill.installedAt,
    skill.updatedAt,
    skill.lastIndexedAt
  );
  return skill;
}

function readBrainSkillManifest(rootPath) {
  const manifestPath = findFirstExistingFile(rootPath, [
    "skill.json",
    "graph-skill.json",
    path.join(".graph", "skill.json"),
  ]);
  if (!manifestPath) {
    return {};
  }
  const parsed = readJsonFileIfExists(manifestPath) || {};
  return {
    ...parsed,
    __path: manifestPath,
  };
}

function findFirstExistingFile(rootPath, candidates) {
  for (const candidate of candidates) {
    const filePath = path.join(rootPath, candidate);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

function readJsonFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTextFileHead(filePath, maxBytes = 12000) {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.subarray(0, maxBytes).toString("utf8");
  } catch {
    return "";
  }
}

function extractMarkdownTitle(content) {
  const match = String(content || "").match(/^#\s+(.+)$/m);
  return normalizeOptionalText(match?.[1]);
}

function extractMarkdownSummary(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));
  return normalizeOptionalText(lines[0]) || "";
}

function extractMarkdownSectionList(content, sectionName) {
  const lines = String(content || "").split(/\r?\n/);
  const target = sectionName.toLowerCase();
  const items = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      inSection = heading[1].trim().toLowerCase().includes(target);
      continue;
    }
    if (!inSection) {
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      items.push(item[1].trim());
    }
  }
  return items;
}

function getGitHeadHash(rootPath) {
  try {
    const result = spawnSync("git", ["-C", rootPath, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.status === 0 ? normalizeOptionalText(result.stdout) : null;
  } catch {
    return null;
  }
}

function hashSkillDirectory(rootPath) {
  const hash = crypto.createHash("sha1");
  const files = [];
  collectSkillHashFiles(rootPath, files, 0);
  files.sort().slice(0, 40).forEach((filePath) => {
    hash.update(path.relative(rootPath, filePath));
    hash.update(readTextFileHead(filePath, 16000));
  });
  return hash.digest("hex").slice(0, 12);
}

function collectSkillHashFiles(rootPath, files, depth) {
  if (depth > 3 || !fs.existsSync(rootPath)) {
    return;
  }
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      collectSkillHashFiles(entryPath, files, depth + 1);
      continue;
    }
    if (/\.(md|json|ya?ml|js|ts|py|txt)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
}

function insertBrainSkillEvent(skillId, kind, message, payload = {}) {
  db.prepare(`
    INSERT INTO brain_skill_events (
      skill_id, kind, message, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?)
  `).run(skillId, kind, message, nowIso(), JSON.stringify(payload || {}));
}

function listBrainSkillEvents(skillId, limit = 20) {
  return db
    .prepare(`
      SELECT *
      FROM brain_skill_events
      WHERE skill_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .all(skillId, clampNumber(limit, 20, 1, 100))
    .map(fromBrainSkillEventRow);
}

function upsertBrainSkillNode(skill) {
  const nodeId = `brain-${skill.id}`;
  const existing = getNode(nodeId);
  const node = {
    id: nodeId,
    parentId: null,
    name: skill.name,
    type: "skill",
    summary: skill.summary,
    severity: "low",
    openIssues: 0,
    files: uniqueStrings([skill.localPath, skill.entryFile].filter(Boolean)),
    relations: [],
    contextWindow: [
      { label: "Brain skill", detail: skill.name },
      ...(skill.sourceUrl ? [{ label: "Git source", detail: skill.sourceUrl }] : []),
      ...(skill.capabilities.length ? [{ label: "Capabilities", detail: skill.capabilities.join(", ") }] : []),
      ...(skill.tags.length ? [{ label: "Tags", detail: skill.tags.join(", ") }] : []),
      ...(skill.entryFile ? [{ label: "Entry file", detail: skill.entryFile }] : []),
      ...(skill.versionHash ? [{ label: "Version", detail: skill.versionHash }] : []),
    ],
    debugSignals: existing?.debugSignals || [],
    chatHistory: existing?.chatHistory || [],
    notes: existing?.notes || [],
  };
  if (existing) {
    updateNode({ ...existing, ...node });
  } else {
    insertNode(node);
  }
}

function brainSkillMatchesQuery(skill, query) {
  return buildBrainSkillHaystack(skill).includes(String(query || "").toLowerCase());
}

function buildBrainSkillHaystack(skill) {
  return [
    skill.name,
    skill.summary,
    skill.sourceUrl,
    skill.localPath,
    ...(skill.capabilities || []),
    ...(skill.tags || []),
    ...(skill.usage?.whenToUse || []),
    ...(skill.usage?.workflow || []),
    ...(skill.usage?.safety || []),
  ]
    .join(" ")
    .toLowerCase();
}

function buildBrainSkillRationale(skill, criteria = {}) {
  const reasons = [];
  if (criteria.capability && skill.capabilities.includes(criteria.capability)) {
    reasons.push(`matches capability ${criteria.capability}`);
  }
  if (criteria.query && brainSkillMatchesQuery(skill, criteria.query)) {
    reasons.push(`matches query ${criteria.query}`);
  }
  if (skill.versionHash) {
    reasons.push(`indexed version ${skill.versionHash}`);
  }
  if (skill.entryFile) {
    reasons.push(`entry ${path.basename(skill.entryFile)}`);
  }
  return reasons.length ? reasons : ["available active brain skill"];
}

function nodeMatchesWorkspace(node, workspacePath) {
  const normalizedWorkspace = normalizePath(workspacePath);
  return (node.files || []).some((file) => {
    const normalizedFile = normalizePath(file);
    return normalizedFile === normalizedWorkspace || normalizedFile.startsWith(`${normalizedWorkspace}/`);
  });
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

function getContextForFiles(filePaths) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean).map(p => String(p).trim());
  if (!paths.length) {
    return { files: [], nodes: [], recentEdits: [], openErrors: [], relatedNodes: [] };
  }

  const allNodes = listNodes();
  const matchedNodes = [];
  const seen = new Set();

  paths.forEach(filePath => {
    const normalizedFile = filePath.toLowerCase();
    allNodes.forEach(node => {
      if (seen.has(node.id)) return;
      if (node.files.some(f => f.toLowerCase().includes(normalizedFile) || normalizedFile.includes(f.toLowerCase()))) {
        seen.add(node.id);
        matchedNodes.push(node);
      }
    });
  });

  const recentEdits = allNodes
    .filter(n => n.type === "edit" && paths.some(fp => n.files.some(f => f.toLowerCase().includes(fp.toLowerCase()))))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 10)
    .map(n => ({
      id: n.id,
      file: n.files[0] || "",
      summary: n.summary,
      notes: n.notes.slice(0, 3),
      updatedAt: n.updatedAt,
    }));

  const openErrors = allNodes
    .filter(n => n.type === "error" && n.openIssues > 0 && paths.some(fp => n.files.some(f => f.toLowerCase().includes(fp.toLowerCase()))))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 10)
    .map(n => ({
      id: n.id,
      file: n.files[0] || "",
      summary: n.summary,
      severity: n.severity,
      debugSignals: n.debugSignals.slice(0, 3),
      updatedAt: n.updatedAt,
    }));

  const relatedIds = new Set();
  matchedNodes.forEach(n => {
    (n.relations || []).forEach(rid => {
      if (!seen.has(rid)) relatedIds.add(rid);
    });
    if (n.parentId && !seen.has(n.parentId)) relatedIds.add(n.parentId);
  });

  const relatedNodes = [...relatedIds]
    .map(id => getNode(id))
    .filter(Boolean)
    .slice(0, 8)
    .map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      summary: n.summary,
      files: n.files.slice(0, 3),
    }));

  const compactNodes = matchedNodes.map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    summary: n.summary,
    severity: n.severity,
    notes: n.notes.slice(0, 5),
    debugSignals: n.debugSignals.slice(0, 5),
    contextWindow: n.contextWindow.slice(0, 5),
    openIssues: n.openIssues,
    updatedAt: n.updatedAt,
  }));

  return {
    files: paths,
    nodes: compactNodes,
    recentEdits,
    openErrors,
    relatedNodes,
  };
}

function getContextWindow(options = {}) {
  const nodeId = typeof options.nodeId === "string" ? options.nodeId.trim() : "";
  const file = typeof options.file === "string" ? options.file.trim() : "";
  const location = typeof options.location === "string" ? options.location.trim() : "";
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const workspacePath = typeof options.workspacePath === "string" ? options.workspacePath.trim() : "";
  const limit = clampNumber(options.limit, 8, 1, 30);

  const nodes = listNodes();
  let scored = nodes
    .map((node) => {
      const score = scoreNodeForContext(node, { nodeId, file, location, query, workspacePath });
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (workspacePath) {
    const workspaceMatches = scored.filter((entry) => nodeMatchesWorkspace(entry.node, workspacePath));
    if (workspaceMatches.length) {
      scored = workspaceMatches;
    }
  }

  scored = scored.slice(0, limit);

  const topNode = scored[0]?.node || null;
  const compactNodes = scored.map(({ node, score }) => compactContextNode(node, score));
  const recommendedFiles = getRecommendedFilesFromNodes(scored.map((entry) => entry.node));

  return {
    filters: { nodeId, file, location, query, workspacePath, limit },
    topNodeId: topNode?.id || null,
    count: compactNodes.length,
    contextNodes: compactNodes,
    recommendedFiles,
    tokenEstimate: estimateContextTokens({ contextNodes: compactNodes, recommendedFiles }),
  };
}

function traceExecution(options = {}) {
  const window = getContextWindow({ ...options, limit: clampNumber(options.limit, 12, 3, 40) });
  const anchorNode = window.topNodeId ? getNode(window.topNodeId) : null;

  if (!anchorNode) {
    return {
      anchorNodeId: null,
      traces: [],
      traceCount: 0,
    };
  }

  const contextGraph = getContextGraph(anchorNode.id);
  if (!contextGraph) {
    return {
      anchorNodeId: anchorNode.id,
      traces: [],
      traceCount: 0,
    };
  }

  const trace = buildExecutionTraceFromContextGraph(contextGraph);
  return {
    anchorNodeId: anchorNode.id,
    traces: trace.length ? [trace] : [],
    traceCount: trace.length ? 1 : 0,
  };
}

function impactOfChange(options = {}) {
  const nodeId = typeof options.nodeId === "string" ? options.nodeId.trim() : "";
  const file = typeof options.file === "string" ? options.file.trim() : "";
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const maxNodes = clampNumber(options.maxNodes, 15, 3, 80);

  const nodes = listNodes();
  const seedSet = new Set();

  if (nodeId && getNode(nodeId)) {
    seedSet.add(nodeId);
  }

  if (file || query) {
    traceNodes({ file, query, location: "" }).forEach((node) => seedSet.add(node.id));
  }

  if (!seedSet.size) {
    const fallback = getContextWindow({ ...options, limit: 3 });
    (fallback.contextNodes || []).forEach((node) => seedSet.add(node.id));
  }

  const impacted = new Map();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  seedSet.forEach((seedId) => {
    const seed = nodesById.get(seedId);
    if (!seed) return;
    registerImpactNode(impacted, seed, 120, ["seed"]);

    if (seed.parentId && nodesById.has(seed.parentId)) {
      registerImpactNode(impacted, nodesById.get(seed.parentId), 85, ["parent"]);
    }

    nodes
      .filter((node) => node.parentId === seed.id)
      .forEach((node) => registerImpactNode(impacted, node, 80, ["child"]));

    (seed.relations || [])
      .map((id) => nodesById.get(id))
      .filter(Boolean)
      .forEach((node) => registerImpactNode(impacted, node, 78, ["relation"]));

    nodes
      .filter((node) => node.id !== seed.id && sharesFiles(node.files, seed.files))
      .forEach((node) => registerImpactNode(impacted, node, 70, ["shared_file"]));
  });

  const results = [...impacted.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, maxNodes)
    .map((entry) => compactImpactNode(entry.node, entry.score, entry.reasons));

  return {
    seedNodeIds: [...seedSet],
    count: results.length,
    results,
  };
}

function getDebugContext(options = {}) {
  const contextWindow = getContextWindow(options);
  const execution = traceExecution({
    ...options,
    nodeId: options.nodeId || contextWindow.topNodeId || "",
  });
  const impact = impactOfChange({
    ...options,
    nodeId: options.nodeId || contextWindow.topNodeId || "",
  });

  return {
    summary: {
      topNodeId: contextWindow.topNodeId,
      contextCount: contextWindow.count,
      traceCount: execution.traceCount,
      impactCount: impact.count,
      tokenEstimate: contextWindow.tokenEstimate,
    },
    contextWindow,
    execution,
    impact,
  };
}

function sessionBootstrap(workspacePath, toolSource = "agent") {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  if (!normalizedPath) {
    throw new Error("workspacePath la bat buoc.");
  }

  const existingRunning = listActivityRuns({ status: "running", workspacePath: normalizedPath, limit: 1 });
  let run;
  if (existingRunning.length) {
    run = existingRunning[0];
    heartbeatActivity(run.id, { message: `Session resumed by ${toolSource}` });
  } else {
    run = startActivity({
      workspacePath: normalizedPath,
      toolSource: normalizeToolSource(toolSource),
      summary: `Session started by ${toolSource}`,
    });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const allNodes = listNodes();

  const recentEdits = allNodes
    .filter(n => n.type === "edit" && n.updatedAt >= sevenDaysAgo && n.files.some(f => normalizeWorkspacePath(f).toLowerCase().startsWith(normalizedPath.toLowerCase())))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 15)
    .map(n => ({
      id: n.id,
      file: n.files[0] || "",
      summary: n.summary,
      updatedAt: n.updatedAt,
    }));

  const openErrors = allNodes
    .filter(n => n.type === "error" && n.openIssues > 0 && n.files.some(f => normalizeWorkspacePath(f).toLowerCase().startsWith(normalizedPath.toLowerCase())))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 10)
    .map(n => ({
      id: n.id,
      file: n.files[0] || "",
      summary: n.summary,
      severity: n.severity,
      debugSignals: n.debugSignals.slice(0, 2),
      updatedAt: n.updatedAt,
    }));

  const lastTouchedFiles = [...new Set(recentEdits.map(e => e.file).filter(Boolean))].slice(0, 20);

  const recentSessions = listActivityRuns({ workspacePath: normalizedPath, limit: 5 })
    .map(s => ({
      id: s.id,
      status: s.status,
      toolSource: s.toolSource,
      summary: s.summary,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }));

  const reusableModules = findReusableModules({
    workspacePath: normalizedPath,
    limit: 5,
  }).modules;
  const implementation = getImplementationContext({
    workspacePath: normalizedPath,
    limit: 3,
    recentLimit: 2,
    eventLimit: 4,
  });

  return {
    runId: run.id,
    workspacePath: normalizedPath,
    projectId: run.projectId || null,
    projectName: run.projectName || path.basename(normalizedPath),
    isResumed: existingRunning.length > 0,
    recentWork: {
      edits: recentEdits,
      editCount: recentEdits.length,
      openErrors,
      errorCount: openErrors.length,
    },
    lastTouchedFiles,
    reusableModules,
    implementation,
    recentSessions,
    hint: "Use get_context_for_file with specific file paths to get detailed context. Use record_outcome when your task is done.",
  };
}

function registerReusableModule(payload = {}) {
  const workspacePath = normalizeWorkspacePath(payload.workspacePath || payload.projectRoot || payload.rootPath);
  const entryPath = normalizeOptionalPath(payload.entryPath || payload.file || payload.path);
  const capability = sanitizeCapability(payload.capability || payload.name || entryPath || "module");
  const name =
    normalizeOptionalText(payload.name) ||
    `${capability.toUpperCase()} Module`;

  if (!workspacePath || !entryPath) {
    throw new Error("workspacePath va entryPath la bat buoc.");
  }

  const projectNode = ensureProjectNodeForWorkspace(workspacePath, {
    toolSource: payload.toolSource || "manual",
    projectName: payload.projectName,
  });
  const moduleId =
    typeof payload.id === "string" && payload.id.trim()
      ? sanitizeId(payload.id)
      : `module-${sanitizeId(`${workspacePath}-${capability}-${entryPath}`)}`;
  const existing = getNode(moduleId);
  const capabilityTags = uniqueStrings([
    capability,
    ...normalizeStringArray(payload.capabilities),
    ...inferCapabilitiesFromText(`${name} ${entryPath} ${payload.summary || ""}`),
  ]);
  const files = uniqueStrings([
    entryPath,
    ...normalizeStringArray(payload.files),
  ]);
  const dependencyNames = normalizeStringArray(payload.dependencies);
  const tags = normalizeStringArray(payload.tags);
  const frameworkAdapters = normalizeStringArray(payload.frameworkAdapters);
  const roles = normalizeStringArray(payload.roles);
  const moduleRoot = normalizeOptionalText(payload.moduleRoot);
  const canonicalKey =
    normalizeOptionalText(payload.canonicalKey) ||
    buildModuleCanonicalKey({ workspacePath, moduleRoot, entryPath });
  const dependencyFingerprint = normalizeStringArray(payload.dependencyFingerprint);
  const envVars = normalizeStringArray(payload.envVars);
  const configKeys = normalizeStringArray(payload.configKeys);
  const adapterSignals = normalizeStringArray(payload.adapterSignals);
  const exampleFiles = normalizeStringArray(payload.exampleFiles);
  const testFiles = normalizeStringArray(payload.testFiles);
  const documentationFiles = normalizeStringArray(payload.documentationFiles);
  const reuseRecommendation = normalizeOptionalText(payload.reuseRecommendation);
  const adapterBoundary = normalizeOptionalText(payload.adapterBoundary);
  const notes = uniqueStrings([
    payload.note || "",
    ...normalizeStringArray(payload.notes),
    payload.reuseHint || "",
  ]);
  const summary =
    normalizeOptionalText(payload.summary) ||
    `Reusable ${capability} module from ${path.basename(workspacePath)}.`;
  const copyabilityScore = clampNumber(payload.copyabilityScore, 70, 0, 100);
  const adaptationCost = clampNumber(payload.adaptationCost, 30, 0, 100);
  const maturityScore = clampNumber(payload.maturityScore, 60, 0, 100);

  const node = {
    id: moduleId,
    parentId: projectNode?.id || null,
    name,
    type: "module",
    summary,
    severity: payload.severity || "low",
    files,
    relations: uniqueStrings([
      ...(existing?.relations || []),
      ...(projectNode ? [projectNode.id] : []),
    ]),
    contextWindow: [
      { label: "Capability", detail: capabilityTags.join(", ") || capability },
      { label: "Workspace root", detail: workspacePath },
      { label: "Entry path", detail: entryPath },
      ...(moduleRoot ? [{ label: "Module root", detail: moduleRoot }] : []),
      { label: "Canonical key", detail: canonicalKey },
      { label: "Registry version", detail: MODULE_REGISTRY_VERSION },
      { label: "Registry status", detail: "active" },
      { label: "Harvested at", detail: nowIso() },
      { label: "Copyability score", detail: `${copyabilityScore}/100` },
      { label: "Adaptation cost", detail: `${adaptationCost}/100` },
      { label: "Maturity score", detail: `${maturityScore}/100` },
      ...(payload.structureScore !== undefined
        ? [{ label: "Structure score", detail: `${clampNumber(payload.structureScore, 0, 0, 100)}/100` }]
        : []),
      ...(payload.confidence !== undefined
        ? [{ label: "Harvest confidence", detail: `${clampNumber(payload.confidence, 0, 0, 100)}/100` }]
        : []),
      ...(payload.fileCount !== undefined
        ? [{ label: "File count", detail: String(clampNumber(payload.fileCount, 0, 0, 9999)) }]
        : []),
      ...(payload.exportedSymbolCount !== undefined
        ? [{ label: "Exported symbols", detail: String(clampNumber(payload.exportedSymbolCount, 0, 0, 9999)) }]
        : []),
      ...(reuseRecommendation ? [{ label: "Reuse recommendation", detail: reuseRecommendation }] : []),
      ...(adapterBoundary ? [{ label: "Adapter boundary", detail: adapterBoundary }] : []),
      ...(dependencyNames.length ? [{ label: "Dependencies", detail: dependencyNames.join(", ") }] : []),
      ...(dependencyFingerprint.length ? [{ label: "Dependency fingerprint", detail: dependencyFingerprint.join(", ") }] : []),
      ...(envVars.length ? [{ label: "Env vars", detail: envVars.join(", ") }] : []),
      ...(configKeys.length ? [{ label: "Config keys", detail: configKeys.join(", ") }] : []),
      ...(adapterSignals.length ? [{ label: "Adapter signals", detail: adapterSignals.join(", ") }] : []),
      ...(testFiles.length ? [{ label: "Tests", detail: testFiles.map((item) => path.basename(item)).join(", ") }] : []),
      ...(exampleFiles.length ? [{ label: "Examples", detail: exampleFiles.map((item) => path.basename(item)).join(", ") }] : []),
      ...(documentationFiles.length ? [{ label: "Docs", detail: documentationFiles.map((item) => path.basename(item)).join(", ") }] : []),
      ...(frameworkAdapters.length ? [{ label: "Framework adapters", detail: frameworkAdapters.join(", ") }] : []),
      ...(roles.length ? [{ label: "Roles", detail: roles.join(", ") }] : []),
      ...(tags.length ? [{ label: "Tags", detail: tags.join(", ") }] : []),
      ...(normalizeOptionalText(payload.integrationHint)
        ? [{ label: "Integration hint", detail: payload.integrationHint.trim() }]
        : []),
    ],
    debugSignals: existing?.debugSignals || [],
    chatHistory: existing?.chatHistory || [],
    notes: uniqueStrings([...(existing?.notes || []), ...notes]),
    openIssues: Number(existing?.openIssues || 0),
  };

  if (existing) {
    updateNode({
      ...existing,
      ...node,
      files: uniqueStrings([...(existing.files || []), ...node.files]),
      relations: uniqueStrings([...(existing.relations || []), ...node.relations]),
      contextWindow: node.contextWindow,
      notes: node.notes,
    });
  } else {
    insertNode(node);
  }

  return getNode(moduleId);
}

function listReusableModules(filters = {}) {
  const capability = sanitizeCapability(filters.capability || "");
  const workspacePath = normalizeWorkspacePath(filters.workspacePath || "");
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const includeLegacy = Boolean(filters.includeLegacy);
  const limit = clampNumber(filters.limit, 20, 1, 100);

  return listNodes()
    .filter((node) => node.type === "module")
    .filter((node) => {
      if (includeLegacy) {
        return true;
      }
      return extractRegistryVersion(node) === MODULE_REGISTRY_VERSION && (extractRegistryStatus(node) || "active") === "active";
    })
    .filter((node) => {
      if (capability) {
        const capabilities = extractCapabilitiesFromNode(node);
        if (!capabilities.includes(capability)) {
          return false;
        }
      }
      if (workspacePath) {
        const roots = extractWorkspaceRootsFromNode(node);
        if (!roots.some((root) => normalizePath(root) === normalizePath(workspacePath))) {
          return false;
        }
      }
      if (query && !matchesQuery(node, query)) {
        return false;
      }
      return true;
    })
    .sort(sortNodesForContext)
    .slice(0, limit);
}

function findReusableModules(filters = {}) {
  const capability = sanitizeCapability(filters.capability || "");
  const query = normalizeOptionalText(filters.query)?.toLowerCase() || "";
  const workspacePath = normalizeWorkspacePath(filters.workspacePath || "");
  const includeLegacy = Boolean(filters.includeLegacy);
  const limit = clampNumber(filters.limit, 8, 1, 30);
  const adoptionIndex = buildModuleAdoptionIndex(workspacePath);
  const verificationIndex = buildModuleVerificationIndex(workspacePath);

  const scored = listNodes()
    .filter((node) => node.type === "module")
    .filter((node) => {
      if (includeLegacy) {
        return true;
      }
      return extractRegistryVersion(node) === MODULE_REGISTRY_VERSION && (extractRegistryStatus(node) || "active") === "active";
    })
    .map((node) => {
      const capabilities = extractCapabilitiesFromNode(node);
      const workspaceRoots = extractWorkspaceRootsFromNode(node);
      const adoptionMemory = adoptionIndex.get(node.id) || null;
      const verificationMemory = verificationIndex.get(node.id) || null;
      let score = recencyScore(node.updatedAt) + 8;
      if (capability && capabilities.includes(capability)) score += 40;
      if (query && matchesQuery(node, query)) score += 20;
      if (!query && !capability) score += 4;
      if (workspacePath && workspaceRoots.some((root) => normalizePath(root) === normalizePath(workspacePath))) {
        score += 8;
      }
      if (workspacePath && workspaceRoots.some((root) => normalizePath(root) !== normalizePath(workspacePath))) {
        score += 6;
      }
      const copyability = extractNumericContextValue(node, "Copyability score");
      const adaptation = extractNumericContextValue(node, "Adaptation cost");
      const maturity = extractNumericContextValue(node, "Maturity score");
      const recommendation = extractContextDetail(node, "Reuse recommendation");
      score += Math.round(copyability / 10);
      score += Math.round(maturity / 20);
      score -= Math.round(adaptation / 20);
      if (recommendation === "ready-to-copy") score += 12;
      if (recommendation === "adapt-with-care") score += 6;
      if (recommendation === "reference-only") score -= 8;
      if (adoptionMemory) {
        score += Math.min(adoptionMemory.validatedCount * 4, 12);
        score += Math.min(adoptionMemory.targetProjectCount * 3, 9);
      }
      if (verificationMemory) {
        score += Math.min(verificationMemory.passedCount * 4, 12);
        score += verificationMemory.topFixPatterns.length ? 3 : 0;
        score -= Math.min(verificationMemory.failedCount * 2, 6);
      }
      return { node, score, capabilities, workspaceRoots, adoptionMemory, verificationMemory };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    filters: { capability, query, workspacePath, limit },
    count: scored.length,
    modules: scored.map(({ node, score, capabilities, workspaceRoots, adoptionMemory, verificationMemory }) => ({
      id: node.id,
      name: node.name,
      score,
      capabilities,
      workspaceRoots: workspaceRoots.slice(0, 3),
      files: (node.files || []).slice(0, 6),
      summary: node.summary,
      reuseRecommendation: extractContextDetail(node, "Reuse recommendation") || null,
      adapterBoundary: extractContextDetail(node, "Adapter boundary") || null,
      envVars: extractContextDetail(node, "Env vars")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      configKeys: extractContextDetail(node, "Config keys")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      adoptionMemory: adoptionMemory
        ? {
            validatedCount: adoptionMemory.validatedCount,
            targetProjectCount: adoptionMemory.targetProjectCount,
            recentPatterns: adoptionMemory.recentPatterns,
          }
        : null,
      verificationMemory: verificationMemory
        ? {
            passedCount: verificationMemory.passedCount,
            failedCount: verificationMemory.failedCount,
            topPassedTests: verificationMemory.topPassedTests,
            topFixPatterns: verificationMemory.topFixPatterns,
          }
        : null,
      notes: (node.notes || []).slice(0, 3),
      contextWindow: (node.contextWindow || []).slice(0, 12),
      updatedAt: node.updatedAt,
    })),
    tokenEstimate: estimateContextTokens(scored.map(({ node, score }) => compactContextNode(node, score))),
  };
}

function harvestReusableModules(rootPath, options = {}) {
  const workspacePath = normalizeWorkspacePath(rootPath);
  if (!workspacePath) {
    throw new Error("rootPath la bat buoc.");
  }

  const maxDepth = clampNumber(options.maxDepth, 5, 1, 8);
  const maxFiles = clampNumber(options.maxFiles, 300, 20, 2000);
  const candidates = buildModuleHarvestCandidates(workspacePath, {
    maxDepth,
    maxFiles,
  });

  const registered = [];
  const seen = new Set();
  candidates.forEach((candidate) => {
    const primaryCapability = selectPrimaryCapabilityForCandidate(candidate);
    const surfaceMatches = inferSurfaceCapabilities(candidate);
    const shouldFeaturePrimaryCapability = surfaceMatches.includes(primaryCapability);
    const canonicalKey = buildModuleCanonicalKey({
      workspacePath,
      moduleRoot: candidate.moduleRoot,
      entryPath: candidate.entryPath,
    });
    const dedupeKey = `${candidate.moduleRoot}::${primaryCapability}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    seen.add(canonicalKey);
    registered.push(
      registerReusableModule({
        capability: primaryCapability,
        capabilities: candidate.capabilities,
        entryPath: candidate.entryPath,
        workspacePath,
        moduleRoot: candidate.moduleRoot,
        canonicalKey,
        name: `${candidate.name}${shouldFeaturePrimaryCapability ? ` (${primaryCapability})` : ""}`,
        summary:
          shouldFeaturePrimaryCapability
            ? `Structured reusable ${primaryCapability} module harvested from ${candidate.moduleRoot}.`
            : `Structured reusable module harvested from ${candidate.moduleRoot}.`,
        integrationHint: `Start from ${path.relative(workspacePath, candidate.entryPath).replaceAll("\\", "/")} and adapt adapters/config around ${candidate.moduleRoot}.`,
        copyabilityScore: candidate.copyabilityScore,
        adaptationCost: candidate.adaptationCost,
        maturityScore: candidate.maturityScore,
        structureScore: candidate.structureScore,
        confidence: candidate.confidence,
        fileCount: candidate.fileCount,
        exportedSymbolCount: candidate.exportedSymbolCount,
        frameworkAdapters: candidate.frameworkAdapters,
        roles: candidate.roles,
        dependencies: candidate.externalDependencies,
        dependencyFingerprint: candidate.externalDependencies,
        envVars: candidate.sourceSignals.envVars,
        configKeys: candidate.sourceSignals.configKeys,
        adapterSignals: candidate.sourceSignals.adapterSignals,
        testFiles: candidate.sourceSignals.evidence.tests,
        exampleFiles: candidate.sourceSignals.evidence.examples,
        documentationFiles: candidate.sourceSignals.evidence.docs,
        reuseRecommendation: candidate.reuseRecommendation,
        adapterBoundary: candidate.adapterBoundary,
        files: candidate.files,
        tags: ["harvested", "auto", "structured"],
        notes: [
          candidate.routePaths.length ? `Routes: ${candidate.routePaths.slice(0, 6).join(", ")}` : "",
          candidate.exportedSymbols.length ? `Exports: ${candidate.exportedSymbols.slice(0, 8).join(", ")}` : "",
          ...candidate.reuseNotes,
        ].filter(Boolean),
      })
    );
  });

  const cleanup = cleanupModuleRegistry(workspacePath, {
    activeCanonicalKeys: [...new Set(candidates.map((candidate) => buildModuleCanonicalKey({
      workspacePath,
      moduleRoot: candidate.moduleRoot,
      entryPath: candidate.entryPath,
    })))],
  });

  return {
    workspacePath,
    maxDepth,
    maxFiles,
    discoveredFileCount: candidates.reduce((sum, candidate) => sum + candidate.fileCount, 0),
    candidateCount: candidates.length,
    registeredCount: registered.length,
    cleanup,
    modules: registered.map((node) => ({
      id: node.id,
      name: node.name,
      summary: node.summary,
      files: node.files.slice(0, 4),
      contextWindow: node.contextWindow.slice(0, 4),
    })),
  };
}

function getLowTokenContext(options = {}) {
  const workspacePath = normalizeWorkspacePath(options.workspacePath || "");
  if (!workspacePath) {
    throw new Error("workspacePath la bat buoc.");
  }

  const query = normalizeOptionalText(options.query) || "";
  const capability = sanitizeCapability(options.capability || query);
  const bootstrap = sessionBootstrap(workspacePath, options.toolSource || "agent");
  const debugContext = getDebugContext({
    workspacePath,
    file: options.file,
    location: options.location,
    query,
    limit: clampNumber(options.limit, 6, 1, 20),
    maxNodes: clampNumber(options.maxNodes, 10, 3, 40),
  });
  const reusable = findReusableModules({
    workspacePath,
    capability,
    query,
    limit: clampNumber(options.moduleLimit, 5, 1, 12),
  });
  const projectMatches = matchProjectToReusableModules({
    workspacePath,
    capability,
    query,
    limit: clampNumber(options.matchLimit, 4, 1, 10),
  });
  const implementation = getImplementationContext({
    workspacePath,
    limit: 3,
    recentLimit: 2,
    eventLimit: 4,
  });
  const brainSkills = recommendBrainSkills({
    workspacePath,
    capability,
    query,
    limit: clampNumber(options.skillLimit, 4, 1, 10),
  });
  const projectNode = bootstrap.projectId ? getNode(bootstrap.projectId) : null;

  return {
    workspacePath,
    project: projectNode
      ? {
          id: projectNode.id,
          name: projectNode.name,
          summary: projectNode.summary,
          files: (projectNode.files || []).slice(0, 4),
        }
      : null,
    recentWork: bootstrap.recentWork,
    brainSkills: brainSkills.skills,
    reusableModules: reusable.modules,
    projectMatches: projectMatches.matches,
    adoptionRecipes: projectMatches.matches.slice(0, 3).map((match) => ({
      moduleId: match.id,
      moduleName: match.name,
      recommendedAction: match.recommendedAction,
      recipe: match.adoptionRecipe,
    })),
    executionAssists: projectMatches.matches.slice(0, 3).map((match) => ({
      moduleId: match.id,
      moduleName: match.name,
      recommendedAction: match.recommendedAction,
      execution: match.executionAssist,
    })),
    patchDrafts: projectMatches.matches.slice(0, 2).map((match) => ({
      moduleId: match.id,
      moduleName: match.name,
      recommendedAction: match.recommendedAction,
      patchDraft: match.patchDraft,
    })),
    verificationMemories: projectMatches.matches.slice(0, 3).map((match) => ({
      moduleId: match.id,
      moduleName: match.name,
      recommendedAction: match.recommendedAction,
      verification: match.verificationMemory,
    })),
    implementation,
    debugContext: {
      summary: debugContext.summary,
      recommendedFiles: debugContext.contextWindow.recommendedFiles,
      topContextNodes: debugContext.contextWindow.contextNodes.slice(0, 4),
      impact: debugContext.impact.results?.slice(0, 5) || [],
    },
    recommendations: [
      projectMatches.matches.length
        ? "Check projectMatches first and copy/adapt before writing new code."
        : reusable.modules.length
          ? "Check reusableModules first before generating new code."
          : "No strong reusable module match found; continue with focused context retrieval.",
      brainSkills.skills.length
        ? "Check brainSkills first for the operating playbook before opening raw code."
        : "If this workflow repeats, add a brain skill from Git and re-run low-token context.",
      projectMatches.matches.some((match) => match.adoptionRecipe?.checklist?.length)
        ? "Use adoptionRecipes as the default integration checklist before opening raw history."
        : "If no recipe exists yet, inspect module cards and adoption memory together.",
      projectMatches.matches.some((match) => match.executionAssist?.startHere)
        ? "Use executionAssists to decide the first file to modify before drafting patches."
        : "If no execution assist exists yet, derive a patch plan from the recipe sections.",
      projectMatches.matches.some((match) => match.patchDraft?.draftFiles?.length)
        ? "Use patchDrafts when you want file skeletons before opening or editing target files."
        : "If no patch draft exists yet, promote executionAssists into file-by-file skeleton drafts first.",
      projectMatches.matches.some((match) => match.verificationMemory?.passedCount || match.verificationMemory?.topFixPatterns?.length)
        ? "Use verificationMemories to prefer known passing tests and proven fix patterns before opening raw integration logs."
        : "If verification memory is empty, record the first passing tests and integration fixes as soon as they are known.",
      implementation.primaryThread
        ? "Resume from implementation.primaryThread before creating a new task thread."
        : "No resumable implementation thread found; start a fresh task thread if needed.",
      "Prefer recommendedFiles over opening whole directories.",
      "Only inspect source snippets after summaries and module cards are insufficient.",
    ],
    tokenEstimate: estimateContextTokens({
      recentWork: bootstrap.recentWork,
      brainSkills: brainSkills.skills.slice(0, 3).map((skill) => ({
        id: skill.id,
        name: skill.name,
        summary: skill.summary,
        capabilities: skill.capabilities,
      })),
      reusableModules: reusable.modules,
      projectMatches: projectMatches.matches,
      adoptionRecipes: projectMatches.matches.slice(0, 2).map((match) => ({
        moduleId: match.id,
        strategy: match.adoptionRecipe?.strategy,
        checklist: match.adoptionRecipe?.checklist?.slice(0, 4),
      })),
      executionAssists: projectMatches.matches.slice(0, 2).map((match) => ({
        moduleId: match.id,
        startHere: match.executionAssist?.startHere,
        patchPlan: match.executionAssist?.patchPlan?.slice(0, 3),
      })),
      verificationMemories: projectMatches.matches.slice(0, 2).map((match) => ({
        moduleId: match.id,
        passedCount: match.verificationMemory?.passedCount,
        topPassedTests: match.verificationMemory?.topPassedTests?.slice(0, 2),
        topFixPatterns: match.verificationMemory?.topFixPatterns?.slice(0, 2),
      })),
      implementation: implementation.primaryThread ? compactImplementationThread(implementation.primaryThread) : null,
      debugContext: {
        summary: debugContext.summary,
        topContextNodes: debugContext.contextWindow.contextNodes.slice(0, 4),
      },
    }),
  };
}

function scoreNodeForContext(node, criteria) {
  let score = 0;
  const normalizedFiles = (node.files || []).map((item) => String(item || "").toLowerCase());

  if (criteria.nodeId && node.id === criteria.nodeId) {
    score += 120;
  }

  if (criteria.file) {
    const normalizedFile = criteria.file.toLowerCase();
    if (normalizedFiles.some((entry) => entry.includes(normalizedFile) || normalizedFile.includes(entry))) {
      score += 70;
    }
  }

  if (criteria.location) {
    const normalizedLocation = criteria.location.toLowerCase();
    if ((node.debugSignals || []).some((signal) => String(signal.location || "").toLowerCase().includes(normalizedLocation))) {
      score += 55;
    }
  }

  if (criteria.query && matchesQuery(node, criteria.query)) {
    score += 45;
  }

  if (criteria.workspacePath) {
    const workspaceNormalized = normalizeWorkspacePath(criteria.workspacePath).toLowerCase();
    if (normalizedFiles.some((entry) => entry.startsWith(workspaceNormalized.toLowerCase()))) {
      score += 30;
    }
  }

  score += Math.min(Number(node.openIssues || 0) * 4, 24);
  score += severityWeight(node.severity);
  score += recencyScore(node.updatedAt);

  return score;
}

function compactContextNode(node, score) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    severity: node.severity,
    score,
    openIssues: Number(node.openIssues || 0),
    updatedAt: node.updatedAt,
    files: (node.files || []).slice(0, 5),
    summary: node.summary,
    debugSignals: (node.debugSignals || []).slice(0, 3),
    contextWindow: (node.contextWindow || []).slice(0, 4),
    notes: (node.notes || []).slice(0, 3),
  };
}

function compactImplementationThread(thread) {
  if (!thread) {
    return null;
  }
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    summary: thread.summary,
    currentStep: thread.currentStep,
    nextStep: thread.nextStep,
    blocker: thread.blocker,
    touchedFiles: (thread.touchedFiles || []).slice(0, 5),
    lastToolSource: thread.lastToolSource,
    latestRunId: thread.latestRunId,
    updatedAt: thread.updatedAt,
    lastActiveAt: thread.lastActiveAt,
  };
}

function compactImpactNode(node, score, reasons = []) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    severity: node.severity,
    score,
    reasons: [...new Set(reasons)],
    openIssues: Number(node.openIssues || 0),
    files: (node.files || []).slice(0, 4),
    summary: node.summary,
    updatedAt: node.updatedAt,
  };
}

function registerImpactNode(map, node, baseScore, reasons = []) {
  if (!node) return;
  const current = map.get(node.id);
  const nextScore = baseScore + severityWeight(node.severity) + Math.min(Number(node.openIssues || 0) * 3, 15);
  if (!current) {
    map.set(node.id, { node, score: nextScore, reasons: [...reasons] });
    return;
  }
  current.score = Math.max(current.score, nextScore);
  current.reasons.push(...reasons);
}

function getRecommendedFilesFromNodes(nodes) {
  const ranked = new Map();
  nodes.forEach((node, nodeIndex) => {
    (node.files || []).forEach((filePath, fileIndex) => {
      const existing = ranked.get(filePath) || {
        filePath,
        score: 0,
        relatedNodeIds: [],
      };
      existing.score += Math.max(1, 10 - nodeIndex * 2 - fileIndex);
      existing.relatedNodeIds.push(node.id);
      ranked.set(filePath, existing);
    });
  });

  return [...ranked.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => ({
      filePath: entry.filePath,
      score: entry.score,
      relatedNodeIds: [...new Set(entry.relatedNodeIds)].slice(0, 4),
    }));
}

function estimateContextTokens(payload) {
  const raw = JSON.stringify(payload || {});
  return Math.ceil(raw.length / 4);
}

function recencyScore(updatedAt) {
  if (!updatedAt) return 0;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 1) return 12;
  if (ageDays <= 3) return 9;
  if (ageDays <= 7) return 6;
  if (ageDays <= 30) return 3;
  return 1;
}

function severityWeight(severity) {
  const value = String(severity || "").toLowerCase();
  if (value === "high") return 10;
  if (value === "medium") return 6;
  if (value === "low") return 2;
  return 0;
}

function buildExecutionTraceFromContextGraph(contextGraph) {
  const nodesById = new Map((contextGraph.nodes || []).map((node) => [node.id, node]));
  const byRole = (role) => (contextGraph.nodes || []).filter((node) => node.graphRole === role);

  const ordered = [
    ...byRole("ancestor"),
    ...byRole("parent"),
    ...byRole("focus"),
    ...byRole("file"),
    ...byRole("error"),
    ...byRole("edit"),
    ...byRole("child"),
    ...byRole("related"),
  ];

  return ordered.map((node, index) => {
    const edgeFromPrev = index > 0
      ? (contextGraph.edges || []).find((edge) => edge.source === ordered[index - 1].id && edge.target === node.id)
      : null;
    return {
      order: index + 1,
      nodeId: node.id,
      name: node.name,
      type: node.type,
      role: node.graphRole || "context",
      via: edgeFromPrev?.type || null,
      filePath: node.files?.[0] || null,
      location: node.debugSignals?.[0]?.location || null,
      summary: node.summary,
    };
  });
}

function buildPipelineCacheKey(rootPath, maxDepth, maxFiles) {
  const normalizedRootPath = path.normalize(String(rootPath || "").trim()).toLowerCase();
  return `pipeline::${normalizedRootPath}::d${Number(maxDepth || 6)}::f${Number(maxFiles || 220)}`;
}

function compactPipelineCache(keep = 40) {
  const limit = Number(keep || 40);
  if (limit < 5) {
    return;
  }
  const staleRows = db
    .prepare(`
      SELECT cache_key FROM pipeline_cache
      ORDER BY datetime(last_accessed_at) DESC
      LIMIT -1 OFFSET ?
    `)
    .all(limit);
  if (!staleRows.length) {
    return;
  }
  const remove = db.prepare("DELETE FROM pipeline_cache WHERE cache_key = ?");
  staleRows.forEach((row) => remove.run(row.cache_key));
}

function clampNumber(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
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
  applyAdoptionPatchDraft,
  backupDatabase,
  buildAdoptionApplyPreview,
  buildAdoptionExecutionAssist,
  buildAdoptionPatchDraft,
  buildAdoptionRecipe,
  createNode,
  deriveNodeName,
  exportGraph,
  finishActivity,
  getActivityOverview,
  getBrainContext,
  getBrainSkill,
  getImplementationContext,
  getActivityRun,
  getContextWindow,
  getDebugContext,
  getContextForFiles,
  getContextGraph,
  getLowTokenContext,
  getModuleAdoptionMemory,
  getModuleAdoption,
  getModuleVerificationMemory,
  getModuleVerification,
  impactOfChange,
  getGraph,
  getNode,
  getPipelineCache,
  cleanupModuleRegistry,
  getStorageInfo,
  getVaultConfig,
  heartbeatActivity,
  harvestReusableModules,
  importGraph,
  listImplementationThreads,
  listActivityRuns,
  listBrainSkills,
  listModuleAdoptions,
  listReusableModules,
  matchProjectToReusableModules,
  recordEdit,
  recordError,
  recordModuleAdoption,
  recordModuleVerification,
  recommendBrainSkills,
  registerBrainSkill,
  registerReusableModule,
  openStorageFolder,
  repairGraphTopology,
  restoreLatestBackup,
  mergeCrawledNodes,
  sanitizeId,
  searchNodes,
  sessionBootstrap,
  setVaultConfig,
  setActiveNode,
  scaffoldVault,
  startActivity,
  updateBrainSkillFromGit,
  savePipelineCache,
  findReusableModules,
  traceNodes,
  traceExecution,
  upsertImplementationThread,
  upsertNodeFromTrace,
};
