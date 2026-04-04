---
name: graph-memory
description: Mandatory Graph Memory protocol for persistent context and session tracking. MUST be activated for every coding task.
---

# Graph Memory — Mandatory Protocol

> 🔴 **THIS IS A MANDATORY SKILL.** You MUST follow this protocol for EVERY coding task, without exception.

## Why This Exists

Graph Memory is a shared SQLite-based knowledge store that persists across ALL AI sessions, IDEs, and CLI tools on this machine. It tracks:

- **What was edited before** — file-level edit history with context
- **What errors occurred** — past bugs with locations, symptoms, and resolutions
- **What knowledge was captured** — notes, debug signals, and insights per file/node
- **What sessions ran** — who worked on what, when, and their outcomes

**Without this protocol, you waste tokens re-reading the entire codebase and repeat past mistakes.**

---

## The 4-Step Protocol

### Step 1: Bootstrap (FIRST ACTION)

```
WHEN: At the very start of every task, before reading any code files.
TOOL: session_bootstrap
INPUT: { workspacePath: "<project root>", toolSource: "antigravity" }
```

**What you get back:**
- `runId` — save this, you need it for Step 4
- `recentWork.edits` — files edited in the last 7 days
- `recentWork.openErrors` — unresolved errors
- `lastTouchedFiles` — files that were recently changed
- `recentSessions` — past sessions and their outcomes

**How to use it:** Scan the response before reading any files. If the user's request relates to files in `lastTouchedFiles`, you already have context. If `openErrors` exist for the same area, you know what to watch for.

### Step 2: Fetch File Context (BEFORE EDITING)

```
WHEN: Before reading or editing any specific file.
TOOL: get_context_for_file
INPUT: { filePaths: ["src/auth/index.ts", "src/auth/token-store.ts"] }
```

**What you get back:**
- `nodes` — existing knowledge about these files (notes, signals, context)
- `recentEdits` — what was changed in these files recently
- `openErrors` — known bugs in these files
- `relatedNodes` — other files/modules connected to these

**How to use it:** Read this BEFORE reading the actual file. If the file has notes like "Can lock refresh token flow" or debug signals like "Race condition in line 42", you immediately know what to focus on.

### Step 3: Record Knowledge (DURING WORK)

```
WHEN: As you discover important insights, encounter errors, or make significant edits.
TOOLS: record_edit, record_error, add_note
```

**Examples:**
- Found a critical insight about the codebase → `add_note(nodeId, "CORS config must have exact origin, not wildcard, for credentials to work")`
- Encountered an error → `record_error({ file, location, symptom, title })`
- Made a significant edit → `record_edit({ file, summary, toolSource: "antigravity" })`

### Step 4: Finalize (LAST ACTION)

```
WHEN: When your task is complete (success or failure), before ending the conversation.
TOOL: record_outcome
INPUT: { runId: "<from step 1>", status: "completed", touchedFiles: [...], summary: "..." }
```

**What this does:**
- Closes your activity session
- Creates edit nodes for each touched file
- If failed: creates error nodes so the next AI can see what went wrong
- Future `session_bootstrap` calls will show this session's results

---

## Decision Matrix

| Situation | Action |
|-----------|--------|
| Starting any task | → `session_bootstrap` FIRST |
| About to read/edit a file | → `get_context_for_file` first |
| Found a bug or error | → `record_error` with location + symptom |
| Made a significant code change | → `record_edit` with summary |
| Discovered an insight worth remembering | → `add_note` on the relevant node |
| Task complete (success) | → `record_outcome` with status="completed" |
| Task failed | → `record_outcome` with status="failed" + latestError |
| User asks "what did we do last time?" | → `session_bootstrap` (shows recentSessions) |
| User asks about errors in a file | → `get_context_for_file` (shows openErrors) |

---

## Token Optimization

The whole point of this system is to **reduce how many tokens you consume**. Follow these rules:

1. **Do NOT call `get_graph`** unless specifically asked — it dumps the entire database
2. **ALWAYS call `get_context_for_file`** before reading a large file — if context already exists, you may not need to read the whole file
3. **Use `search_graph`** if you need to find something by keyword rather than file path
4. **Keep notes concise** — focus on "why" over "what" (the code itself shows "what")

---

## Anti-Patterns (DO NOT DO)

❌ Start editing files without calling `session_bootstrap` first
❌ Read entire codebase when `get_context_for_file` could give you the context
❌ End a conversation without calling `record_outcome`
❌ Encounter an error but not record it
❌ Make a major refactor but not `record_edit` the changed files
❌ Call `get_graph` to check one file's context (use `get_context_for_file` instead)
