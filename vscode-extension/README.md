# Graph Memory VS Code Extension

Extension nay ket noi VS Code voi Graph Memory API dang chay local.

## Chuc nang hien co

- Doc file dang mo trong editor
- Lay diagnostics cua file hien tai
- Goi Graph Memory API de `trace` node lien quan
- Hien `contextWindow`, related nodes va diagnostics trong sidebar
- Cho phep ghi quick note vao node vua trace
- Cho phep them `current error` vao graph thanh `debug signal`
- Cho phep mo file lien quan tu node
- Cho phep chon related node trong sidebar
- Dong bo `activeNodeId` voi graph visual UI thong qua API
- Co panel storage voi nut `Export JSON`, `Backup DB`, `Import Replace/Merge`
- Co them nut `Open Exports`, `Open Backups`, danh sach file gan nhat va `Restore Latest`
- Co nut `Start Tracking` va `Stop Tracking` de bat/tat ghi session tay cho workspace hien tai

## Chay thu

1. Chay Graph Memory API trong workspace goc:

```bash
node server.js
```

2. Mo thu muc `vscode-extension` trong VS Code.
3. Nhan `F5` de mo Extension Development Host.
4. Trong host moi, mo workspace project can debug.
5. Mo sidebar `Graph Memory`.
6. Bam `Start Tracking` khi muon Graph Memory bat dau ghi session workspace.

## VSIX

Da dong goi san file:

- `C:\Users\DELL\OneDrive\Desktop\sang kein\Graph\vscode-extension\graph-memory.vsix`

Ban co the cai file nay trong VS Code, Cursor, hoac editor tuong thich VSIX.

## Cau hinh

- `graphMemory.baseUrl`: mac dinh `http://localhost:3010`
- `graphMemory.autoTraceOnEditorChange`: tu dong trace khi doi file/dx diagnostics
- `graphMemory.autoCreateNodeOnMiss`: tu tao node neu file chua co trong graph
- `graphMemory.autoSyncDiagnostics`: tu dong day diagnostic dau tien vao `debugSignals` neu chua ton tai
- `graphMemory.autoTrackWorkspace`: mac dinh `false`, bat len neu muon extension tu start tracking khi mo workspace
- `graphMemory.autoTrackHeartbeatMs`: chu ky heartbeat khi tracking dang bat

## Lenh

- `Graph Memory: Refresh Context`
- `Graph Memory: Trace Active File`
- `Graph Memory: Add Current Error To Graph`
- `Graph Memory: Start Tracking Workspace`
- `Graph Memory: Stop Tracking Workspace`
