const db = require("./db");
const { crawlProjects: crawlProjectsLocal } = require("./crawler");

const DEFAULT_BASE_URL = process.env.GRAPH_MEMORY_BASE_URL || "http://localhost:3010";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function request(path, options = {}) {
  try {
    const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    const payload = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const error = new Error(
        typeof payload === "object" && payload?.message
          ? payload.message
          : `Graph API request failed: ${response.status}`
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (!shouldUseLocalFallback(error)) {
      throw error;
    }
    return handleLocalRequest(path, options);
  }
}

function shouldUseLocalFallback(error) {
  try {
    const baseUrl = new URL(DEFAULT_BASE_URL);
    if (!LOCAL_HOSTS.has(baseUrl.hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  if (!error) {
    return true;
  }

  if (typeof error.status === "number") {
    return false;
  }

  const code = error.cause?.code || error.code || "";
  return (
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EHOSTUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(code) || String(error.message || "").toLowerCase().includes("fetch failed")
  );
}

function handleLocalRequest(requestPath, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const requestUrl = new URL(requestPath, DEFAULT_BASE_URL);
  const body = parseBody(options.body);

  if (method === "GET" && requestUrl.pathname === "/api/graph") {
    return db.getGraph();
  }

  if (method === "GET" && requestUrl.pathname === "/api/context-graph") {
    const nodeId = (requestUrl.searchParams.get("nodeId") || "").trim();
    const contextGraph = db.getContextGraph(nodeId);
    if (!contextGraph) {
      throw createRequestError(404, {
        error: "node_not_found",
        message: "Node not found.",
      });
    }
    return contextGraph;
  }

  if (method === "GET" && requestUrl.pathname === "/api/storage") {
    return db.getStorageInfo();
  }

  if (method === "GET" && requestUrl.pathname === "/api/activity/overview") {
    return db.getActivityOverview();
  }

  if (method === "GET" && requestUrl.pathname === "/api/activity/runs") {
    return {
      results: db.listActivityRuns({
        status: requestUrl.searchParams.get("status"),
        projectId: requestUrl.searchParams.get("projectId"),
        workspacePath: requestUrl.searchParams.get("workspacePath"),
        limit: requestUrl.searchParams.get("limit"),
      }),
    };
  }

  if (method === "POST" && requestUrl.pathname === "/api/activity/start") {
    return safelyHandleLocalMutation(() => db.startActivity(body), 400, "activity_start_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/activity/heartbeat") {
    if (!body.runId) {
      throw createRequestError(400, {
        error: "invalid_run",
        message: "runId la bat buoc.",
      });
    }
    const run = db.heartbeatActivity(body.runId, body);
    if (!run) {
      throw createRequestError(404, {
        error: "run_not_found",
        message: "Run not found.",
      });
    }
    return run;
  }

  if (method === "POST" && requestUrl.pathname === "/api/activity/finish") {
    if (!body.runId) {
      throw createRequestError(400, {
        error: "invalid_run",
        message: "runId la bat buoc.",
      });
    }
    const run = db.finishActivity(body.runId, body);
    if (!run) {
      throw createRequestError(404, {
        error: "run_not_found",
        message: "Run not found.",
      });
    }
    return run;
  }

  if (method === "POST" && requestUrl.pathname === "/api/open-folder") {
    return safelyHandleLocalMutation(() => db.openStorageFolder(body.kind), 400, "open_folder_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/export") {
    return safelyHandleLocalMutation(() => db.exportGraph(body.targetPath), 400, "export_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/backup") {
    return safelyHandleLocalMutation(() => db.backupDatabase(body.targetPath), 400, "backup_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/import") {
    return safelyHandleLocalMutation(
      () => db.importGraph(body.sourcePath, body.mode),
      400,
      "import_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/restore-latest-backup") {
    return safelyHandleLocalMutation(() => db.restoreLatestBackup(), 400, "restore_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/crawl-projects") {
    return safelyHandleLocalMutation(() => {
      const crawled = crawlProjectsLocal(body.rootPath, { maxDepth: body.maxDepth });
      const merged = db.mergeCrawledNodes(crawled, body.rootPath);
      return {
        ...merged,
        sample: crawled.slice(0, 12).map((node) => ({
          id: node.id,
          name: node.name,
          path: node.files[0],
          type: node.type,
        })),
      };
    }, 400, "crawl_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/record-edit") {
    return safelyHandleLocalMutation(() => db.recordEdit(body), 400, "record_edit_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/record-error") {
    return safelyHandleLocalMutation(() => db.recordError(body), 400, "record_error_failed");
  }

  if (method === "GET" && requestUrl.pathname === "/api/search") {
    const query = (requestUrl.searchParams.get("query") || "").trim().toLowerCase();
    const results = db.searchNodes(query);
    return {
      query,
      count: results.length,
      results,
    };
  }

  if (method === "GET" && requestUrl.pathname === "/api/trace") {
    const file = (requestUrl.searchParams.get("file") || "").trim();
    const location = (requestUrl.searchParams.get("location") || "").trim();
    const query = (requestUrl.searchParams.get("query") || "").trim();
    const results = db.traceNodes({ file, location, query });

    return {
      filters: { file, location, query },
      count: results.length,
      results: results.map((node) => ({
        id: node.id,
        name: node.name,
        files: node.files,
        relations: node.relations,
        severity: node.severity,
        contextWindow: node.contextWindow,
        debugSignals: node.debugSignals,
      })),
    };
  }

  if (method === "GET" && requestUrl.pathname.startsWith("/api/nodes/")) {
    const nodeId = decodeURIComponent(requestUrl.pathname.replace("/api/nodes/", ""));
    const node = db.getNode(nodeId);
    if (!node) {
      throw createRequestError(404, {
        error: "node_not_found",
        message: "Node not found.",
      });
    }
    return node;
  }

  if (method === "POST" && requestUrl.pathname === "/api/active-node") {
    const graph = db.setActiveNode(body.nodeId);
    if (!graph) {
      throw createRequestError(404, {
        error: "node_not_found",
        message: "Node not found.",
      });
    }
    return graph;
  }

  if (method === "POST" && requestUrl.pathname === "/api/nodes") {
    return safelyHandleLocalMutation(() => db.createNode(body), 400, "invalid_node");
  }

  if (method === "POST" && requestUrl.pathname === "/api/nodes/upsert-from-trace") {
    return safelyHandleLocalMutation(() => db.upsertNodeFromTrace(body), 400, "invalid_trace");
  }

  if (method === "POST" && /^\/api\/nodes\/[^/]+\/notes$/.test(requestUrl.pathname)) {
    const [, , , nodeId] = requestUrl.pathname.split("/");
    if (!body.note || typeof body.note !== "string") {
      throw createRequestError(400, {
        error: "invalid_note",
        message: "invalid_note",
      });
    }
    const graph = db.addNote(nodeId, body.note, body.role);
    if (!graph) {
      throw createRequestError(404, {
        error: "node_not_found",
        message: "Node not found.",
      });
    }
    return graph;
  }

  if (method === "POST" && /^\/api\/nodes\/[^/]+\/debug-signals$/.test(requestUrl.pathname)) {
    const [, , , nodeId] = requestUrl.pathname.split("/");
    if (!body.title || !body.location || !body.symptom) {
      throw createRequestError(400, {
        error: "invalid_debug_signal",
        message: "title, location va symptom la bat buoc.",
      });
    }
    const graph = db.addDebugSignal(nodeId, body);
    if (!graph) {
      throw createRequestError(404, {
        error: "node_not_found",
        message: "Node not found.",
      });
    }
    return graph;
  }

  if (method === "POST" && /^\/api\/nodes\/[^/]+\/chat$/.test(requestUrl.pathname)) {
    const [, , , nodeId] = requestUrl.pathname.split("/");
    if (!body.message || typeof body.message !== "string") {
      throw createRequestError(400, {
        error: "invalid_message",
        message: "invalid_message",
      });
    }
    const graph = db.addChat(nodeId, body.message, body.role);
    if (!graph) {
      throw createRequestError(404, {
        error: "node_not_found",
        message: "Node not found.",
      });
    }
    return graph;
  }

  throw createRequestError(404, {
    error: "not_found",
    message: "Route not found.",
  });
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    return JSON.parse(body);
  }

  return body;
}

function safelyHandleLocalMutation(handler, status, errorCode) {
  try {
    return handler();
  } catch (error) {
    throw createRequestError(status, {
      error: errorCode,
      message: error.message,
    });
  }
}

function createRequestError(status, payload) {
  const error = new Error(payload?.message || `Graph API request failed: ${status}`);
  error.status = status;
  error.payload = payload;
  return error;
}

function toQueryString(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function getGraph() {
  return request("/api/graph");
}

async function getContextGraph(nodeId) {
  return request(`/api/context-graph${toQueryString({ nodeId })}`);
}

async function getStorageInfo() {
  return request("/api/storage");
}

async function getActivityOverview() {
  return request("/api/activity/overview");
}

async function listActivityRuns(filters = {}) {
  return request(`/api/activity/runs${toQueryString(filters)}`);
}

async function startActivity(payload) {
  return request("/api/activity/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function heartbeatActivity(runId, payload = {}) {
  return request("/api/activity/heartbeat", {
    method: "POST",
    body: JSON.stringify({ runId, ...payload }),
  });
}

async function finishActivity(runId, payload = {}) {
  return request("/api/activity/finish", {
    method: "POST",
    body: JSON.stringify({ runId, ...payload }),
  });
}

async function openStorageFolder(kind) {
  return request("/api/open-folder", {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

async function crawlProjects(rootPath, maxDepth = 3) {
  return request("/api/crawl-projects", {
    method: "POST",
    body: JSON.stringify({ rootPath, maxDepth }),
  });
}

async function searchNodes(query) {
  return request(`/api/search${toQueryString({ query })}`);
}

async function traceNode(filters = {}) {
  return request(`/api/trace${toQueryString(filters)}`);
}

async function getNode(nodeId) {
  return request(`/api/nodes/${encodeURIComponent(nodeId)}`);
}

async function setActiveNode(nodeId) {
  return request("/api/active-node", {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });
}

async function createNode(payload) {
  return request("/api/nodes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function upsertNodeFromTrace(payload) {
  return request("/api/nodes/upsert-from-trace", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function addNote(nodeId, note, role = "assistant") {
  return request(`/api/nodes/${encodeURIComponent(nodeId)}/notes`, {
    method: "POST",
    body: JSON.stringify({ note, role }),
  });
}

async function addDebugSignal(nodeId, signal) {
  return request(`/api/nodes/${encodeURIComponent(nodeId)}/debug-signals`, {
    method: "POST",
    body: JSON.stringify(signal),
  });
}

async function addChat(nodeId, message, role = "user") {
  return request(`/api/nodes/${encodeURIComponent(nodeId)}/chat`, {
    method: "POST",
    body: JSON.stringify({ message, role }),
  });
}

async function exportGraph(targetPath) {
  return request("/api/export", {
    method: "POST",
    body: JSON.stringify({ targetPath }),
  });
}

async function backupDatabase(targetPath) {
  return request("/api/backup", {
    method: "POST",
    body: JSON.stringify({ targetPath }),
  });
}

async function importGraph(sourcePath, mode = "replace") {
  return request("/api/import", {
    method: "POST",
    body: JSON.stringify({ sourcePath, mode }),
  });
}

async function restoreLatestBackup() {
  return request("/api/restore-latest-backup", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function recordEdit(payload) {
  return request("/api/record-edit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function recordError(payload) {
  return request("/api/record-error", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

module.exports = {
  addChat,
  backupDatabase,
  crawlProjects,
  createNode,
  addDebugSignal,
  addNote,
  exportGraph,
  finishActivity,
  getActivityOverview,
  getContextGraph,
  getGraph,
  getNode,
  getStorageInfo,
  heartbeatActivity,
  importGraph,
  listActivityRuns,
  openStorageFolder,
  recordEdit,
  recordError,
  restoreLatestBackup,
  searchNodes,
  setActiveNode,
  startActivity,
  traceNode,
  upsertNodeFromTrace,
};
