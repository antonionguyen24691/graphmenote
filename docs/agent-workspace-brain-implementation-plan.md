# Agent Workspace Brain Implementation Plan

Date: 2026-04-25

## Positioning

Graph Memory should not be sold as a generic graph viewer, a pure LLM wiki, or a general memory database. The strongest position is:

**Agent Workspace Brain for software projects**

The product promise:

AI coding agents do not only remember facts. They remember what happened in this repo, where work stopped, which files and nodes were touched, which modules can be reused, which integration patterns already passed verification, and what small delta is enough to resume work.

## Battlecard

| Competitor | Strongest position | Where Graph Memory can win | Gap to close |
| --- | --- | --- | --- |
| LLM Wiki | Wiki-first knowledge compilation and clear human-facing story | Execution continuity, implementation threads, module adoption, verification memory | Product narrative, onboarding, readable outputs |
| Ryumem | Bi-temporal knowledge graph memory for agents, episode storage, retrieval policies, contradiction handling, pruning | Repo-aware workflow, file/task/module continuity, coding-specific resume packs | Memory engine maturity, retrieval policy, infra packaging |
| Konnektr | Graph + vector database with schema validation, ontology, MCP/API packaging | Developer workflow state, task progress, module reuse operations | Schema rigor, enterprise graph model, trust boundaries |
| Mengram | Semantic, episodic, and procedural memory with broad integrations | Software-project memory, module reuse intelligence, cross-IDE/CLI resume | Product completeness, integration breadth, onboarding |

Direct category to own:

**Workspace Continuity for Coding Agents**

## Strategic Principle

Every roadmap item should answer one of four questions:

1. What changed?
2. Where should the next agent resume?
3. Which module or pattern should be reused?
4. Why is this context pack small but sufficient?

If a feature does not improve one of those answers, it is secondary.

## Weakness Removal Tracks

### 1. Sharpen the product story

Problem:

The current app exposes strong primitives, but the user has to infer the product from technical surfaces.

Target:

Make the first-run and dashboard language explain Graph Memory as a continuity layer for coding agents.

Deliverables:

- Rename user-facing primary concept from generic "graph memory" to "workspace brain" where appropriate.
- Add a first-screen workspace brief with:
  - last meaningful change
  - current implementation thread
  - recommended resume command
  - reusable module candidate
  - compact context size estimate
- Add a one-page product narrative in docs and app help:
  - "not a wiki"
  - "not generic memory infra"
  - "continuity for coding agents"
- Add a "Why this context?" panel explaining why selected files, nodes, modules, and tasks were included.

Acceptance checks:

- A new user can explain the product in one sentence after opening the app.
- The UI shows the next useful action without requiring graph knowledge.
- The README and app language use the same positioning.

### 2. Standardize context pack, delta pack, and cursor protocol

Problem:

The project has low-token context, implementation continuity, workflow packs, and stored cursors, but the contract needs to be explicit enough for IDEs, CLIs, and sidecars to rely on.

Target:

Publish a stable protocol that external tools can call without understanding internal graph tables.

Deliverables:

- Define `WorkspaceContextPack`:
  - workspace identity
  - recent work summary
  - active implementation thread
  - ranked files
  - relevant graph nodes
  - reusable module candidates
  - verification memory
  - token estimate
- Define `WorkspaceDeltaPack`:
  - since cursor
  - changed files
  - touched nodes
  - completed/active runs
  - new errors
  - new module adoption or verification records
  - next cursor
- Define `WorkspaceCursor`:
  - workspace path
  - last activity event id
  - last edit timestamp
  - last graph mutation timestamp
  - schema version
- Add HTTP, CLI, MCP parity:
  - `context-pack`
  - `delta-pack`
  - `cursor-get`
  - `cursor-advance`
- Version every pack with `protocolVersion`.

Acceptance checks:

- A CLI can resume with a cursor without rescanning the whole workspace.
- A VS Code sidecar can request only changes since its last read.
- Pack shape remains stable across UI/runtime changes.

### 3. Add a memory policy engine by purpose

Problem:

Retrieval exists, but selection rules need to become explainable, testable, and purpose-specific.

Target:

Make retrieval policy explicit for `coding`, `review`, `deploy`, and `crawl`.

Deliverables:

- Add `MemoryPolicy` profiles:
  - `coding`: implementation thread, touched files, debug context, reusable modules
  - `review`: changed files, impact radius, tests, prior errors, risky nodes
  - `deploy`: env/config, recent deploy runs, verification memory, rollback notes
  - `crawl`: project boundaries, ignored paths, detected modules, ingestion history
- Add policy output diagnostics:
  - included reason
  - excluded reason
  - score
  - token cost
  - freshness
- Add policy regression fixtures that snapshot expected pack composition.
- Add CLI command:
  - `node graph-cli.js policy-explain --purpose coding --workspacePath "..."`

Acceptance checks:

- Two agents asking for `coding` vs `review` receive different, explainable packs.
- Pack selection can be tested without calling an LLM.
- The UI can show why a context pack is small.

### 4. Upgrade UI from graph debug console to operations console

Problem:

The graph UI is useful for inspection, but the high-value workflows are buried under technical concepts.

Target:

Make the app answer operational questions first and keep graph visualization as drill-down.

Deliverables:

- Add top-level tabs:
  - `Resume`
  - `Changes`
  - `Modules`
  - `Policies`
  - `Graph`
- `Resume` view:
  - active implementation threads
  - next step
  - blocker
  - last touched files
  - resume pack preview
