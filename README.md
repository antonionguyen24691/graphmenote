# Graph Memory API

Prototype nay cung cap mot lop `graph-memory` dung chung cho UI, VS Code extension, Codex hoac agent runtime.

Huong dan dung theo workflow hang ngay nam tai:

- [USAGE.md](C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\USAGE.md)
- [Agent Workspace Brain implementation plan](docs/agent-workspace-brain-implementation-plan.md)

## Thanh phan

- `db.js`: SQLite persistent store dung chung cho toan may.
- `graph-data.json`: legacy seed file de migrate ban dau, khong con la storage chinh.
- `server.js`: HTTP API va static server doc/ghi vao SQLite.
- `app.js`: UI client doc/ghi qua API thay vi localStorage rieng.
- `graph-client.js`: client adapter de agent, extension hoac script goi API bang function.
- `graph-cli.js`: CLI wrapper de goi graph tu terminal.
- `mcp-server.js`: MCP server cho agent runtimes dung chung SQLite store.
- `vscode-extension/`: VS Code sidebar extension trace file + diagnostics vao Graph Memory.
- `activity_runs` + `activity_events`: luu session dang chay, project dang dung, tien do va lich su su dung bo nho.
- `activity-watcher.js`: watcher nen doc session Codex va process metadata de tu ghi activity.
- `boot-graph-memory.ps1`: start nen Graph Memory API + watcher.
- `install-graph-startup.ps1`: cai auto-start cung Windows.

Graph app va VS Code extension deu da co UI cho `Export JSON`, `Backup DB`, `Import Replace/Merge`.
Graph app va extension cung co the crawl project folders thanh node bang UI hoac API.

Da co them:

- Codex local plugin scaffold tai `C:\Users\DELL\.codex\plugins\graph-memory-bridge`
- Marketplace local tai `C:\Users\DELL\.agents\plugins\marketplace.json`
- VSIX san tai `C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\vscode-extension\graph-memory.vsix`

Vi du crawl:

```bash
node graph-cli.js crawl-projects "C:\Users\DELL\OneDrive\Desktop\sang kein" 3
```

## Luu tru vinh vien tren may

Mac dinh Graph Memory gio duoc luu trong SQLite tai:

- `C:\Users\DELL\.graph-memory\graph.db`

Thu muc phu tro mac dinh:

- `C:\Users\DELL\.graph-memory\exports`
- `C:\Users\DELL\.graph-memory\backups`

Thu muc goc co the doi bang env:

- `GRAPH_MEMORY_HOME`
- `GRAPH_MEMORY_DB_PATH`
- `GRAPH_MEMORY_VAULT_ROOT`

Dieu nay cho phep VS Code, Codex, Antigravity, CLI va MCP cung doc/ghi vao cung mot kho nho cuc bo tren may.

## Obsidian Vault + Module Memory

Graph Memory da co them lop tri thuc ben ngoai repo code de phuc vu workflow "LLM wiki + module reuse + low token":

- `External vault`: Obsidian-style vault luu o working directory rieng cho artifact markdown.
- `Reusable modules`: registry cho module/co nang co the tai su dung nhu `map`, `ocr`, `auth`, `upload`, `pdf`.
- `Brain skills`: registry skill/playbook co the import tu Git vao vault, index thanh bo nho dung chung cho IDE/CLI/MCP.
- `Low-token context`: bootstrap payload gon cho IDE/CLI, uu tien memory + module candidates truoc khi doc source sau.

### Vault config va scaffold

- HTTP: `GET /api/vault-config`, `POST /api/vault-config`, `POST /api/vault/scaffold`
- CLI:
  - `node graph-cli.js vault-config`
  - `node graph-cli.js vault-set "C:\Users\DELL\KnowledgeVault"`
  - `node graph-cli.js vault-scaffold "C:\Users\DELL\KnowledgeVault"`
- MCP: `vault_config`, `set_vault_config`, `scaffold_vault`

### Reusable module registry

