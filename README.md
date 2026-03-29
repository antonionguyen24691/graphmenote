# Graph Memory API

Prototype nay cung cap mot lop `graph-memory` dung chung cho UI, VS Code extension, Codex hoac agent runtime.

Huong dan dung theo workflow hang ngay nam tai:

- [USAGE.md](C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\USAGE.md)

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

Dieu nay cho phep VS Code, Codex, Antigravity, CLI va MCP cung doc/ghi vao cung mot kho nho cuc bo tren may.

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
