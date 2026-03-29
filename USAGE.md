# Huong Dan Su Dung Graph Memory

Tai lieu nay mo ta cach dung Graph Memory theo workflow thuc te: luu bo nho debug, theo doi session dang chay, tra cuu lai minh da sua den dau, va cho Codex / VS Code / Antigravity dung chung mot kho nho.

## 1. Khoi dong Graph Memory

Mo terminal tai thu muc project:

```bash
cd "C:\Users\DELL\OneDrive\Desktop\sang kein\Graph"
node server.js
```

Mo giao dien:

- `http://localhost:3010`

Neu browser bao `localhost refused to connect` thi server chua chay.

### Auto-start nen

De Graph Memory API va watcher tu chay cung Windows:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\install-graph-startup.ps1"
```

Sau buoc nay:

- `Graph Memory API` tu len nen
- `Graph Memory Watcher` tu len nen
- watcher tu doc session Codex tu `C:\Users\DELL\.codex\sessions`
- watcher co the tu map Codex thread -> `workspacePath` -> `project node`

## 2. Crawl cac project vao graph

De Graph Memory biet may ban dang co nhung project nao:

```bash
node graph-cli.js crawl-projects "C:\Users\DELL\OneDrive\Desktop\sang kein" 3
```

Hoac trong web app:

1. Mo `Storage Control`
2. Nhap `C:\Users\DELL\OneDrive\Desktop\sang kein`
3. Bam `Run Crawl`

Ket qua:

- Tao `project/workspace nodes`
- Gan quan he cha-con giua cac project long nhau
- Hien trong `Node Registry` va `Memory Graph`

## 3. Cach de project khac tu ghi vao graph

Graph Memory khong the tu doc moi process tren may neu project duoc chay ben ngoai no. Muon no tu ghi session, hay chay project qua wrapper.

Luu y quan trong:

- `node graph-cli.js` va cac wrapper PowerShell gio co local fallback vao SQLite
- Nghia la command van ghi duoc vao Graph ngay ca khi `server.js` chua chay
- Nhung de xem tren web app thi ban van can mo `node server.js`

### Cach 1: goi truc tiep tu bat ky project nao

Dung duong dan tuyet doi toi script wrapper:

```powershell
& "C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\graph-run.ps1" $PWD.Path codex npm run dev
```

Y nghia:

- `$PWD.Path`: workspace hien tai
- `codex`: tool source, co the doi thanh `vscode`, `antigravity`, `cli`
- `npm run dev`: command that su can chay

### Cach 2: dung CLI wrapper goc

Neu dang dung terminal trong repo `Graph`:

```bash
node graph-cli.js run "C:\repo\stock" codex npm run dev
```

### Cach 3: cai lenh toan cuc cho PowerShell

Chay mot lan:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\install-graph-profile.ps1"
```

Mo terminal moi, sau do tu bat ky project nao ban co the goi:

```powershell
grun codex npm run dev
grunat "C:\Users\DELL\OneDrive\Desktop\sang kein\LADING SALE\stock" codex npm run dev
gactivity overview
```

Phan biet:

- `grun`: chay command trong thu muc hien tai
- `grunat`: chay command tai workspacePath chi dinh, dung khi terminal dang dung o thu muc khac

Khi dung mot trong cac wrapper nay, Graph Memory se:

1. Tao `activity run`
2. Danh dau project dang duoc dung
3. Heartbeat dinh ky trong luc command dang chay
4. Ghi lai khi command ket thuc
5. Hien trong panel `Usage Memory`

## 4. Tra cuu “minh dang dung toi dau roi”

### Tren web app

Mo `http://localhost:3010`, xem:

- `Usage Memory`: session dang chay, session gan day, project dang duoc dung
- `Memory Graph`: graph hien tai
- `Node Registry`: danh sach node
- `Context Window`, `Debug Signals`, `Chat History`: context chi tiet cua node dang focus

### Tren CLI

```bash
node graph-cli.js activity-overview
node graph-cli.js activity-runs --status running
node graph-cli.js activity-runs --limit 20
```

Dung de xem:

- co session nao dang chay khong
- project nao vua duoc su dung
- session nao da completed / failed

## 5. Ghi session bang tay neu khong dung wrapper

Neu tool cua ban khong chay qua `graph-cli.js run`, co the goi tay:

### Bat dau session

```bash
node graph-cli.js activity-start "C:\repo\stock" codex Dang debug auth retry
```

### Cap nhat tien do

```bash
node graph-cli.js activity-beat run-abc123 --file src/auth/index.ts --summary Dang trace refresh flow
```

### Ket thuc session

```bash
node graph-cli.js activity-finish run-abc123 --status completed --summary Da fix auth retry --touchedFiles src/auth/index.ts,src/auth/token-store.ts
```

