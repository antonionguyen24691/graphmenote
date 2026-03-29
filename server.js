const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const db = require("./db");
const { crawlProjects } = require("./crawler");

const PORT = Number(process.env.PORT || 3010);
const ROOT = __dirname;
const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, requestUrl);
      return;
    }

    await serveStatic(res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_error",
      message: error.message,
    });
  }
});

server.listen(PORT, () => {
  const storage = db.getStorageInfo();
  console.log(`Graph Memory API running at http://localhost:${PORT}`);
  console.log(`SQLite storage: ${storage.dbPath}`);
});

async function handleApi(req, res, requestUrl) {
  const method = req.method || "GET";

  if (method === "GET" && requestUrl.pathname === "/api/graph") {
    return sendJson(res, 200, db.getGraph());
  }

  if (method === "GET" && requestUrl.pathname === "/api/context-graph") {
    const nodeId = (requestUrl.searchParams.get("nodeId") || "").trim();
    const contextGraph = db.getContextGraph(nodeId);
    if (!contextGraph) {
      return sendJson(res, 404, {
        error: "node_not_found",
      });
    }
    return sendJson(res, 200, contextGraph);
  }

  if (method === "GET" && requestUrl.pathname === "/api/storage") {
    return sendJson(res, 200, db.getStorageInfo());
  }

  if (method === "GET" && requestUrl.pathname === "/api/activity/overview") {
    return sendJson(res, 200, db.getActivityOverview());
  }

  if (method === "GET" && requestUrl.pathname === "/api/activity/runs") {
    return sendJson(res, 200, {
      results: db.listActivityRuns({
        status: requestUrl.searchParams.get("status"),
        projectId: requestUrl.searchParams.get("projectId"),
        workspacePath: requestUrl.searchParams.get("workspacePath"),
        limit: requestUrl.searchParams.get("limit"),
      }),
    });
  }

  if (method === "POST" && requestUrl.pathname === "/api/activity/start") {
    const body = await readBody(req);
    try {
      return sendJson(res, 201, db.startActivity(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "activity_start_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/activity/heartbeat") {
    const body = await readBody(req);
    if (!body.runId) {
      return sendJson(res, 400, {
        error: "invalid_run",
        message: "runId la bat buoc.",
      });
    }
    const run = db.heartbeatActivity(body.runId, body);
    if (!run) {
      return sendJson(res, 404, {
        error: "run_not_found",
      });
    }
    return sendJson(res, 200, run);
  }

  if (method === "POST" && requestUrl.pathname === "/api/activity/finish") {
    const body = await readBody(req);
    if (!body.runId) {
      return sendJson(res, 400, {
        error: "invalid_run",
        message: "runId la bat buoc.",
      });
    }
    const run = db.finishActivity(body.runId, body);
    if (!run) {
      return sendJson(res, 404, {
        error: "run_not_found",
      });
    }
    return sendJson(res, 200, run);
  }

  if (method === "POST" && requestUrl.pathname === "/api/open-folder") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.openStorageFolder(body.kind));
    } catch (error) {
      return sendJson(res, 400, {
        error: "open_folder_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/export") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.exportGraph(body.targetPath));
    } catch (error) {
      return sendJson(res, 400, {
        error: "export_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/backup") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.backupDatabase(body.targetPath));
    } catch (error) {
      return sendJson(res, 400, {
        error: "backup_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/import") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.importGraph(body.sourcePath, body.mode));
    } catch (error) {
      return sendJson(res, 400, {
        error: "import_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/restore-latest-backup") {
    try {
      return sendJson(res, 200, db.restoreLatestBackup());
    } catch (error) {
      return sendJson(res, 400, {
        error: "restore_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/crawl-projects") {
    const body = await readBody(req);
    try {
      const rootPath = body.rootPath;
      const crawled = crawlProjects(rootPath, { maxDepth: body.maxDepth });
      const merged = db.mergeCrawledNodes(crawled, rootPath);
      return sendJson(res, 200, {
        ...merged,
        sample: crawled.slice(0, 12).map((node) => ({
          id: node.id,
          name: node.name,
          path: node.files[0],
          type: node.type,
        })),
      });
    } catch (error) {
      return sendJson(res, 400, {
        error: "crawl_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/repair-graph") {
    try {
      return sendJson(res, 200, db.repairGraphTopology());
    } catch (error) {
      return sendJson(res, 400, {
        error: "repair_graph_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/record-edit") {
    const body = await readBody(req);
    try {
      return sendJson(res, 201, db.recordEdit(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "record_edit_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/record-error") {
    const body = await readBody(req);
    try {
      return sendJson(res, 201, db.recordError(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "record_error_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/search") {
    const query = (requestUrl.searchParams.get("query") || "").trim().toLowerCase();
    const results = db.searchNodes(query);
    return sendJson(res, 200, {
      query,
      count: results.length,
      results,
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/trace") {
    const file = (requestUrl.searchParams.get("file") || "").trim();
    const location = (requestUrl.searchParams.get("location") || "").trim();
    const query = (requestUrl.searchParams.get("query") || "").trim();
    const results = db.traceNodes({ file, location, query });

    return sendJson(res, 200, {
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
    });
  }

  if (method === "GET" && requestUrl.pathname.startsWith("/api/nodes/")) {
    const nodeId = decodeURIComponent(requestUrl.pathname.replace("/api/nodes/", ""));
    const node = db.getNode(nodeId);

    if (!node) {
      return sendJson(res, 404, {
        error: "node_not_found",
      });
    }

    return sendJson(res, 200, node);
  }

  if (method === "POST" && requestUrl.pathname === "/api/active-node") {
    const body = await readBody(req);
    const graph = db.setActiveNode(body.nodeId);

    if (!graph) {
      return sendJson(res, 404, {
        error: "node_not_found",
      });
    }

    return sendJson(res, 200, graph);
  }

  if (method === "POST" && requestUrl.pathname === "/api/nodes") {
    try {
      const body = await readBody(req);
      const node = db.createNode(body);
      return sendJson(res, 201, node);
    } catch (error) {
      return sendJson(res, 400, {
        error: "invalid_node",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/nodes/upsert-from-trace") {
    try {
      const body = await readBody(req);
      const node = db.upsertNodeFromTrace(body);
      return sendJson(res, 200, node);
    } catch (error) {
      return sendJson(res, 400, {
        error: "invalid_trace",
        message: error.message,
      });
    }
  }

  if (method === "POST" && /^\/api\/nodes\/[^/]+\/notes$/.test(requestUrl.pathname)) {
    const [, , , nodeId] = requestUrl.pathname.split("/");
    const body = await readBody(req);

    if (!body.note || typeof body.note !== "string") {
      return sendJson(res, 400, {
        error: "invalid_note",
      });
    }

    const graph = db.addNote(nodeId, body.note, body.role);
    if (!graph) {
      return sendJson(res, 404, {
        error: "node_not_found",
      });
    }
    return sendJson(res, 200, graph);
  }

  if (method === "POST" && /^\/api\/nodes\/[^/]+\/debug-signals$/.test(requestUrl.pathname)) {
    const [, , , nodeId] = requestUrl.pathname.split("/");
    const body = await readBody(req);

    if (!body.title || !body.location || !body.symptom) {
      return sendJson(res, 400, {
        error: "invalid_debug_signal",
        message: "title, location va symptom la bat buoc.",
      });
    }

    const graph = db.addDebugSignal(nodeId, body);
    if (!graph) {
      return sendJson(res, 404, {
        error: "node_not_found",
      });
    }
    return sendJson(res, 200, graph);
  }

  if (method === "POST" && /^\/api\/nodes\/[^/]+\/chat$/.test(requestUrl.pathname)) {
    const [, , , nodeId] = requestUrl.pathname.split("/");
    const body = await readBody(req);

    if (!body.message || typeof body.message !== "string") {
      return sendJson(res, 400, {
        error: "invalid_message",
      });
    }

    const graph = db.addChat(nodeId, body.message, body.role);
    if (!graph) {
      return sendJson(res, 404, {
        error: "node_not_found",
      });
    }
    return sendJson(res, 200, graph);
  }

  sendJson(res, 404, {
    error: "not_found",
  });
}

async function serveStatic(res, pathname) {
  const fileName = STATIC_FILES[pathname];

  if (!fileName) {
    sendPlain(res, 404, "Not found");
    return;
  }

  const filePath = path.join(ROOT, fileName);
  const content = await fs.promises.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
  });
  res.end(content);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(body);
}

function sendPlain(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("JSON body khong hop le."));
      }
    });

    req.on("error", reject);
  });
}