- `Changes` view:
  - activity timeline
  - changed files
  - new errors
  - delta since cursor
- `Modules` view:
  - harvest results
  - match results
  - adoption recipe
  - execution assist
  - verification memory
- `Policies` view:
  - purpose selector
  - included/excluded context
  - token estimate
- `Graph` view:
  - advanced drill-down, not the primary landing surface

Acceptance checks:

- The default view tells an agent or developer where to resume.
- Module reuse can be evaluated without reading raw graph nodes.
- Policy decisions are visible without opening dev tools.

### 5. Build the integration story

Problem:

The repo already has CLI, MCP, watcher, and VS Code extension surfaces, but the product story should make cross-tool continuity feel intentional.

Target:

Make every agent surface share the same context, cursor, and checkpoint protocol.

Deliverables:

- CLI:
  - `graph resume`
  - `graph checkpoint`
  - `graph delta`
  - `graph modules match`
- MCP:
  - keep tool names aligned with protocol names
  - add examples for Codex, Claude Code, Cursor, and VS Code
- VS Code:
  - show current thread and last checkpoint in sidebar
  - add "checkpoint now"
  - add "copy resume pack"
- Watcher:
  - auto-checkpoint on command completion
  - detect changed files and active branch
  - attach test/build outcomes to the active thread
- Sidecar docs:
  - explain how any IDE/CLI can implement resume with `WorkspaceCursor` and `WorkspaceDeltaPack`.

Acceptance checks:

- A task started in Codex can be resumed in VS Code or another CLI with a small delta pack.
- A checkpoint created by the watcher appears in the UI and MCP context.
- Integration docs include copy-paste commands.

## Priority Roadmap

### Phase 1: Product clarity and protocol foundation

Goal:

Turn the current primitives into a clear product surface.

Ship:

- This positioning document linked from README.
- `WorkspaceContextPack`, `WorkspaceDeltaPack`, and `WorkspaceCursor` schema docs.
- CLI/API/MCP contract map for current and planned surfaces.
- UI copy update for workspace brain positioning.

Why first:

Without this, future work adds features but does not reduce product ambiguity.

### Phase 2: Purpose-based retrieval policy

Goal:

Make context selection reliable, explainable, and testable.

Ship:

- `MemoryPolicy` profiles for coding, review, deploy, crawl.
- policy explanation output.
- policy snapshot tests.
- UI policy preview.

Why second:

This closes the biggest platform-maturity gap versus memory infra tools while reinforcing the coding-agent niche.

### Phase 3: Operations console UI

Goal:

Make Graph Memory useful before users understand the graph.

Ship:

- Resume, Changes, Modules, Policies, Graph navigation.
- resume pack preview.
- delta since cursor view.
- module reuse workflow cards.

Why third:

Once the contract and policy are stable, UI can expose durable workflows instead of mirroring internals.

### Phase 4: Cross-tool continuity integrations

Goal:

Make the product real across IDE/CLI boundaries.

Ship:

- CLI resume/checkpoint/delta commands.
- VS Code checkpoint and resume pack sidebar.
- watcher auto-checkpoint improvements.
- integration recipes for Codex, Claude Code, Cursor, VS Code, and generic MCP clients.

Why fourth:

The strongest moat is continuity across tools. This phase turns the narrative into daily workflow value.

## Implementation Backlog

| Priority | Item | Owner surface | Notes |
| --- | --- | --- | --- |
| P0 | Add protocol docs for context/delta/cursor | docs | No runtime risk, unblocks alignment |
| P0 | Map existing API/CLI/MCP endpoints to protocol concepts | docs | Identifies gaps before coding |
| P0 | Add README positioning section | docs | Fixes narrative immediately |
| P1 | Implement policy profile registry | db/server/client/mcp/cli | Start with deterministic scoring |
| P1 | Add `policy-explain` CLI/API/MCP | cli/server/mcp | Must include reasons and token cost |
| P1 | Add policy snapshot tests | tests | Protect retrieval behavior |
| P2 | Add Resume view as default app view | app/styles/index | First UX move |
| P2 | Add Delta view backed by cursor protocol | app/server/db | Makes continuity visible |
| P2 | Add Modules workflow view | app/server/db | Reuse intelligence becomes a product surface |
| P3 | Add VS Code checkpoint/resume UI | vscode-extension | Cross-tool proof |
| P3 | Improve watcher checkpoints | activity-watcher | Attach branch, command, changed files, test result |

## Metrics

Track whether the roadmap is actually cutting weaknesses:

- Time to resume a task from another tool.
- Token count of resume pack versus full repo scan.
- Percentage of pack items with an explainable inclusion reason.
- Number of successful module adoptions with verification memory.
- Number of active integrations using cursor/delta protocol.
- First-run user success: can identify next action within 30 seconds.

## Sources Checked

This plan is based on the user's competitive analysis plus a quick review of public positioning for:

- LLM Wiki: wiki compilation and agent knowledge-base packaging.
- Ryumem: bi-temporal knowledge graph memory, episode storage, smart retrieval, contradiction handling, pruning.
- Konnektr: validated graph + vector database, DTDL schema, PostgreSQL/Apache AGE/pgvector, MCP tools.
- Mengram: semantic, episodic, procedural memory, broad agent integrations.

The differentiator to protect is not "we have memory." It is:

**A coding agent can leave, come back through another tool, receive a compact delta, and continue from the right file, task, module, and verified pattern.**
