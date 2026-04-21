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

## 12. Part 3 Retrieval (uu tien chat luong + giam token)

Part 3 bo sung bo truy xuat moi de Codex/VS Code/Antigravity co the lay context cuc gon thay vi doc full graph.

### HTTP API

```bash
curl "http://localhost:3010/api/context-window?query=token&limit=8&maxNodes=12"
curl "http://localhost:3010/api/trace-execution?entry=src/auth/index.ts&hops=4"
curl "http://localhost:3010/api/impact-of-change?file=src/auth/token-store.ts&hops=3"
curl "http://localhost:3010/api/debug-context?query=refresh%20token&limit=8&maxNodes=12&hops=3"
```

### CLI

```bash
node graph-cli.js context-window --query token --limit 8 --maxNodes 12
node graph-cli.js trace-execution --entry src/auth/index.ts --hops 4
node graph-cli.js impact-of-change --file src/auth/token-store.ts --hops 3
node graph-cli.js debug-context --query "refresh token" --limit 8 --maxNodes 12 --hops 3
```

### MCP tools

- `get_context_window`
- `trace_execution`
- `impact_of_change`
- `debug_context`

### Flow khuyen nghi cho agent

1. Goi `debug_context` dau tien de lay top context + trace + impact + recommendedFiles.
2. Neu can dao sau moi goi them `get_node` hoac source preview.
3. Sau khi fix, bat buoc ghi lai bang `record_edit`/`record_error` va `record_outcome`.

## 13. Obsidian vault ngoai repo

Dat vault root:

```bash
node graph-cli.js vault-set "C:\Users\DELL\KnowledgeVault"
```

Scaffold cau truc vault:

```bash
node graph-cli.js vault-scaffold "C:\Users\DELL\KnowledgeVault"
```

Kiem tra config:

```bash
node graph-cli.js vault-config
```

Vault nay dung cho:

- `raw/`: nguon goc
- `projects/`: tong hop tung du an
- `modules/`: module cards de tai su dung
- `concepts/`, `sources/`, `analyses/`
- `index.md`, `log.md`

## 14. Module reuse memory

Dang ky tay mot module reusable:

```bash
node graph-cli.js module-register "C:\repo\stock" "C:\repo\stock\src\ocr" ocr OCR Module
```

Harvest tu dong module candidates trong du an:

```bash
node graph-cli.js module-harvest "C:\repo\stock" --maxDepth 5 --maxFiles 300
```

Tim module co the tai dung:

```bash
node graph-cli.js modules --capability ocr --workspacePath "C:\repo\new-app"
node graph-cli.js modules --query map --workspacePath "C:\repo\new-app"
```

MCP tool tuong ung:

- `find_reusable_modules`
- `register_reusable_module`
- `harvest_reusable_modules`

## 15. Low-token flow cho IDE/CLI

Khi vao mot project moi, uu tien lay bootstrap payload gon:

```bash
node graph-cli.js low-token-context --workspacePath "C:\repo\stock" --query ocr
```

Payload nay duoc thiet ke de agent:

1. doc project brief truoc
2. check reusable module candidates truoc
3. chi mo recommended files khi can
4. tranh doc full repo va giam token

MCP tool:

- `low_token_context`

## 16. Brain context + skill import tu Git

Dung `brain-context` khi muon Graph Memory hoat dong nhu mot "bo nao" cho IDE/CLI:

```bash
node graph-cli.js brain-context --workspacePath "C:\repo\stock" --query ocr
```

Payload nay gom:

- implementation thread dang can resume
- brain skills phu hop
- reusable module candidates
- verification/adoption memory
- recommended files de tranh doc full repo

### Cai hoac update skill tu Git

```bash
node graph-cli.js brain-skill-update https://github.com/org/repo.git --subdir skills/ocr --ref main --name "OCR Skill"
```

Lenh nay se:

1. clone hoac pull repo vao `KnowledgeVault\skills\_git`
2. doc `skill.json`, `SKILL.md`, `README.md`, `package.json`
3. index capability/tag/usage vao SQLite
4. tao node `skill` trong graph de retrieval dung duoc
5. dua skill vao `brain-context`