- HTTP: `GET /api/reusable-modules`, `POST /api/modules/register`, `POST /api/modules/harvest`
- CLI:
  - `node graph-cli.js modules --capability ocr --workspacePath "C:\repo\new-app"`
  - `node graph-cli.js module-register "C:\repo\stock" "C:\repo\stock\src\ocr" ocr OCR Module`
  - `node graph-cli.js module-harvest "C:\repo\stock" --maxDepth 5 --maxFiles 300`
- MCP: `find_reusable_modules`, `register_reusable_module`, `harvest_reusable_modules`

### Low-token bootstrap cho IDE/CLI

- HTTP: `GET /api/low-token-context`
- CLI: `node graph-cli.js low-token-context --workspacePath "C:\repo\stock" --query ocr`
- MCP: `low_token_context`

Payload low-token gom:

- project brief
- recent work trong workspace
- reusable module candidates
- compact debug context + recommended files
- token estimate de giam context load

### Brain context + Git skills

- HTTP:
  - `GET /api/brain/context`
  - `GET /api/brain/skills`
  - `POST /api/brain/skills/register`
  - `POST /api/brain/skills/update-git`
- CLI:
  - `node graph-cli.js brain-context --workspacePath "C:\repo\stock" --query ocr`
  - `node graph-cli.js brain-skills --query testing`
  - `node graph-cli.js brain-skill-register "C:\skills\my-skill" --name "My Skill"`
  - `node graph-cli.js brain-skill-update https://github.com/org/repo.git --subdir skills/ocr --ref main --name "OCR Skill"`
- MCP:
  - `brain_context`
  - `list_brain_skills`
  - `register_local_brain_skill`
  - `update_brain_skill_from_git`

Skill Git duoc clone/pull vao `vault/skills/_git`, doc metadata tu `skill.json`, `SKILL.md`, `README.md`, va `package.json`, roi dua vao `brain-context` de agent dung nhu playbook truoc khi mo source code.

## Local AI Provider Gateway + Harness

Graph Memory co them lop gateway cho local model va model harness, dung OpenAI-compatible API lam giao dien chung. Mac dinh registry se co:

- Ollama: `http://localhost:11434/v1`
- llama.cpp server: `http://localhost:8080/v1`
- vLLM: `http://localhost:8000/v1`
- Custom `harness`/OpenAI-compatible provider co the dang ky them bang CLI, HTTP hoac MCP.

Muc tieu: IDE/CLI/agent khong can tu scan lai repo qua nhieu token. Agent co the goi `ai-chat` voi `workspacePath`; Graph Memory se chen compact brain context gom recent work, reusable modules, skill hints va implementation thread vao prompt truoc khi goi local model.

CLI:

```bash
node graph-cli.js ai-providers
node graph-cli.js ai-provider-add ollama http://localhost:11434/v1 --model qwen2.5-coder --capabilities chat,json,harness
node graph-cli.js ai-healthcheck --provider provider-ollama-local
node graph-cli.js ai-chat --provider provider-ollama-local --model qwen2.5-coder --workspacePath "C:\repo\stock" --query "Tom tat viec can lam tiep"
node graph-cli.js ai-harness-run --provider provider-ollama-local --suite harness
node graph-cli.js ai-model-runs --limit 10
node graph-cli.js ai-doctor --timeoutMs 1200
node graph-cli.js ai-pick --purpose coding --checkHealth false
```

HTTP:

- `GET /api/ai/providers`
- `POST /api/ai/providers`
- `POST /api/ai/providers/healthcheck`
- `POST /api/ai/chat`
- `POST /api/ai/harness/run`
- `GET /api/ai/setup-doctor`
- `GET /api/ai/runtime-pick`
- `GET /api/ai/model-runs`

MCP:

- `list_ai_providers`
- `register_ai_provider`
- `healthcheck_ai_provider`
- `chat_with_ai_provider`
- `run_ai_harness`
- `ai_setup_doctor`
- `pick_ai_runtime`
- `list_ai_model_runs`

Harness note: built-in harness dung de smoke test, latency, JSON contract va integration memory. Neu can benchmark chuan hon, metadata provider da luu hint cho EleutherAI `lm-evaluation-harness` qua OpenAI-compatible adapter/proxy.

