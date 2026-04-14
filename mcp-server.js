const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const db = require("./db");

const server = new McpServer({
  name: "graph-memory",
  version: "2.0.0",
});

/* ────────────────────────────────────────────────────────────────────────────
   SESSION BOOTSTRAP — THE MOST IMPORTANT TOOL
   AI models MUST call this FIRST when starting any task in a workspace.
   ──────────────────────────────────────────────────────────────────────────── */

server.tool(
  "session_bootstrap",
  `[MANDATORY — CALL THIS FIRST] Initialize your session and get workspace context in one call.
This is the FIRST tool you should call when starting ANY task. It will:
1. Start or resume an activity session for this workspace
2. Return recent edits, open errors, and last touched files from the past 7 days
3. Give you a runId to use with record_outcome when your task is done

WHY: This saves you from reading the entire codebase. You instantly know what was done before, what errors are pending, and which files were recently changed.

WHEN TO CALL: At the very start of every conversation/task, before reading any files.
WHEN NOT TO CALL: Never skip this. Always call it first.`,
  {
    workspacePath: z.string().describe("Absolute path to the workspace/project root directory"),
    toolSource: z.string().optional().describe("Your tool name: 'antigravity', 'codex', 'cursor', 'claude', 'windsurf', or 'cli'"),
  },
  async ({ workspacePath, toolSource }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.sessionBootstrap(workspacePath, toolSource || "agent"), null, 2),
      },
    ],
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   GET CONTEXT FOR FILE — One-call file context retrieval
   ──────────────────────────────────────────────────────────────────────────── */

server.tool(
  "get_context_for_file",
  `[CALL BEFORE EDITING A FILE] Get all known context about specific file(s) from Graph Memory.
Returns notes, debug signals (past errors), recent edits, and related nodes — only for the files you specify.

WHY: Instead of reading the entire codebase, call this to instantly know:
- What errors were previously found in this file
- What edits were made recently
- What notes/context exist about this file
- What other files/nodes are related

WHEN TO CALL: Before you start reading or editing any file. This gives you pre-existing knowledge.
EXAMPLE: Before fixing a bug in "src/auth/index.ts", call this with that file path.`,
  {
    filePaths: z.union([z.string(), z.array(z.string())]).describe("One file path or array of file paths to get context for"),
  },
  async ({ filePaths }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.getContextForFiles(filePaths), null, 2),
      },
    ],
  })
);

