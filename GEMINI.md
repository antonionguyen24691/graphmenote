# Graph Memory — Mandatory AI Protocol

> Every AI agent working in this repository MUST follow this protocol.
> This file is read by Gemini and Antigravity agents automatically.

## MCP Server

This project includes a Graph Memory MCP server that provides persistent context across sessions.
The MCP server is at `mcp-server.js` and uses a shared SQLite store at `~/.graph-memory/graph.db`.

## Required Workflow

### 1. ALWAYS call `session_bootstrap` first

Before reading any files, call the `session_bootstrap` MCP tool:

```
session_bootstrap({ workspacePath: "<this project root>", toolSource: "antigravity" })
```

This returns:
- `runId` — needed to close your session
- Recent edits and open errors in this workspace
- Last touched files and past session history

### 2. Before editing any file, call `get_context_for_file`

```
get_context_for_file({ filePaths: ["path/to/file.ts"] })
```

This gives you existing knowledge about that file: past errors, edit history, notes, and related context.
**This saves you from reading the entire file if the context already covers your question.**

### 3. Record your work

- `record_edit({ file, summary })` — after significant edits
- `record_error({ file, location, symptom })` — when you encounter errors
- `add_note(nodeId, note)` — when you discover important insights

### 4. ALWAYS call `record_outcome` when done

```
record_outcome({ runId: "<from step 1>", status: "completed", touchedFiles: [...], summary: "..." })
```

This ensures the next AI session sees what you did.

## Key Rules

- **NEVER skip `session_bootstrap`** — it's the single most important call
- **NEVER end without `record_outcome`** — future agents depend on this
- **Prefer `get_context_for_file` over reading whole files** — it's faster and uses fewer tokens
- **Record errors with location** — "src/auth/index.ts:42" not just "auth file"
- **Keep notes concise** — focus on "why" not "what" (the code shows "what")
