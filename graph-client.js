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
    if (
      error.status === 404 &&
      (error.payload?.error === "not_found" || error.payload?.error === "not found")
    ) {
      return true;
    }
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

  if (method === "GET" && requestUrl.pathname === "/api/context-window") {
    return db.getContextWindow({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/trace-execution") {
    return db.traceExecution({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/impact-of-change") {
    return db.impactOfChange({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      maxNodes: requestUrl.searchParams.get("maxNodes"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/debug-context") {
    return db.getDebugContext({
      nodeId: (requestUrl.searchParams.get("nodeId") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
      maxNodes: requestUrl.searchParams.get("maxNodes"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/storage") {
    return db.getStorageInfo();
  }

  if (method === "GET" && requestUrl.pathname === "/api/vault-config") {
    return db.getVaultConfig();
  }

  if (method === "POST" && requestUrl.pathname === "/api/vault-config") {
    return safelyHandleLocalMutation(() => db.setVaultConfig(body.rootPath), 400, "vault_config_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/vault/scaffold") {
    return safelyHandleLocalMutation(() => db.scaffoldVault(body.rootPath), 400, "vault_scaffold_failed");
  }

  if (method === "GET" && requestUrl.pathname === "/api/activity/overview") {
    return db.getActivityOverview();
  }

  if (method === "GET" && requestUrl.pathname === "/api/reusable-modules") {
    return db.findReusableModules({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/brain/context") {
    return db.getBrainContext({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      skillLimit: requestUrl.searchParams.get("skillLimit"),
      moduleLimit: requestUrl.searchParams.get("moduleLimit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/brain/skills") {
    return db.listBrainSkills({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      status: (requestUrl.searchParams.get("status") || "active").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/brain/skill") {
    const skill = db.getBrainSkill((requestUrl.searchParams.get("skillId") || "").trim());
    if (!skill) {
      const error = new Error("skill_not_found");
      error.status = 404;
      throw error;
    }
    return skill;
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/providers") {
    return db.listAiProviders({
      kind: (requestUrl.searchParams.get("kind") || "").trim(),
      status: (requestUrl.searchParams.get("status") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/provider") {
    const provider = db.getAiProvider((requestUrl.searchParams.get("providerId") || "").trim());
    if (!provider) {
      const error = new Error("provider_not_found");
      error.status = 404;
      throw error;
    }
    return provider;
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/model-runs") {
    return db.listAiModelRuns({
      providerId: (requestUrl.searchParams.get("providerId") || requestUrl.searchParams.get("provider") || "").trim(),
      runType: (requestUrl.searchParams.get("runType") || requestUrl.searchParams.get("type") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/setup-doctor") {
    return db.runAiSetupDoctor({
      timeoutMs: requestUrl.searchParams.get("timeoutMs"),
      checkHealth: requestUrl.searchParams.get("checkHealth") !== "false",
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/runtime-pick") {
    return db.pickAiRuntime({
      purpose: (requestUrl.searchParams.get("purpose") || "").trim(),
      timeoutMs: requestUrl.searchParams.get("timeoutMs"),
      checkHealth: requestUrl.searchParams.get("checkHealth") === "true",
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/runtime-profiles") {
    return db.listAiRuntimeProfiles({
      purpose: (requestUrl.searchParams.get("purpose") || "").trim(),
      status: (requestUrl.searchParams.get("status") || "active").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/runtime-profile") {
    const profile = db.getAiRuntimeProfile((requestUrl.searchParams.get("profileId") || requestUrl.searchParams.get("profile") || "").trim());
    if (!profile) {
      const error = new Error("runtime_profile_not_found");
      error.status = 404;
      throw error;
    }
    return profile;
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/chat-threads") {
    return db.listAiChatThreads({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      status: (requestUrl.searchParams.get("status") || "active").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/ai/chat-thread") {
    const thread = db.getAiChatThread((requestUrl.searchParams.get("threadId") || "").trim(), {
      limit: requestUrl.searchParams.get("limit"),
    });
    if (!thread) {
      const error = new Error("chat_thread_not_found");
      error.status = 404;
      throw error;
    }
    return thread;
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/providers") {
    return safelyHandleLocalMutation(() => db.registerAiProvider(body), 400, "ai_provider_register_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/providers/healthcheck") {
    return safelyHandleLocalMutation(
      () => db.healthcheckAiProvider(body.providerId || body.provider, body),
      400,
      "ai_provider_healthcheck_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/chat") {
    return safelyHandleLocalMutation(() => db.chatWithAiProvider(body), 400, "ai_chat_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/harness/run") {
    return safelyHandleLocalMutation(() => db.runAiHarness(body), 400, "ai_harness_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/setup-doctor") {
    return safelyHandleLocalMutation(() => db.runAiSetupDoctor(body), 400, "ai_setup_doctor_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/runtime-pick") {
    return safelyHandleLocalMutation(() => db.pickAiRuntime(body), 400, "ai_runtime_pick_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/runtime-profiles") {
    return safelyHandleLocalMutation(() => db.upsertAiRuntimeProfile(body), 400, "ai_runtime_profile_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/chat-threads") {
    return safelyHandleLocalMutation(() => db.startAiChatThread(body), 400, "ai_chat_thread_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/ai/chat-threads/message") {
    return safelyHandleLocalMutation(() => db.sendAiChatMessage(body), 400, "ai_chat_thread_message_failed");
  }

  if (method === "GET" && requestUrl.pathname === "/api/project-module-match") {
    return db.matchProjectToReusableModules({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
      includeLegacy: requestUrl.searchParams.get("includeLegacy") === "true",
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/module-adoptions") {
    return db.getModuleAdoptionMemory({
      moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
      sourceWorkspacePath: (requestUrl.searchParams.get("sourceWorkspacePath") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/module-verifications") {
    return db.getModuleVerificationMemory({
      moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
      adoptionId: (requestUrl.searchParams.get("adoptionId") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
      sourceWorkspacePath: (requestUrl.searchParams.get("sourceWorkspacePath") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-recipe") {
    return db.buildAdoptionRecipe({
      moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
      moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-execution-assist") {
    return db.buildAdoptionExecutionAssist({
      moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
      moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-patch-draft") {
    return db.buildAdoptionPatchDraft({
      moduleId: (requestUrl.searchParams.get("moduleId") || "").trim(),
      moduleCanonicalKey: (requestUrl.searchParams.get("moduleCanonicalKey") || "").trim(),
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      targetWorkspacePath: (requestUrl.searchParams.get("targetWorkspacePath") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/adoption-apply-preview") {
    return db.buildAdoptionApplyPreview({
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
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/low-token-context") {
    return db.getLowTokenContext({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      file: (requestUrl.searchParams.get("file") || "").trim(),
      location: (requestUrl.searchParams.get("location") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
      maxNodes: requestUrl.searchParams.get("maxNodes"),
      moduleLimit: requestUrl.searchParams.get("moduleLimit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/implementation/context") {
    return db.getImplementationContext({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      limit: requestUrl.searchParams.get("limit"),
      recentLimit: requestUrl.searchParams.get("recentLimit"),
      eventLimit: requestUrl.searchParams.get("eventLimit"),
    });
  }

  if (method === "GET" && requestUrl.pathname === "/api/workflow/prepare") {
    return db.prepareWorkflowExecution({
      workspacePath: (requestUrl.searchParams.get("workspacePath") || "").trim(),
      purpose: (requestUrl.searchParams.get("purpose") || "").trim(),
      query: (requestUrl.searchParams.get("query") || "").trim(),
      capability: (requestUrl.searchParams.get("capability") || "").trim(),
      checkHealth: requestUrl.searchParams.get("checkHealth") === "true",
      timeoutMs: requestUrl.searchParams.get("timeoutMs"),
    });
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

  if (method === "POST" && requestUrl.pathname === "/api/implementation/upsert") {
    return safelyHandleLocalMutation(
      () => db.upsertImplementationThread(body),
      400,
      "implementation_upsert_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/workflow/prepare") {
    return db.prepareWorkflowExecution(body).catch((error) => {
      throw createRequestError(400, {
        error: "workflow_prepare_failed",
        message: error.message,
      });
    });
  }

  if (method === "POST" && requestUrl.pathname === "/api/module-adoptions/record") {
    return safelyHandleLocalMutation(
      () => db.recordModuleAdoption(body),
      400,
      "module_adoption_record_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/module-verifications/record") {
    return safelyHandleLocalMutation(
      () => db.recordModuleVerification(body),
      400,
      "module_verification_record_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/adoption-apply") {
    return safelyHandleLocalMutation(
      () => db.applyAdoptionPatchDraft(body),
      400,
      "adoption_apply_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/open-folder") {
    return safelyHandleLocalMutation(() => db.openStorageFolder(body.kind), 400, "open_folder_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/open-path") {
    return safelyHandleLocalMutation(
      () => db.openSystemPath(body.targetPath, body),
      400,
      "open_path_failed"
    );
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
    return (async () => {
      const crawled = crawlProjectsLocal(body.rootPath, { maxDepth: body.maxDepth });
      const merged = db.mergeCrawledNodes(crawled, body.rootPath);
      const sample = crawled.slice(0, 12).map((node) => ({
        id: node.id,
        name: node.name,
        path: node.files[0],
        type: node.type,
      }));
      const workspacePaths = [...new Set(
        sample
          .filter((node) => node.type === "project" || node.type === "workspace")
          .map((node) => node.path)
          .filter(Boolean)
      )].slice(0, 4);
      const workflow = await db.prepareWorkflowExecution({
        workspacePath: body.rootPath,
        purpose: "crawl",
        query: body.query || "crawl workspace memory and prepare reuse/runtime hints",
        checkHealth: body.checkHealth,
        toolSource: body.toolSource || "api",
      });
      const projectWorkflows = [];
      for (const workspacePath of workspacePaths) {
        projectWorkflows.push(await db.prepareWorkflowExecution({
          workspacePath,
          purpose: "crawl",
          query: body.query || "prepare project after crawl",
          checkHealth: false,
          toolSource: body.toolSource || "api",
        }));
      }
      return {
        ...merged,
        sample,
        workflow,
        projectWorkflows,
      };
    })().catch((error) => {
      throw createRequestError(400, {
        error: "crawl_failed",
        message: error.message,
      });
    });
  }

  if (method === "POST" && requestUrl.pathname === "/api/modules/register") {
    return safelyHandleLocalMutation(
      () => db.registerReusableModule(body),
      400,
      "module_register_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/modules/harvest") {
    return safelyHandleLocalMutation(
      () => db.harvestReusableModules(body.rootPath, body),
      400,
      "module_harvest_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/modules/cleanup") {
    return safelyHandleLocalMutation(
      () => db.cleanupModuleRegistry(body.workspacePath, body),
      400,
      "module_cleanup_failed"
    );
  }

  if (method === "POST" && requestUrl.pathname === "/api/brain/skills/register") {
    return safelyHandleLocalMutation(() => db.registerBrainSkill(body), 400, "brain_skill_register_failed");
  }

  if (method === "POST" && requestUrl.pathname === "/api/brain/skills/update-git") {
    return safelyHandleLocalMutation(() => db.updateBrainSkillFromGit(body), 400, "brain_skill_update_failed");
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

async function getContextWindow(filters = {}) {
  return request(`/api/context-window${toQueryString(filters)}`);
}

async function traceExecution(filters = {}) {
  return request(`/api/trace-execution${toQueryString(filters)}`);
}

async function impactOfChange(filters = {}) {
  return request(`/api/impact-of-change${toQueryString(filters)}`);
}

async function getDebugContext(filters = {}) {
  return request(`/api/debug-context${toQueryString(filters)}`);
}

async function getStorageInfo() {
  return request("/api/storage");
}

async function getVaultConfig() {
  return request("/api/vault-config");
}

async function setVaultConfig(rootPath) {
  return request("/api/vault-config", {
    method: "POST",
    body: JSON.stringify({ rootPath }),
  });
}

async function scaffoldVault(rootPath) {
  return request("/api/vault/scaffold", {
    method: "POST",
    body: JSON.stringify({ rootPath }),
  });
}

async function getActivityOverview() {
  return request("/api/activity/overview");
}

async function findReusableModules(filters = {}) {
  return request(`/api/reusable-modules${toQueryString(filters)}`);
}

async function getBrainContext(filters = {}) {
  return request(`/api/brain/context${toQueryString(filters)}`);
}

async function listBrainSkills(filters = {}) {
  return request(`/api/brain/skills${toQueryString(filters)}`);
}

async function getBrainSkill(skillId) {
  return request(`/api/brain/skill${toQueryString({ skillId })}`);
}

async function registerBrainSkill(payload = {}) {
  return request("/api/brain/skills/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function updateBrainSkillFromGit(payload = {}) {
  return request("/api/brain/skills/update-git", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function listAiProviders(filters = {}) {
  return request(`/api/ai/providers${toQueryString(filters)}`);
}

async function getAiProvider(providerId) {
  return request(`/api/ai/provider${toQueryString({ providerId })}`);
}

async function registerAiProvider(payload = {}) {
  return request("/api/ai/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function healthcheckAiProvider(payload = {}) {
  return request("/api/ai/providers/healthcheck", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function chatWithAiProvider(payload = {}) {
  return request("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function runAiHarness(payload = {}) {
  return request("/api/ai/harness/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function listAiModelRuns(filters = {}) {
  return request(`/api/ai/model-runs${toQueryString(filters)}`);
}

async function runAiSetupDoctor(filters = {}) {
  return request(`/api/ai/setup-doctor${toQueryString(filters)}`);
}

async function pickAiRuntime(filters = {}) {
  return request(`/api/ai/runtime-pick${toQueryString(filters)}`);
}

async function listAiRuntimeProfiles(filters = {}) {
  return request(`/api/ai/runtime-profiles${toQueryString(filters)}`);
}

async function getAiRuntimeProfile(profileId) {
  return request(`/api/ai/runtime-profile${toQueryString({ profileId })}`);
}

async function upsertAiRuntimeProfile(payload = {}) {
  return request("/api/ai/runtime-profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function listAiChatThreads(filters = {}) {
  return request(`/api/ai/chat-threads${toQueryString(filters)}`);
}

async function getAiChatThread(threadId, filters = {}) {
  return request(`/api/ai/chat-thread${toQueryString({ threadId, ...filters })}`);
}

async function startAiChatThread(payload = {}) {
  return request("/api/ai/chat-threads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function sendAiChatMessage(payload = {}) {
  return request("/api/ai/chat-threads/message", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function matchProjectToReusableModules(filters = {}) {
  return request(`/api/project-module-match${toQueryString(filters)}`);
}

async function getModuleAdoptionMemory(filters = {}) {
  return request(`/api/module-adoptions${toQueryString(filters)}`);
}

async function getModuleVerificationMemory(filters = {}) {
  return request(`/api/module-verifications${toQueryString(filters)}`);
}

async function getAdoptionRecipe(filters = {}) {
  return request(`/api/adoption-recipe${toQueryString(filters)}`);
}

async function getAdoptionExecutionAssist(filters = {}) {
  return request(`/api/adoption-execution-assist${toQueryString(filters)}`);
}

async function getAdoptionPatchDraft(filters = {}) {
  return request(`/api/adoption-patch-draft${toQueryString(filters)}`);
}

async function getAdoptionApplyPreview(filters = {}) {
  return request(`/api/adoption-apply-preview${toQueryString(filters)}`);
}

async function applyAdoptionPatchDraft(payload = {}) {
  return request("/api/adoption-apply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function getLowTokenContext(filters = {}) {
  return request(`/api/low-token-context${toQueryString(filters)}`);
}

async function getImplementationContext(filters = {}) {
  return request(`/api/implementation/context${toQueryString(filters)}`);
}

async function prepareWorkflowExecution(payload = {}) {
  return request("/api/workflow/prepare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

async function upsertImplementationThread(payload = {}) {
  return request("/api/implementation/upsert", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function recordModuleAdoption(payload = {}) {
  return request("/api/module-adoptions/record", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function recordModuleVerification(payload = {}) {
  return request("/api/module-verifications/record", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function openStorageFolder(kind) {
  return request("/api/open-folder", {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

async function openSystemPath(targetPath, options = {}) {
  return request("/api/open-path", {
    method: "POST",
    body: JSON.stringify({ targetPath, ...options }),
  });
}

async function crawlProjects(rootPath, maxDepth = 3, options = {}) {
  return request("/api/crawl-projects", {
    method: "POST",
    body: JSON.stringify({ rootPath, maxDepth, ...options }),
  });
}

async function registerReusableModule(payload) {
  return request("/api/modules/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function harvestReusableModules(rootPath, options = {}) {
  return request("/api/modules/harvest", {
    method: "POST",
    body: JSON.stringify({ rootPath, ...options }),
  });
}

async function cleanupModuleRegistry(workspacePath, options = {}) {
  return request("/api/modules/cleanup", {
    method: "POST",
    body: JSON.stringify({ workspacePath, ...options }),
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
  getBrainContext,
  getBrainSkill,
  getContextWindow,
  getContextGraph,
  getDebugContext,
  getAdoptionExecutionAssist,
  getAdoptionApplyPreview,
  getAdoptionPatchDraft,
  getAdoptionRecipe,
  getGraph,
  getImplementationContext,
  prepareWorkflowExecution,
  getModuleAdoptionMemory,
  getModuleVerificationMemory,
  getNode,
  getStorageInfo,
  getVaultConfig,
  getLowTokenContext,
  heartbeatActivity,
  harvestReusableModules,
  cleanupModuleRegistry,
  importGraph,
  listActivityRuns,
  listBrainSkills,
  openStorageFolder,
  openSystemPath,
  recordEdit,
  recordError,
  registerBrainSkill,
  registerReusableModule,
  restoreLatestBackup,
  searchNodes,
  setActiveNode,
  setVaultConfig,
  scaffoldVault,
  startActivity,
  findReusableModules,
  getAiProvider,
  listAiProviders,
  registerAiProvider,
  healthcheckAiProvider,
  chatWithAiProvider,
  runAiHarness,
  listAiModelRuns,
  runAiSetupDoctor,
  pickAiRuntime,
  listAiRuntimeProfiles,
  getAiRuntimeProfile,
  upsertAiRuntimeProfile,
  listAiChatThreads,
  getAiChatThread,
  startAiChatThread,
  sendAiChatMessage,
  matchProjectToReusableModules,
  impactOfChange,
  applyAdoptionPatchDraft,
  recordModuleAdoption,
  recordModuleVerification,
  traceNode,
  traceExecution,
  updateBrainSkillFromGit,
  upsertImplementationThread,
  upsertNodeFromTrace,
};
