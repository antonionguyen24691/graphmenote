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