server.tool(
  "get_context_window",
  `Retrieve a ranked, compact context window optimized for agent token efficiency.
Use this when you need the highest-signal nodes/files for debugging with minimal payload size.`,
  {
    nodeId: z.string().optional().describe("Optional node id anchor"),
    file: z.string().optional().describe("Optional file path filter"),
    location: z.string().optional().describe("Optional location filter such as src/auth/index.ts:42"),
    query: z.string().optional().describe("Optional semantic keyword query"),
    workspacePath: z.string().optional().describe("Optional workspace path to prioritize"),
    limit: z.number().optional().describe("Maximum number of ranked context nodes"),
  },
  async ({ nodeId, file, location, query, workspacePath, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.getContextWindow({
            nodeId,
            file,
            location,
            query,
            workspacePath,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "trace_execution",
  `Build an ordered execution trace from the graph context.
Use this after get_context_window to obtain a concise route/service/file/error/edit chain.`,
  {
    nodeId: z.string().optional().describe("Optional node id anchor"),
    file: z.string().optional().describe("Optional file filter"),
    location: z.string().optional().describe("Optional location filter"),
    query: z.string().optional().describe("Optional keyword query"),
    workspacePath: z.string().optional().describe("Optional workspace path to prioritize"),
    limit: z.number().optional().describe("Context ranking limit before trace selection"),
  },
  async ({ nodeId, file, location, query, workspacePath, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.traceExecution({
            nodeId,
            file,
            location,
            query,
            workspacePath,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "impact_of_change",
  `Estimate blast radius for a candidate change by traversing graph relations, parent/child links, and shared files.`,
  {
    nodeId: z.string().optional().describe("Optional node id seed"),
    file: z.string().optional().describe("Optional file path seed"),
    query: z.string().optional().describe("Optional keyword seed"),
    maxNodes: z.number().optional().describe("Maximum impacted nodes to return"),
  },
  async ({ nodeId, file, query, maxNodes }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.impactOfChange({
            nodeId,
            file,
            query,
            maxNodes,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "debug_context",
  `One-shot retrieval for agents: ranked context window + execution trace + impact analysis in a single compact payload.`,
  {
    nodeId: z.string().optional().describe("Optional node id anchor"),
    file: z.string().optional().describe("Optional file path filter"),
    location: z.string().optional().describe("Optional location filter"),
    query: z.string().optional().describe("Optional keyword query"),
    workspacePath: z.string().optional().describe("Optional workspace path to prioritize"),
    limit: z.number().optional().describe("Maximum ranked context nodes"),
    maxNodes: z.number().optional().describe("Maximum impacted nodes"),
  },
  async ({ nodeId, file, location, query, workspacePath, limit, maxNodes }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.getDebugContext({
            nodeId,
            file,
            location,
            query,
            workspacePath,
            limit,
            maxNodes,
          }),
          null,
          2
        ),
      },
    ],
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   RECORD OUTCOME — Finalize your session and persist what you did
   ──────────────────────────────────────────────────────────────────────────── */

server.tool(
  "record_outcome",
  `[CALL WHEN TASK IS DONE] Record the outcome of your work session.
This finalizes your activity session and creates edit/error nodes in the graph for future reference.

WHY: This is how future AI sessions know what was done before. Without this, your work is invisible to future agents.

WHEN TO CALL: When you finish a task (success or failure), before ending the conversation.
WHAT TO INCLUDE:
- runId: from session_bootstrap
- status: "completed" or "failed"
- touchedFiles: list of files you created/modified
- summary: what you accomplished
- fixedErrors: (optional) list of error node IDs you resolved`,
  {
    runId: z.string().describe("The run ID from session_bootstrap"),
    status: z.enum(["completed", "failed", "stopped"]).optional().describe("Final status of your task"),
    summary: z.string().optional().describe("Summary of what you accomplished or why it failed"),
    touchedFiles: z.array(z.string()).optional().describe("List of file paths you created, modified, or deleted"),
    currentFile: z.string().optional().describe("Last file you were working on"),
    latestError: z.string().optional().describe("Error message if status is 'failed'"),
    fixedErrors: z.array(z.string()).optional().describe("List of error node IDs that you resolved"),
  },
  async ({ runId, status, summary, touchedFiles, currentFile, latestError, fixedErrors }) => {
    const result = db.finishActivity(runId, {
      status: status || "completed",
      summary,
      touchedFiles,
      currentFile,
      latestError,
    });

    if (!result) {
      return {
        isError: true,
        content: [{ type: "text", text: `Run not found: ${runId}` }],
      };
    }

    if (Array.isArray(fixedErrors) && fixedErrors.length) {
      fixedErrors.forEach(errorNodeId => {
        const errorNode = db.getNode(errorNodeId);
        if (errorNode) {
          db.addNote(errorNodeId, `Resolved by ${result.toolSource || "agent"} in session ${runId}. ${summary || ""}`);
        }
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

/* ────────────────────────────────────────────────────────────────────────────
   RECORD EDIT — Log a specific file edit with context
   ──────────────────────────────────────────────────────────────────────────── */

server.tool(
  "record_edit",
  `[CALL AFTER MODIFYING A FILE] Record that you edited a specific file, with a summary of the change.
Creates an edit node in the graph so future AI sessions can see what was changed and why.

WHY: This builds institutional memory. Next time any AI works on this file, it will see your edit history.

WHEN TO CALL: After you make a significant edit to a file. Not needed for trivial formatting changes.`,
  {
    file: z.string().describe("Absolute path of the edited file"),
    summary: z.string().optional().describe("What you changed and why"),
    toolSource: z.string().optional().describe("Tool name: 'antigravity', 'codex', 'cursor', etc."),
    note: z.string().optional().describe("Additional context about the edit"),
  },
  async ({ file, summary, toolSource, note }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.recordEdit({ file, summary, toolSource, note }), null, 2),
      },
    ],
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   RECORD ERROR — Log an error with location and symptom
   ──────────────────────────────────────────────────────────────────────────── */

server.tool(
  "record_error",
  `[CALL WHEN YOU ENCOUNTER AN ERROR] Record a specific error, bug, or diagnostic with its file location and symptoms.
Creates an error node so future AI sessions can see what went wrong and where.

WHY: Errors tend to recur. Recording them means the next AI can instantly see "this file had this error before" instead of debugging from scratch.

WHEN TO CALL: When you encounter or diagnose an error during your work.`,
  {
    file: z.string().describe("File path where the error occurred"),
    location: z.string().describe("Specific location, e.g., 'src/auth/index.ts:42' or function name"),
    symptom: z.string().describe("The error message, stack trace, or description of the problem"),
    title: z.string().optional().describe("Short title for this error"),
    severity: z.string().optional().describe("'high', 'medium', or 'low'"),
    toolSource: z.string().optional().describe("Tool name that found this error"),
  },
  async ({ file, location, symptom, title, severity, toolSource }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.recordError({ file, location, symptom, title, severity, toolSource }), null, 2),
      },
    ],
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   EXISTING TOOLS — with improved descriptions
   ──────────────────────────────────────────────────────────────────────────── */

server.tool(
  "get_graph",
  `Get the entire Graph Memory database. WARNING: This can be very large.
Only use this if you specifically need the complete graph. For most tasks, use session_bootstrap or get_context_for_file instead.`,
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getGraph(), null, 2) }],
  })
);

server.tool(
  "storage_info",
  "Get the local persistent storage path and stats for the shared Graph Memory database on this machine.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getStorageInfo(), null, 2) }],
  })
);

server.tool(
  "vault_config",
  "Get the configured external Obsidian-style vault path and scaffold file locations.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getVaultConfig(), null, 2) }],
  })
);

server.tool(
  "set_vault_config",
  "Set the external Obsidian-style vault root path used for human-readable knowledge artifacts.",
  {
    rootPath: z.string().describe("Absolute path to the external vault root"),
  },
  async ({ rootPath }) => ({
    content: [{ type: "text", text: JSON.stringify(db.setVaultConfig(rootPath), null, 2) }],
  })
);

server.tool(
  "scaffold_vault",
  "Create the Obsidian-style vault folder structure and starter markdown files.",
  {
    rootPath: z.string().describe("Absolute path where the vault should be created"),
  },
  async ({ rootPath }) => ({
    content: [{ type: "text", text: JSON.stringify(db.scaffoldVault(rootPath), null, 2) }],
  })
);

server.tool(
  "find_reusable_modules",
  "Find reusable modules such as map, ocr, auth, upload, and similar capabilities across projects.",
  {
    workspacePath: z.string().optional().describe("Optional workspace path to prioritize"),
    capability: z.string().optional().describe("Optional capability filter, e.g. 'ocr' or 'map'"),
    query: z.string().optional().describe("Optional free-text query"),
    limit: z.number().optional().describe("Maximum modules to return"),
  },
  async ({ workspacePath, capability, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.findReusableModules({ workspacePath, capability, query, limit }), null, 2),
      },
    ],
  })
);

server.tool(
  "match_project_modules",
  "Profile a target workspace, infer its stack/capabilities, and rank reusable modules by copy-first or adapt-first priority.",
  {
    workspacePath: z.string().describe("Workspace root that needs reusable-module recommendations"),
    capability: z.string().optional().describe("Optional desired capability such as 'ocr' or 'map'"),
    query: z.string().optional().describe("Optional free-text feature description"),
    limit: z.number().optional().describe("Maximum matched modules to return"),
  },
  async ({ workspacePath, capability, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.matchProjectToReusableModules({ workspacePath, capability, query, limit }), null, 2),
      },
    ],
  })
);

