const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const db = require("./db");

const server = new McpServer({
  name: "graph-memory",
  version: "1.1.0",
});

server.tool(
  "get_graph",
  "Get the entire Graph Memory database. Only use if absolutely necessary, as this can be large.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getGraph(), null, 2) }],
  })
);

server.tool(
  "storage_info",
  "Get the local persistent storage path for the shared Graph Memory database on this machine.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getStorageInfo(), null, 2) }],
  })
);

server.tool(
  "activity_overview",
  "Get current running sessions and recent usage of the shared Graph Memory across projects and tools.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(db.getActivityOverview(), null, 2) }],
  })
);

server.tool(
  "start_activity",
  "Register that a tool started working in a workspace so future agents can see current progress.",
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
  "Update the current state of an active workspace session.",
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
  "Mark an active workspace session as completed, failed, or stopped.",
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
  "Search the graph for nodes matching a specific query string. Matches against names, summaries, files, chat history, and debug signals.",
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
  "Get detailed information about a specific node by its ID.",
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
  "Find nodes related to a specific file or diagnostic location.",
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
  "Automatically create or fetch a node from an editor trace or file path.",
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
  "Append a new thought, discovery, or quick note to a specific node.",
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
  "Attach a specific error, stack trace, or diagnostic symptom to a node.",
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
  console.error("Graph Memory MCP Server running on stdio");
  console.error(`SQLite storage: ${db.getStorageInfo().dbPath}`);
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
