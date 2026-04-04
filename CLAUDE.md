# Graph Memory — Mandatory AI Protocol

> Every AI agent working in this repository MUST follow this protocol.

## MCP Server

This project includes a Graph Memory MCP server (`mcp-server.js`) that provides persistent context across all AI sessions using a shared SQLite store.

**MCP Config for Claude Code:**

```json
{
  "mcpServers": {
    "graph-memory": {
      "command": "node",
      "args": ["<path-to-this-repo>/mcp-server.js"]
    }
  }
}
```

## Required Workflow

### 1. ALWAYS call `session_bootstrap` first

Before reading any files, call the `session_bootstrap` MCP tool:

```
session_bootstrap({ workspacePath: "<this project root>", toolSource: "claude" })
```

This returns:
- `runId` — save this, needed to close your session  
- `recentWork.edits` — files edited in the last 7 days
- `recentWork.openErrors` — unresolved errors
- `lastTouchedFiles` — recently changed files
- `recentSessions` — past session history and outcomes

**Why:** This instantly tells you what was done before — no need to read the entire codebase.

### 2. Before editing any file, call `get_context_for_file`

```
get_context_for_file({ filePaths: ["path/to/file.ts"] })
```

Returns existing knowledge about that file:
- Past errors (debugSignals)
- Recent edits with summaries
- Notes from past sessions
- Related files/nodes

**Why:** You may already have context about this file. Don't waste tokens re-reading everything.

### 3. Record your work as you go

| When | Tool | What to include |
|------|------|-----------------|
| After editing a file | `record_edit` | file path, change summary |
| When encountering an error | `record_error` | file, location (line:col), error message |
| When discovering insights | `add_note` | nodeId, concise insight |

### 4. ALWAYS call `record_outcome` when done

```
record_outcome({
  runId: "<from step 1>",
  status: "completed",  // or "failed"
  touchedFiles: ["file1.ts", "file2.ts"],
  summary: "What you accomplished"
})
```

**Why:** Without this, your work is invisible to future sessions. The next AI won't know what you did.

## Anti-Patterns

- ❌ Starting work without `session_bootstrap`
- ❌ Reading entire files when `get_context_for_file` has the answer
- ❌ Ending without `record_outcome`
- ❌ Encountering errors without recording them
- ❌ Making major edits without `record_edit`
- ❌ Using `get_graph` (dumps entire DB) when you only need file context

## Key MCP Tools Reference

| Tool | When to use |
|------|-------------|
| `session_bootstrap` | **FIRST** — start of every task |
| `get_context_for_file` | Before reading/editing any file |
| `record_outcome` | **LAST** — end of every task |
| `record_edit` | After significant file changes |
| `record_error` | When encountering errors |
| `add_note` | To save insights for future sessions |
| `search_graph` | To find nodes by keyword |
| `trace_node` | To find nodes by file path |
