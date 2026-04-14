const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const db = require("./db");
const { crawlProjects } = require("./crawler");
const { scanDirectoryTree, scanProjectSchema, scanProjectPipeline } = require("./scanner");

const PORT = Number(process.env.PORT || 3010);
const ROOT = __dirname;
const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/pipeline.js": "pipeline.js",
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

  if (method === "GET" && requestUrl.pathname === "/api/context-window") {
    const payload = db.getContextWindow({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
    return sendJson(res, 200, payload);
  }

  if (method === "GET" && requestUrl.pathname === "/api/trace-execution") {
    const payload = db.traceExecution({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
    return sendJson(res, 200, payload);
  }

  if (method === "GET" && requestUrl.pathname === "/api/impact-of-change") {
    const payload = db.impactOfChange({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      maxNodes: requestUrl.searchParams.get("maxNodes"),
    });
    return sendJson(res, 200, payload);
  }

  if (method === "GET" && requestUrl.pathname === "/api/debug-context") {
    const payload = db.getDebugContext({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
      maxNodes: requestUrl.searchParams.get("maxNodes"),
    });
    return sendJson(res, 200, payload);
  }

  if (method === "GET" && requestUrl.pathname === "/api/storage") {
    return sendJson(res, 200, db.getStorageInfo());
  }

  if (method === "GET" && requestUrl.pathname === "/api/vault-config") {
    return sendJson(res, 200, db.getVaultConfig());
  }

  if (method === "POST" && requestUrl.pathname === "/api/vault-config") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.setVaultConfig(body.rootPath));
    } catch (error) {
      return sendJson(res, 400, {
        error: "vault_config_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/vault/scaffold") {
    const body = await readBody(req);
    try {
      return sendJson(res, 201, db.scaffoldVault(body.rootPath));
    } catch (error) {
      return sendJson(res, 400, {
        error: "vault_scaffold_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/activity/overview") {
    return sendJson(res, 200, db.getActivityOverview());
  }

  if (method === "GET" && requestUrl.pathname === "/api/reusable-modules") {
    return sendJson(res, 200, db.findReusableModules({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    }));
  }

  if (method === "GET" && requestUrl.pathname === "/api/project-module-match") {
    try {
      return sendJson(res, 200, db.matchProjectToReusableModules({
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        capability: (requestUrl.searchParams.get("capability") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
        includeLegacy: requestUrl.searchParams.get("includeLegacy") === "true",
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "project_module_match_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/module-adoptions") {
    try {
      return sendJson(res, 200, db.getModuleAdoptionMemory({
        moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
        sourceWorkspacePath: (requestUrl.searchParams.get("sourceWorkspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_adoption_memory_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/module-verifications") {
    try {
      return sendJson(res, 200, db.getModuleVerificationMemory({
        moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
        adoptionId: (requestUrl.searchParams.get("adoptionId") || "").trim(),
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
        sourceWorkspacePath: (requestUrl.searchParams.get("sourceWorkspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_verification_memory_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-recipe") {
    try {
      return sendJson(res, 200, db.buildAdoptionRecipe({
        moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
        moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        capability: (requestUrl.searchParams.get("capability") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "adoption_recipe_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-execution-assist") {
    try {
      return sendJson(res, 200, db.buildAdoptionExecutionAssist({
        moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
        moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        capability: (requestUrl.searchParams.get("capability") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "adoption_execution_assist_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-patch-draft") {
    try {
      return sendJson(res, 200, db.buildAdoptionPatchDraft({
        moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
        moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        capability: (requestUrl.searchParams.get("capability") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "adoption_patch_draft_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-apply-preview") {
    try {
      return sendJson(res, 200, db.buildAdoptionApplyPreview({
        moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
        moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        capability: (requestUrl.searchParams.get("capability") || "").trim(),
        roles: (requestUrl.searchParams.get("roles") || "").trim().split(",").map((entry) => entry.trim()).filter(Boolean),
        selectedFiles: (requestUrl.searchParams.get("selectedFiles") || "").trim().split(",").map((entry) => entry.trim()).filter(Boolean),
        appendExisting: requestUrl.searchParams.get("appendExisting"),
        overwriteExisting: requestUrl.searchParams.get("overwriteExisting"),
        allowPackageJson: requestUrl.searchParams.get("allowPackageJson"),
        allowPlaceholders: requestUrl.searchParams.get("allowPlaceholders"),
        dependencyVersions: (requestUrl.searchParams.get("dependencyVersions") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "adoption_apply_preview_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/low-token-context") {
    try {
      return sendJson(res, 200, db.getLowTokenContext({
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        capability: (requestUrl.searchParams.get("capability") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        file: (requestUrl.searchParams.get("file") || "").trim(),
        location: (requestUrl.searchParams.get("location") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
        maxNodes: requestUrl.searchParams.get("maxNodes"),
        moduleLimit: requestUrl.searchParams.get("moduleLimit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "low_token_context_failed",
        message: error.message,
      });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/implementation/context") {
    try {
      return sendJson(res, 200, db.getImplementationContext({
        workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
        query: (requestUrl.searchParams.get("query") || "").trim(),
        limit: requestUrl.searchParams.get("limit"),
        recentLimit: requestUrl.searchParams.get("recentLimit"),
        eventLimit: requestUrl.searchParams.get("eventLimit"),
      }));
    } catch (error) {
      return sendJson(res, 400, {
        error: "implementation_context_failed",
        message: error.message,
      });
    }
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

  if (method === "POST" && requestUrl.pathname === "/api/implementation/upsert") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.upsertImplementationThread(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "implementation_upsert_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/module-adoptions/record") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.recordModuleAdoption(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_adoption_record_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/module-verifications/record") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.recordModuleVerification(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_verification_record_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/adoption-apply") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.applyAdoptionPatchDraft(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "adoption_apply_failed",
        message: error.message,
      });
    }
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

  if (method === "POST" && requestUrl.pathname === "/api/modules/register") {
    const body = await readBody(req);
    try {
      return sendJson(res, 201, db.registerReusableModule(body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_register_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/modules/harvest") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.harvestReusableModules(body.rootPath, body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_harvest_failed",
        message: error.message,
      });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/modules/cleanup") {
    const body = await readBody(req);
    try {
      return sendJson(res, 200, db.cleanupModuleRegistry(body.workspacePath, body));
    } catch (error) {
      return sendJson(res, 400, {
        error: "module_cleanup_failed",
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

  if (method === "GET" && requestUrl.pathname === "/api/scan-tree") {
    const scanPath = (requestUrl.searchParams.get("path") || "").trim();
    const maxDepth = Number(requestUrl.searchParams.get("maxDepth") || 6);
    if (!scanPath) {
      return sendJson(res, 400, { error: "missing_path", message: "path la bat buoc." });
    }
    try {
      const tree = scanDirectoryTree(scanPath, maxDepth);
      return sendJson(res, 200, { tree });
    } catch (error) {
      return sendJson(res, 400, { error: "scan_tree_failed", message: error.message });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/scan-schema") {
    const scanPath = (requestUrl.searchParams.get("path") || "").trim();
    if (!scanPath) {
      return sendJson(res, 400, { error: "missing_path", message: "path la bat buoc." });
    }
    try {
      const schema = scanProjectSchema(scanPath);
      return sendJson(res, 200, schema);
    } catch (error) {
      return sendJson(res, 400, { error: "scan_schema_failed", message: error.message });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/scan-pipeline") {
    const scanPath = (requestUrl.searchParams.get("path") || "").trim();
    const maxDepth = Number(requestUrl.searchParams.get("maxDepth") || 6);
    const maxFiles = Number(requestUrl.searchParams.get("maxFiles") || 220);
    const forceRefresh = ["1", "true", "yes"].includes((requestUrl.searchParams.get("force") || "").trim().toLowerCase());
    if (!scanPath) {
      return sendJson(res, 400, { error: "missing_path", message: "path la bat buoc." });
    }
    try {
      if (!forceRefresh) {
        const cached = db.getPipelineCache(scanPath, maxDepth, maxFiles);
        if (cached) {
          return sendJson(res, 200, cached);
        }
      }
      const pipeline = scanProjectPipeline(scanPath, { maxDepth, maxFiles });
      db.savePipelineCache(scanPath, maxDepth, maxFiles, pipeline);
      return sendJson(res, 200, pipeline);
    } catch (error) {
      return sendJson(res, 400, { error: "scan_pipeline_failed", message: error.message });
    }
  }

  if (method === "GET" && requestUrl.pathname === "/api/source-preview") {
    const filePath = (requestUrl.searchParams.get("path") || "").trim();
    const line = Number(requestUrl.searchParams.get("line") || 0);
    const symbol = (requestUrl.searchParams.get("symbol") || "").trim();
    const label = (requestUrl.searchParams.get("label") || "").trim();
    if (!filePath) {
      return sendJson(res, 400, { error: "missing_path", message: "path la bat buoc." });
    }
    try {
      const preview = await buildSourcePreview({ filePath, line, symbol, label });
      return sendJson(res, 200, preview);
    } catch (error) {
      return sendJson(res, 400, { error: "source_preview_failed", message: error.message });
    }
  }

  if (method === "POST" && requestUrl.pathname === "/api/scan-to-graph") {
    const body = await readBody(req);
    const scanPath = (body.path || "").trim();
    if (!scanPath) {
      return sendJson(res, 400, { error: "missing_path", message: "path la bat buoc." });
    }
    try {
      const schema = scanProjectSchema(scanPath);
      const graphNodes = schema.tables.map((table) => {
        const nodeId = `schema-${table.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const fieldsSummary = table.fields.map((f) => `${f.isPrimaryKey ? "🔑" : f.isForeignKey ? "🔗" : ""} ${f.name}: ${f.type}`).join(", ");
        return {
          id: nodeId,
          name: table.name,
          type: "schema",
          summary: `Table ${table.name} with ${table.fields.length} fields. [${fieldsSummary}]`,
          severity: "low",
          files: [table.sourceFile || scanPath],
          relations: [],
          contextWindow: table.fields.map((f) => ({ label: f.name, detail: `${f.type}${f.isPrimaryKey ? " (PK)" : ""}${f.isForeignKey ? " (FK)" : ""}${f.nullable ? " nullable" : ""}` })),
          debugSignals: [],
          chatHistory: [],
          notes: [`Schema node auto-created from scanning ${scanPath}`],
          openIssues: 0,
        };
      });

      let added = 0;
      let updated = 0;
      graphNodes.forEach((gNode) => {
        const existing = db.getNode(gNode.id);
        if (existing) {
          updated += 1;
        } else {
          try {
            db.createNode(gNode);
            added += 1;
          } catch { updated += 1; }
        }
      });

      schema.relations.forEach((rel) => {
        const sourceId = `schema-${rel.sourceTable.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const targetId = `schema-${rel.targetTable.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const sourceNode = db.getNode(sourceId);
        const targetNode = db.getNode(targetId);
        if (sourceNode && targetNode) {
          if (!sourceNode.relations.includes(targetId)) {
            sourceNode.relations.push(targetId);
          }
          if (!targetNode.relations.includes(sourceId)) {
            targetNode.relations.push(sourceId);
          }
        }
      });

      return sendJson(res, 200, {
        added,
        updated,
        totalTables: schema.tables.length,
        totalRelations: schema.relations.length,
        schema,
      });
    } catch (error) {
      return sendJson(res, 400, { error: "scan_to_graph_failed", message: error.message });
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

async function buildSourcePreview({ filePath, line, symbol, label }) {
  const resolvedPath = path.resolve(filePath);
  const fileBuffer = await fs.promises.readFile(resolvedPath);
  const content = fileBuffer.toString("utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const references = findPreviewReferences(lines, symbol, label);
  const focusLine = resolvePreviewLine(lines, line, symbol, label, references);
  const focusIndex = references.findIndex((item) => item.line === focusLine);
  const radius = 8;
  const startLine = Math.max(1, focusLine - radius);
  const endLine = Math.min(lines.length, focusLine + radius);
  return {
    filePath: resolvedPath,
    symbol,
    label,
    focusLine,
    focusIndex,
    startLine,
    endLine,
    references,
    lines: lines.slice(startLine - 1, endLine).map((text, index) => ({
      number: startLine + index,
      text,
    })),
  };
}

function resolvePreviewLine(lines, line, symbol, label, references = []) {
  if (Number.isFinite(line) && line > 0 && line <= lines.length) {
    return line;
  }

  if (references.length) {
    return references[0].line;
  }

  const probes = [symbol, label]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const probe of probes) {
    const directIndex = lines.findIndex((text) => text.includes(probe));
    if (directIndex >= 0) {
      return directIndex + 1;
    }
    const tailProbe = probe.split(".").pop();
    if (tailProbe && tailProbe !== probe) {
      const tailIndex = lines.findIndex((text) => text.includes(tailProbe));
      if (tailIndex >= 0) {
        return tailIndex + 1;
      }
    }
  }

  return 1;
}

function findPreviewReferences(lines, symbol, label) {
  const probes = [symbol, label]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const references = [];
  const seen = new Set();

  probes.forEach((probe) => {
    const variants = [probe];
    const tailProbe = probe.split(".").pop();
    if (tailProbe && tailProbe !== probe) {
      variants.push(tailProbe);
    }

    lines.forEach((text, index) => {
      const matched = variants.find((variant) => variant && text.includes(variant));
      if (!matched) {
        return;
      }
      const key = `${index + 1}:${matched}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      references.push({
        line: index + 1,
        match: matched,
        text: text.trim(),
      });
    });
  });

  return references.slice(0, 100);
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