Neu `touchedFiles` duoc truyen, Graph Memory se tao `edit nodes` de luu lai file nao da sua.

Neu session loi, co the ket thuc nhu sau:

```bash
node graph-cli.js activity-finish run-abc123 --status failed --summary Build fail --file src/auth/index.ts --latestError Timeout --location src/auth/index.ts:42
```

Khi du thong tin (`status=failed`, `file`, `location`, `latestError`), Graph Memory co the sinh `error node`.

## 6. Ghi loi, note, chat vao node

### Tim node lien quan theo file / location

```bash
node graph-cli.js trace --file src/auth/token-store.ts
node graph-cli.js trace --location src/auth/token-store.ts:88
```

### Xem node

```bash
node graph-cli.js node auth-service
```

### Them note

```bash
node graph-cli.js note auth-service Can lock refresh token flow
```

### Them debug signal

```bash
node graph-cli.js signal auth-service Timeout src/auth/index.ts:42 Request treo sau khi resume
```

### Them chat

```bash
node graph-cli.js chat auth-service User bao loi xuat hien sau khi tab sleep
```

## 7. Dung voi Codex, VS Code, Antigravity

## Codex

Da co 2 cach:

1. Runtime watcher tu doc Codex session files va tu ghi `activity runs`
2. Plugin local `graph-memory-bridge` dung `mcp-server.js`

Plugin Codex da duoc scaffold tai:

- `C:\Users\DELL\.codex\plugins\graph-memory-bridge`

Marketplace local:

- `C:\Users\DELL\.agents\plugins\marketplace.json`

Plugin nay tro toi:

- `C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\mcp-server.js`

Flow de agent debug dung:

1. Lay file dang loi
2. Goi `traceNode({ file, location, query })`
3. Lay node
4. Nap `contextWindow`, `debugSignals`, `chatHistory`
5. Sau khi xong, goi `addNote()` hoac `finishActivity()`

## VS Code

Da co scaffold extension trong thu muc:

- `vscode-extension`

Da dong goi san VSIX:

- `C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\vscode-extension\graph-memory.vsix`

Co the dung extension de:

- trace file dang mo
- capture diagnostics
- ghi note / debug signal
- dong bo `activeNodeId`
- bam `Start Tracking` / `Stop Tracking` de bat tat session ghi tay

## Antigravity

Neu Antigravity ho tro HTTP tool hoac MCP tool, chi can cho no goi:

- `start_activity`
- `heartbeat_activity`
- `finish_activity`
- `trace_node`
- `get_node`
- `add_note`

Neu Antigravity ho tro cai VSIX-compatible extensions, co the thu cai file:

- `C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\vscode-extension\graph-memory.vsix`

## 8. Workflow khuyen nghi moi ngay

### Truoc khi lam viec

1. Chay `node server.js`
2. Mo `http://localhost:3010`
3. Kiem tra `Usage Memory`

### Khi vao mot project moi

1. Crawl project neu chua co
2. Chay project qua:

```bash
node graph-cli.js run "C:\repo\stock" codex npm run dev
```

### Khi gap bug

1. `trace` theo file / location
2. Mo node lien quan
3. Ghi `signal` / `note`
4. Neu dang lam qua wrapper, session se tu dong duoc theo doi

### Khi sua xong

1. `activity-finish` voi `touchedFiles`
2. Them note tong ket
3. Kiem tra trong graph da co `edit nodes`

## 9. Backup / Export / Import

### Backup DB

```bash
node graph-cli.js backup
```

### Export JSON

```bash
node graph-cli.js export
```

### Import lai

```bash
node graph-cli.js import "C:\Users\DELL\.graph-memory\exports\graph-export-....json" merge
```

### Restore backup moi nhat

```bash
node graph-cli.js restore-latest-backup
```

## 10. Neu ban khong thay data moi trong app

1. Kiem tra server con chay khong
2. Refresh trang bang `Ctrl + F5`
3. Kiem tra command co di qua `graph-cli.js run` hoac `activity API` khong
4. Chay:

```bash
node graph-cli.js activity-overview
```

Neu overview khong thay session, nghia la project dang chay ben ngoai Graph Memory.

## 11. Muc tieu dung cua he thong nay

Graph Memory duoc thiet ke de tra loi nhanh 4 cau hoi:

1. Project nao / app nao dang duoc dung?
2. Session dang chay la gi?
3. Loi phat sinh o file nao, node nao?
4. Da sua o dau va da luu tri thuc debug chua?

Neu workflow cua ban di qua wrapper, API, MCP hoac extension, thi Graph Memory se dan tro thanh bo nho chung thay vi phai doc lai toan bo context moi lan.