### Runtime profiles + internal chat memory

Graph Memory cung co runtime profile de agent chon model theo muc dich thay vi hard-code provider trong tung IDE/CLI:

- `profile-local-chat`: hoi dap noi bo co compact workspace memory.
- `profile-local-coding`: coding workflow, mac dinh huong toi local coder model.
- `profile-local-harness`: evaluation/benchmark adapter.

CLI:

```bash
node graph-cli.js ai-profiles
node graph-cli.js ai-profile-upsert --id profile-local-crawl --name "Local Crawl" --purpose crawl --provider provider-ollama-local --model qwen2.5-coder --contextPolicy low-token
node graph-cli.js ai-chat-start --workspacePath "C:\repo\stock" --title "OCR rollout" --profile profile-local-coding
node graph-cli.js ai-chat-send --threadId ai-chat-abc --message "Dang dung o dau?"
node graph-cli.js ai-chat-threads --workspacePath "C:\repo\stock"
```

MCP:

- `list_ai_runtime_profiles`
- `upsert_ai_runtime_profile`
- `list_ai_chat_threads`
- `send_ai_chat_message`

Chat thread duoc luu theo workspace, kem provider/model/profile dang dung va run id cua moi lan goi model. Khi IDE/CLI khac mo lai repo, no co the list thread va tiep tuc hoi dap noi bo tu dung diem dung truoc.

`ai-doctor` la lenh nen chay sau khi cai model local. No probe `/v1/models`, check profile co tro dung model khong, detect CLI nhu `ollama`, va tra ve backlog task con thieu cho local AI stack.

`ai-pick` la router gon cho agent: nhap `purpose` nhu `coding`, `chat`, `harness`, `crawl`; he thong tra ve profile/provider/model nen dung va ly do cham diem. `ai-chat-send --autoPick true` co the dung picker nay de bot can hard-code model trong IDE/CLI.

## Chay local

```bash
node server.js
```