server.tool(
  "module_adoption_memory",
  "Return cross-project adoption memory for reusable modules, including validated integration patterns, adapter changes, dependency changes, and recent reuse attempts.",
  {
    moduleId: z.string().optional().describe("Optional module node id"),
    workspacePath: z.string().optional().describe("Optional target workspace to filter adoption history"),
    targetWorkspacePath: z.string().optional().describe("Explicit target workspace filter"),
    sourceWorkspacePath: z.string().optional().describe("Optional source workspace filter"),
    query: z.string().optional().describe("Optional keyword filter"),
    limit: z.number().optional().describe("Maximum adoption records to return"),
  },
  async ({ moduleId, workspacePath, targetWorkspacePath, sourceWorkspacePath, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.getModuleAdoptionMemory({
            moduleId,
            workspacePath,
            targetWorkspacePath,
            sourceWorkspacePath,
            query,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "module_verification_memory",
  "Return verification memory for reusable modules, including passing tests, integration failures, and fix patterns that worked across projects.",
  {
    moduleId: z.string().optional().describe("Optional module node id"),
    adoptionId: z.string().optional().describe("Optional adoption record id"),
    workspacePath: z.string().optional().describe("Optional target workspace to filter verification history"),
    targetWorkspacePath: z.string().optional().describe("Explicit target workspace filter"),
    sourceWorkspacePath: z.string().optional().describe("Optional source workspace filter"),
    query: z.string().optional().describe("Optional keyword filter"),
    limit: z.number().optional().describe("Maximum verification records to return"),
  },
  async ({ moduleId, adoptionId, workspacePath, targetWorkspacePath, sourceWorkspacePath, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.getModuleVerificationMemory({
            moduleId,
            adoptionId,
            workspacePath,
            targetWorkspacePath,
            sourceWorkspacePath,
            query,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "adoption_recipe",
  "Generate a short integration checklist for reusing a module in a target workspace, using validated adoption memory first and module metadata as fallback.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key"),
    workspacePath: z.string().optional().describe("Optional target workspace alias"),
    targetWorkspacePath: z.string().optional().describe("Target workspace that needs the recipe"),
    capability: z.string().optional().describe("Optional capability hint"),
    query: z.string().optional().describe("Optional feature hint"),
    limit: z.number().optional().describe("Adoption memory limit"),
  },
  async ({ moduleId, moduleCanonicalKey, workspacePath, targetWorkspacePath, capability, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.buildAdoptionRecipe({
            moduleId,
            moduleCanonicalKey,
            workspacePath,
            targetWorkspacePath,
            capability,
            query,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "adoption_execution_assist",
  "Generate a patch-oriented execution assist that tells an agent which target files to create or modify first when adopting a module into a target workspace.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key"),
    workspacePath: z.string().optional().describe("Optional target workspace alias"),
    targetWorkspacePath: z.string().optional().describe("Target workspace that needs the execution assist"),
    capability: z.string().optional().describe("Optional capability hint"),
    query: z.string().optional().describe("Optional feature hint"),
    limit: z.number().optional().describe("Adoption memory limit"),
  },
  async ({ moduleId, moduleCanonicalKey, workspacePath, targetWorkspacePath, capability, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.buildAdoptionExecutionAssist({
            moduleId,
            moduleCanonicalKey,
            workspacePath,
            targetWorkspacePath,
            capability,
            query,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "adoption_patch_draft",
  "Generate file-by-file patch drafts and starter skeletons for adopting a reusable module into a target workspace.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key"),
    workspacePath: z.string().optional().describe("Optional target workspace alias"),
    targetWorkspacePath: z.string().optional().describe("Target workspace that needs the patch draft"),
    capability: z.string().optional().describe("Optional capability hint"),
    query: z.string().optional().describe("Optional feature hint"),
    limit: z.number().optional().describe("Adoption memory limit"),
  },
  async ({ moduleId, moduleCanonicalKey, workspacePath, targetWorkspacePath, capability, query, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.buildAdoptionPatchDraft({
            moduleId,
            moduleCanonicalKey,
            workspacePath,
            targetWorkspacePath,
            capability,
            query,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "adoption_apply_preview",
  "Preview which scaffold draft files are safe to apply, which are blocked, and which require explicit risky-operation flags.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key"),
    workspacePath: z.string().optional().describe("Optional target workspace alias"),
    targetWorkspacePath: z.string().optional().describe("Target workspace that needs the preview"),
    capability: z.string().optional().describe("Optional capability hint"),
    query: z.string().optional().describe("Optional feature hint"),
    roles: z.array(z.string()).optional().describe("Optional role filter such as ['module-entry', 'adapter']"),
    selectedFiles: z.array(z.string()).optional().describe("Optional file path filter"),
    appendExisting: z.boolean().optional().describe("Allow appending scaffold blocks into existing files"),
    overwriteExisting: z.boolean().optional().describe("Allow overwriting existing files"),
    allowPackageJson: z.boolean().optional().describe("Allow package.json dependency updates"),
    allowPlaceholders: z.boolean().optional().describe("Allow snippets that still contain placeholders"),
    dependencyVersions: z.record(z.string()).optional().describe("Dependency versions to merge into package.json"),
    limit: z.number().optional().describe("Adoption memory limit"),
  },
  async ({ moduleId, moduleCanonicalKey, workspacePath, targetWorkspacePath, capability, query, roles, selectedFiles, appendExisting, overwriteExisting, allowPackageJson, allowPlaceholders, dependencyVersions, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.buildAdoptionApplyPreview({
            moduleId,
            moduleCanonicalKey,
            workspacePath,
            targetWorkspacePath,
            capability,
            query,
            roles,
            selectedFiles,
            appendExisting,
            overwriteExisting,
            allowPackageJson,
            allowPlaceholders,
            dependencyVersions,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "apply_adoption_patch_draft",
  "Apply scaffold drafts into a target workspace with explicit guards for existing files and manifest changes.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key"),
    workspacePath: z.string().optional().describe("Optional target workspace alias"),
    targetWorkspacePath: z.string().optional().describe("Target workspace that will receive the scaffold"),
    capability: z.string().optional().describe("Optional capability hint"),
    query: z.string().optional().describe("Optional feature hint"),
    roles: z.array(z.string()).optional().describe("Optional role filter"),
    selectedFiles: z.array(z.string()).optional().describe("Optional file path filter"),
    appendExisting: z.boolean().optional().describe("Allow appending scaffold blocks into existing files"),
    overwriteExisting: z.boolean().optional().describe("Allow overwriting existing files"),
    allowPackageJson: z.boolean().optional().describe("Allow package.json dependency updates"),
    allowPlaceholders: z.boolean().optional().describe("Allow snippets that still contain placeholders"),
    dependencyVersions: z.record(z.string()).optional().describe("Dependency versions to merge into package.json"),
    apply: z.boolean().optional().describe("Set false to return the same payload without writing"),
    limit: z.number().optional().describe("Adoption memory limit"),
  },
  async ({ moduleId, moduleCanonicalKey, workspacePath, targetWorkspacePath, capability, query, roles, selectedFiles, appendExisting, overwriteExisting, allowPackageJson, allowPlaceholders, dependencyVersions, apply, limit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.applyAdoptionPatchDraft({
            moduleId,
            moduleCanonicalKey,
            workspacePath,
            targetWorkspacePath,
            capability,
            query,
            roles,
            selectedFiles,
            appendExisting,
            overwriteExisting,
            allowPackageJson,
            allowPlaceholders,
            dependencyVersions,
            apply,
            limit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "register_reusable_module",
  "Register or update a reusable module card so future sessions can reuse it instead of rewriting it.",
  {
    workspacePath: z.string().describe("Workspace root that owns the module"),
    entryPath: z.string().describe("Absolute path to the module entry file or folder"),
    capability: z.string().describe("Primary capability name, e.g. 'ocr'"),
    name: z.string().optional().describe("Human-friendly module name"),
    summary: z.string().optional().describe("What the module does"),
    integrationHint: z.string().optional().describe("How future projects should integrate it"),
  },
  async ({ workspacePath, entryPath, capability, name, summary, integrationHint }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.registerReusableModule({ workspacePath, entryPath, capability, name, summary, integrationHint }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "harvest_reusable_modules",
  "Scan a project root and auto-register likely reusable modules using structural analysis, then refresh registry freshness and deduplicate stale entries.",
  {
    rootPath: z.string().describe("Workspace/project root to scan"),
    maxDepth: z.number().optional().describe("Max directory depth to inspect"),
    maxFiles: z.number().optional().describe("Max files to inspect"),
  },
  async ({ rootPath, maxDepth, maxFiles }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.harvestReusableModules(rootPath, { maxDepth, maxFiles }), null, 2),
      },
    ],
  })
);

server.tool(
  "cleanup_module_registry",
  "Deduplicate reusable-module entries for a workspace and mark legacy, duplicate, or stale harvested nodes so lookups only surface the newest active registry entries.",
  {
    workspacePath: z.string().describe("Workspace root whose module registry should be cleaned"),
    dryRun: z.boolean().optional().describe("When true, only report the cleanup plan without mutating the registry"),
  },
  async ({ workspacePath, dryRun }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.cleanupModuleRegistry(workspacePath, { workspacePath, dryRun }), null, 2),
      },
    ],
  })
);

server.tool(
  "low_token_context",
  "Return a compact project brief with recent work, top context, and reusable module candidates for IDE/CLI usage.",
  {
    workspacePath: z.string().describe("Workspace root to summarize"),
    capability: z.string().optional().describe("Optional desired capability"),
    query: z.string().optional().describe("Optional task query"),
    file: z.string().optional().describe("Optional file focus"),
    location: z.string().optional().describe("Optional location focus"),
    limit: z.number().optional().describe("Context node limit"),
    maxNodes: z.number().optional().describe("Impact node limit"),
    moduleLimit: z.number().optional().describe("Reusable module limit"),
  },
  async ({ workspacePath, capability, query, file, location, limit, maxNodes, moduleLimit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.getLowTokenContext({
            workspacePath,
            capability,
            query,
            file,
            location,
            limit,
            maxNodes,
            moduleLimit,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "implementation_context",
  "Return resumable implementation threads, current step, next step, blockers, and recent checkpoints so another IDE or CLI can continue work with minimal tokens.",
  {
    workspacePath: z.string().describe("Workspace root to inspect"),
    query: z.string().optional().describe("Optional task filter"),
    limit: z.number().optional().describe("Active thread limit"),
    recentLimit: z.number().optional().describe("Completed thread limit"),
    eventLimit: z.number().optional().describe("Recent event limit"),
  },
  async ({ workspacePath, query, limit, recentLimit, eventLimit }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.getImplementationContext({ workspacePath, query, limit, recentLimit, eventLimit }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "upsert_implementation_task",
  "Create or update a resumable implementation thread with current step, next step, blockers, touched files, and tool progress.",
  {
    workspacePath: z.string().describe("Workspace root that owns the task"),
    title: z.string().describe("Human-readable task title"),
    taskKey: z.string().optional().describe("Stable task key when multiple tools should coordinate on the same thread"),
    summary: z.string().optional().describe("Short progress summary"),
    currentStep: z.string().optional().describe("Current implementation step"),
    nextStep: z.string().optional().describe("Next action to resume from"),
    blocker: z.string().optional().describe("Current blocker, if any"),
    status: z.enum(["active", "blocked", "paused", "completed", "failed"]).optional().describe("Implementation task status"),
    currentFile: z.string().optional().describe("Current file"),
    touchedFiles: z.array(z.string()).optional().describe("Touched files"),
    tags: z.array(z.string()).optional().describe("Optional task tags"),
  },
  async ({ workspacePath, title, taskKey, summary, currentStep, nextStep, blocker, status, currentFile, touchedFiles, tags }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.upsertImplementationThread({
            workspacePath,
            title,
            taskKey,
            summary,
            currentStep,
            nextStep,
            blocker,
            status,
            currentFile,
            touchedFiles,
            tags,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "record_module_adoption",
  "Record that a target project copied or adapted a reusable module, including the integration pattern, changed adapters/dependencies/env, and whether the adoption was validated.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key when node id is not available"),
    targetWorkspacePath: z.string().describe("Workspace that adopted the module"),
    adoptionType: z.enum(["copy", "adapt", "reference"]).optional().describe("How the module was reused"),
    status: z.enum(["planned", "integrating", "validated", "failed", "abandoned"]).optional().describe("Adoption status"),
    summary: z.string().optional().describe("Short outcome summary"),
    integrationPattern: z.string().optional().describe("What integration approach worked"),
    adapterChanges: z.array(z.string()).optional().describe("Adapter changes needed to fit the target project"),
    dependencyChanges: z.array(z.string()).optional().describe("Dependency additions/removals needed"),
    envChanges: z.array(z.string()).optional().describe("Env/config changes needed"),
    touchedFiles: z.array(z.string()).optional().describe("Touched target files"),
  },
  async ({ moduleId, moduleCanonicalKey, targetWorkspacePath, adoptionType, status, summary, integrationPattern, adapterChanges, dependencyChanges, envChanges, touchedFiles }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.recordModuleAdoption({
            moduleId,
            moduleCanonicalKey,
            targetWorkspacePath,
            adoptionType,
            status,
            summary,
            integrationPattern,
            adapterChanges,
            dependencyChanges,
            envChanges,
            touchedFiles,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "record_module_verification",
  "Record verification memory for a reused module, including passing tests, integration failures, and fix patterns that worked in the target workspace.",
  {
    moduleId: z.string().optional().describe("Reusable module node id"),
    moduleCanonicalKey: z.string().optional().describe("Reusable module canonical key when node id is not available"),
    adoptionId: z.string().optional().describe("Optional linked adoption record id"),
    adoptionKey: z.string().optional().describe("Optional linked adoption key"),
    targetWorkspacePath: z.string().describe("Workspace that verified the module"),
    status: z.enum(["pending", "passed", "failed", "mixed", "flaky"]).optional().describe("Verification status"),
    summary: z.string().optional().describe("Short verification outcome summary"),
    passedTests: z.array(z.string()).optional().describe("Tests or smoke checks that passed"),
    failedTests: z.array(z.string()).optional().describe("Tests that failed"),
    integrationErrors: z.array(z.string()).optional().describe("Integration errors encountered"),
    fixPatterns: z.array(z.string()).optional().describe("Fix patterns that resolved issues"),
    verificationNotes: z.array(z.string()).optional().describe("Short verification notes"),
  },
  async ({ moduleId, moduleCanonicalKey, adoptionId, adoptionKey, targetWorkspacePath, status, summary, passedTests, failedTests, integrationErrors, fixPatterns, verificationNotes }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.recordModuleVerification({
            moduleId,
            moduleCanonicalKey,
            adoptionId,
            adoptionKey,
            targetWorkspacePath,
            status,
            summary,
            passedTests,
            failedTests,
            integrationErrors,
            fixPatterns,
            verificationNotes,
          }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "activity_overview",
  `Get current running sessions, recent activity, and project usage stats.
Use this to see what's happening across all projects. For workspace-specific context, use session_bootstrap instead.`,
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getActivityOverview(), null, 2) }],
  })
);

server.tool(
  "start_activity",
  `Register that a tool started working in a workspace. For most cases, use session_bootstrap instead — it does this automatically plus returns context.`,
  {
    workspacePath: z.string().describe("Absolute path to the workspace root"),
    toolSource: z.string().optional().describe("Tool name such as codex, vscode, antigravity, cli"),
    summary: z.string().optional().describe("Short description of the current task"),
    commandText: z.string().optional().describe("Optional command being run"),
    projectName: z.string().optional().describe("Optional project display name"),
  },
  async ({ workspacePath, toolSource, summary, commandText, projectName }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(db.startActivity({ workspacePath, toolSource, summary, commandText, projectName }), null, 2),
      },
    ],
  })
);

server.tool(
  "heartbeat_activity",
  "Update the current state of an active workspace session. Use to report progress during long tasks.",
  {
    runId: z.string().describe("The activity run ID"),
    summary: z.string().optional().describe("Latest summary"),
    currentFile: z.string().optional().describe("Current file being edited or debugged"),
    latestError: z.string().optional().describe("Current error message if any"),
    message: z.string().optional().describe("Short event message"),
  },
  async ({ runId, summary, currentFile, latestError, message }) => {
    const result = db.heartbeatActivity(runId, { summary, currentFile, latestError, message });
    if (!result) {
      return {
        isError: true,
        content: [{ type: "text", text: `Run not found: ${runId}` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "finish_activity",
  `Mark an active workspace session as completed, failed, or stopped. For most cases, use record_outcome instead — it also handles edit/error recording.`,
  {
    runId: z.string().describe("The activity run ID"),
    status: z.enum(["completed", "failed", "stopped"]).optional().describe("Final status"),
    summary: z.string().optional().describe("Final summary"),
    currentFile: z.string().optional().describe("Last file touched"),
    latestError: z.string().optional().describe("Final error message"),
  },
  async ({ runId, status, summary, currentFile, latestError }) => {
    const result = db.finishActivity(runId, { status, summary, currentFile, latestError });
    if (!result) {
      return {
        isError: true,
        content: [{ type: "text", text: `Run not found: ${runId}` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "export_graph",
  "Export the current graph memory into a portable JSON file.",
  {
    targetPath: z.string().optional().describe("Optional destination path for the export JSON"),
  },
  async ({ targetPath }) => ({
    content: [{ type: "text", text: JSON.stringify(db.exportGraph(targetPath), null, 2) }],
  })
);

server.tool(
  "backup_database",
  "Create a raw SQLite backup file of the shared Graph Memory store.",
  {
    targetPath: z.string().optional().describe("Optional destination path for the backup DB file"),
  },
  async ({ targetPath }) => ({
    content: [{ type: "text", text: JSON.stringify(db.backupDatabase(targetPath), null, 2) }],
  })
);

server.tool(
  "import_graph",
  "Import a previously exported Graph Memory JSON file into the shared store.",
  {
    sourcePath: z.string().describe("Path to a Graph Memory export JSON file"),
    mode: z.enum(["replace", "merge"]).optional().describe("Replace current graph or merge into it"),
  },
  async ({ sourcePath, mode }) => ({
    content: [{ type: "text", text: JSON.stringify(db.importGraph(sourcePath, mode), null, 2) }],
  })
);

server.tool(
  "search_graph",
  `Search the graph for nodes matching a query. Matches against names, summaries, files, chat history, and debug signals.
Use this when you need to find nodes by keyword. For file-specific context, use get_context_for_file instead.`,
  {
    query: z.string().describe("The search query string"),
  },
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            query,
            count: db.searchNodes(query).length,
            results: db.searchNodes(query),
          },
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "get_node",
  "Get detailed information about a specific node by its ID. Use after search_graph or trace_node to get full details.",
  {
    nodeId: z.string().describe("The ID of the node to retrieve"),
  },
  async ({ nodeId }) => {
    const node = db.getNode(nodeId);
    if (!node) {
      return {
        isError: true,
        content: [{ type: "text", text: `Node not found: ${nodeId}` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(node, null, 2) }],
    };
  }
);

server.tool(
  "trace_node",
  `Find nodes related to a specific file path or diagnostic location. Returns matching nodes from the graph.
Use this when you have a file with an error and want to find related knowledge in the graph.`,
  {
    file: z.string().optional().describe("File path substring to match against node files"),
    location: z.string().optional().describe("Diagnostic location substring to match against debug signals"),
    query: z.string().optional().describe("General query string to match against node contents"),
  },
  async ({ file, location, query }) => {
    const results = db.traceNodes({ file, location, query });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              filters: { file, location, query },
              count: results.length,
              results,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "upsert_node",
  "Automatically create or fetch a node from an editor trace or file path. Creates if not exists, updates debug signals if provided.",
  {
    file: z.string().describe("The primary file associated with this context"),
    location: z.string().optional().describe("The location of the diagnostic"),
    symptom: z.string().optional().describe("The diagnostic message or symptom"),
    title: z.string().optional().describe("Title for the diagnostic"),
    type: z.string().optional().describe("Type of node"),
    severity: z.string().optional().describe("Severity of the issue"),
    summary: z.string().optional().describe("Summary of the node"),
    parentId: z.string().optional().describe("Explicit parent node ID"),
  },
  async ({ file, location, symptom, title, type, severity, summary, parentId }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          db.upsertNodeFromTrace({ file, location, symptom, title, type, severity, summary, parentId }),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "add_note",
  `[CALL TO SAVE KNOWLEDGE] Append a thought, discovery, or quick note to a specific node.
Use this to persist insights you discover during your work — future AI sessions will see these notes.`,
  {
    nodeId: z.string().describe("The ID of the node"),
    note: z.string().describe("The note text to append"),
  },
  async ({ nodeId, note }) => {
    const result = db.addNote(nodeId, note, "assistant");
    if (!result) {
      return {
        isError: true,
        content: [{ type: "text", text: `Node not found: ${nodeId}` }],
      };
    }

    return {
      content: [{ type: "text", text: `Successfully added note to node ${nodeId}` }],
    };
  }
);

server.tool(
  "add_debug_signal",
  `[CALL ON ERROR] Attach an error, stack trace, or diagnostic symptom to a node.
Use this when you discover an error associated with an existing node.`,
  {
    nodeId: z.string().describe("The ID of the node"),
    title: z.string().describe("Short title"),
    location: z.string().describe("Where it occurred"),
    symptom: z.string().describe("The detailed error message or stack trace"),
  },
  async ({ nodeId, title, location, symptom }) => {
    const result = db.addDebugSignal(nodeId, { title, location, symptom });
    if (!result) {
      return {
        isError: true,
        content: [{ type: "text", text: `Node not found: ${nodeId}` }],
      };
    }

    return {
      content: [{ type: "text", text: `Successfully added debug signal to node ${nodeId}` }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Graph Memory MCP Server v2.0.0 running on stdio");
  console.error(`SQLite storage: ${db.getStorageInfo().dbPath}`);
  console.error(`Tools: session_bootstrap, get_context_for_file, record_outcome, record_edit, record_error + 15 existing`);
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