### Dang ky skill local

```bash
node graph-cli.js brain-skill-register "C:\skills\my-skill" --name "My Skill"
```

### Tra cuu skill

```bash
node graph-cli.js brain-skills --query testing
node graph-cli.js brain-skill skill-abc123
```

MCP tools tuong ung:

- `brain_context`
- `list_brain_skills`
- `register_local_brain_skill`
- `update_brain_skill_from_git`

## 17. Local AI model + Harness

Graph Memory co gateway cho local AI model va model harness. Cac provider mac dinh:

- Ollama: `http://localhost:11434/v1`
- llama.cpp server: `http://localhost:8080/v1`
- vLLM: `http://localhost:8000/v1`

Xem provider:

```bash
node graph-cli.js ai-providers
```

Dang ky provider moi, gom ca Harness/OpenAI-compatible adapter:

```bash
node graph-cli.js ai-provider-add harness http://localhost:9000/v1 --name "Local Harness" --model local-model --capabilities chat,harness,evaluation
node graph-cli.js ai-provider-add ollama http://localhost:11434/v1 --model qwen2.5-coder --capabilities chat,json,harness
```

Kiem tra model endpoint:

```bash
node graph-cli.js ai-healthcheck --provider provider-ollama-local
node graph-cli.js ai-doctor --timeoutMs 1200
node graph-cli.js ai-pick --purpose coding --checkHealth false
```

Chat noi bo co chen compact memory cua workspace:

```bash
node graph-cli.js ai-chat --provider provider-ollama-local --model qwen2.5-coder --workspacePath "C:\repo\stock" --query "Tom tat viec dang lam va buoc tiep theo"
```

Chay harness nhe de luu chat/latency/contract memory:

```bash
node graph-cli.js ai-harness-run --provider provider-ollama-local --suite harness
node graph-cli.js ai-model-runs --limit 10
```

MCP tools tuong ung:

- `list_ai_providers`
- `register_ai_provider`
- `healthcheck_ai_provider`
- `chat_with_ai_provider`
- `run_ai_harness`
- `list_ai_model_runs`
- `ai_setup_doctor`
- `pick_ai_runtime`

Built-in harness dung cho smoke test nhanh, JSON contract va latency. Neu can benchmark chuan nhu EleutherAI `lm-evaluation-harness`, dung provider `harness` hoac adapter OpenAI-compatible; Graph Memory se luu metadata/hint de agent sau biet nen chay benchmark ngoai nhu the nao.

## 18. Runtime profile + chat noi bo theo workspace

Runtime profile giup cac IDE/CLI dung chung quy tac chon model:

```bash
node graph-cli.js ai-profiles
node graph-cli.js ai-profile-upsert --id profile-local-crawl --name "Local Crawl" --purpose crawl --provider provider-ollama-local --model qwen2.5-coder --contextPolicy low-token
```

Chat noi bo luu theo workspace:

```bash
node graph-cli.js ai-chat-start --workspacePath "C:\repo\stock" --title "OCR rollout" --profile profile-local-coding
node graph-cli.js ai-chat-send --threadId ai-chat-abc --message "Dang dung o dau va nen sua file nao truoc?"
node graph-cli.js ai-chat-send --workspacePath "C:\repo\stock" --purpose coding --autoPick true --message "Nen bat dau file nao?"
node graph-cli.js ai-chat-threads --workspacePath "C:\repo\stock"
node graph-cli.js ai-chat-thread ai-chat-abc --limit 20
```

Y nghia:

1. `profile` quy dinh provider/model/context policy.
2. `thread` luu hoi dap noi bo theo repo.
3. Moi lan goi model tao `ai_model_runs` de lan sau biet model nao fail, model nao cham, model nao dang dung.
4. IDE/CLI khac chi can list thread theo `workspacePath` de tiep tuc tu dung diem dung truoc.

MCP tools:

- `list_ai_runtime_profiles`
- `upsert_ai_runtime_profile`
- `list_ai_chat_threads`
- `send_ai_chat_message`