Mo [http://localhost:3010](http://localhost:3010).

Khi server khoi dong, no se in ra duong dan SQLite storage.

## Node model

Moi node hien co:

- `id`, `name`, `type`, `summary`
- `files`
- `relations`
- `contextWindow`
- `debugSignals`
- `chatHistory`
- `notes`
- `openIssues`, `severity`

## API hien co

### `GET /api/graph`

Lay toan bo graph.

### `GET /api/storage`

Lay thong tin duong dan storage local, active node va so node hien co.

### `GET /api/activity/overview`

Lay overview xem session nao dang chay, project nao vua duoc dung, va history gan day.

### `GET /api/activity/runs`

Lay danh sach session theo `status`, `projectId`, `workspacePath`, `limit`.

### `POST /api/activity/start`

Body JSON:

```json
{
  "workspacePath": "C:\\repo\\stock",
  "toolSource": "codex",
  "summary": "Dang debug auth retry loop",
  "commandText": "npm run dev"
}
```

### `POST /api/activity/heartbeat`

Body JSON:

```json
{
  "runId": "run-codex-c-repo-stock-...",
  "summary": "Dang trace src/auth/index.ts",
  "currentFile": "src/auth/index.ts",
  "message": "Dang xem flow refresh token"
}
```

### `POST /api/activity/finish`

Body JSON:

```json
{
  "runId": "run-codex-c-repo-stock-...",
  "status": "completed",
  "summary": "Da fix race condition",
  "touchedFiles": [
    "src/auth/index.ts",
    "src/auth/token-store.ts"
  ]
}
```

### `POST /api/export`

Export graph hien tai ra file JSON portable.

### `POST /api/backup`

Tao ban sao raw cua SQLite database.

### `POST /api/import`

Import lai tu file export JSON.

### `GET /api/search?query=auth`

Tim node theo ten, file, symptom, context, chat history.

### `GET /api/trace?file=src/auth/token-store.ts`

Tim node lien quan theo file.

Co the ket hop:

- `location=src/auth/token-store.ts:88`
- `query=refresh`

### `GET /api/nodes/:id`

Lay chi tiet mot node.

### `POST /api/active-node`

Body JSON:

```json
{
  "nodeId": "auth-service"
}
```

### `POST /api/nodes/:id/notes`

Body JSON:

```json
{
  "note": "Can lock refresh token flow",
  "role": "assistant"
}
```

### `POST /api/nodes/:id/chat`

Body JSON:

```json
{
  "message": "User bao loi xuat hien sau khi tab sleep",
  "role": "user"
}
```

## Client adapter

Co the import truc tiep:

```js
const {
  startActivity,
  heartbeatActivity,
  finishActivity,
  getActivityOverview,
  traceNode,
  getNode,
  addNote,
  addChat,
} = require("./graph-client");

const run = await startActivity({
  workspacePath: "C:\\repo\\stock",
  toolSource: "codex",
  summary: "Dang debug auth"
});
await heartbeatActivity(run.id, {
  currentFile: "src/auth/index.ts",
  summary: "Dang trace token refresh"
});
const trace = await traceNode({ file: "src/auth/token-store.ts" });
const node = await getNode("auth-service");
await addNote("auth-service", "Can lock refresh token flow");
await addChat("auth-service", "User bao loi xuat hien sau sleep tab", "user");
await finishActivity(run.id, {
  status: "completed",
  summary: "Da fix auth retry loop",
  touchedFiles: ["src/auth/index.ts", "src/auth/token-store.ts"]
});
const overview = await getActivityOverview();
```

Mac dinh client goi toi `http://localhost:3010`.
Neu can doi host, dat env `GRAPH_MEMORY_BASE_URL`.

## Auto runtime

Chay mot lan de cai startup:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\install-graph-startup.ps1"
```

Sau do Graph Memory API + watcher se tu chay cung Windows. Watcher hien tai tu doc:

- Codex session files trong `C:\Users\DELL\.codex\sessions`
- process command line cua cac app co the suy ra workspace path

## CLI

```bash
node graph-cli.js graph
node graph-cli.js storage
node graph-cli.js activity-overview
node graph-cli.js activity-runs --status running
node graph-cli.js activity-start "C:\repo\stock" codex Dang debug auth
node graph-cli.js activity-beat run-123 --file src/auth/index.ts --summary Dang trace token
node graph-cli.js activity-finish run-123 --status completed --summary Da fix xong --touchedFiles src/auth/index.ts,src/auth/token-store.ts
node graph-cli.js run "C:\repo\stock" codex npm run dev
node graph-cli.js search refresh token
node graph-cli.js trace --file src/auth/token-store.ts
node graph-cli.js node auth-service
node graph-cli.js create src/new/module.ts New Module
node graph-cli.js upsert-trace src/new/module.ts src/new/module.ts:10 Error message
node graph-cli.js note auth-service Can lock refresh token flow
node graph-cli.js export
node graph-cli.js backup
node graph-cli.js import C:\path\to\graph-export.json replace
```

`export` tao JSON portable trong `exports`.
`backup` tao ban sao `.db` trong `backups`.
`import` ho tro `replace` hoac `merge`.

## Cach de agent dung lop nay

Agent co the:

1. Lay file/stack trace dang loi.
2. Goi `traceNode()` hoac `/api/trace` de tim node lien quan.
3. Lay `getNode()` hoac `/api/nodes/:id` de nap context window.
4. Ghi note moi vao `addNote()` hoac `/api/nodes/:id/notes`.
5. Ghi chat tom tat vao `addChat()` hoac `/api/nodes/:id/chat`.

## Cach de he thong tu ghi vao graph khi chay project khac

Co 2 cach thuc dung:

1. Dung `activity API`
- Tool nao cung co the goi `start -> heartbeat -> finish`
- `workspacePath` se duoc map ve project node tu dong
- Neu `finish` co `touchedFiles`, Graph Memory se tao `edit nodes`
- Neu `finish` co `status=failed` + `location` + `currentFile`, Graph Memory se tao `error node`

2. Dung `graph-cli.js run`
- Chay command cua project thong qua wrapper:

```bash
node graph-cli.js run "C:\repo\stock" codex npm run dev
```

- Wrapper se:
  - tao activity session
  - heartbeat dinh ky
  - ket thuc session khi process dong
  - ghi lai session trong `Usage Memory` cua web app

Nghia la Codex, Antigravity, VS Code task runner, hay bat ky CLI nao deu co the dung chung mot giao thuc de ghi va tra cuu lai tien do dang lam.

## Cach de Codex/extension goi

Mot adapter rat mong cho agent co the theo flow:

1. Khi thay file dang loi, goi `traceNode({ file, location, query })`.
2. Lay `results[0].id`.
3. Goi `getNode(nodeId)` de lay `contextWindow`, `debugSignals`, `chatHistory`.
4. Sau khi debug xong, goi `addNote(nodeId, note)` de luu tri thuc moi.

VS Code extension ve sau co the:

- lay diagnostics tu editor
- lay file dang mo
- goi `traceNode({ file, location })`
- hien context node trong sidebar/webview

Trong prototype nay, extension da duoc scaffold san o [vscode-extension/README.md](C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\vscode-extension\README.md).

Ban mo rong hien tai con them:

- SQLite global store o `C:\Users\DELL\.graph-memory\graph.db`
- backup SQLite va export JSON trong cung storage home
- `POST /api/nodes/:id/debug-signals` de luu loi moi tu editor/agent
- `POST /api/nodes` de tao node moi
- `POST /api/nodes/upsert-from-trace` de tu tao hoac cap nhat node tu file/diagnostic
- `GET /api/storage` de xem storage path thuc te tren may
- `POST /api/export`, `POST /api/backup`, `POST /api/import`
- extension command de capture current diagnostic vao graph
- nut mo file lien quan va chon related node ngay trong sidebar
- dong bo `activeNodeId` hai chieu giua extension va graph UI qua API
- MCP server va HTTP API dung chung mot SQLite store thay vi file JSON rieng

## Huong nang cap tiep

- Them CRUD tao/sua/xoa node va edges.
- Them `correlationId`, `owner`, `status`, `lastSeenAt`.
- Them embedding/full-text search cho retrieval tot hon.
- Dong bo diagnostics, git diff, terminal log vao graph.
- Dong goi thanh VS Code extension va tool cho Codex/Antigravity.

## Part 3 - Retrieval Layer (Quality-first, token-efficient)

Part 3 bo sung lop truy xuat context theo huong "lay dung, lay gon" de agent/IDE khong can doc lai toan bo graph.

### API retrieval moi

- `GET /api/context-window`
- `GET /api/trace-execution`
- `GET /api/impact-of-change`
- `GET /api/debug-context`

Vi du:

```bash
curl "http://localhost:3010/api/context-window?query=token&limit=8&maxNodes=12"
curl "http://localhost:3010/api/trace-execution?entry=src/auth/index.ts&hops=4"
curl "http://localhost:3010/api/impact-of-change?file=src/auth/token-store.ts&hops=3"
curl "http://localhost:3010/api/debug-context?query=refresh%20token&limit=8&maxNodes=12&hops=3"
```

`/api/debug-context` la payload one-shot cho tac vu debug: top context + trace + impact + recommendedFiles + tokenEstimate.

### CLI retrieval moi

```bash
node graph-cli.js context-window --query token --limit 8 --maxNodes 12
node graph-cli.js trace-execution --entry src/auth/index.ts --hops 4
node graph-cli.js impact-of-change --file src/auth/token-store.ts --hops 3
node graph-cli.js debug-context --query "refresh token" --limit 8 --maxNodes 12 --hops 3
```

### MCP retrieval moi (cho Codex/IDE agents)

- `get_context_window`
- `trace_execution`
- `impact_of_change`
- `debug_context`

Khuyen nghi cho agent flow:

1. Goi `debug_context` truoc de lay payload gon.
2. Chi khi can moi mo them `get_node` hoac source preview.
3. Sau khi sua, ghi `record_edit` / `record_error` / `record_outcome`.
