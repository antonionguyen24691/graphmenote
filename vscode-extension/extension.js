const path = require("node:path");
const vscode = require("vscode");

let activeProvider = null;

function activate(context) {
  const provider = new GraphMemoryViewProvider(context.extensionUri);
  activeProvider = provider;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("graphMemory.sidebar", provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("graphMemory.refresh", () => provider.refreshFromEditor()),
    vscode.commands.registerCommand("graphMemory.traceActiveFile", () => provider.refreshFromEditor(true)),
    vscode.commands.registerCommand("graphMemory.captureDiagnostic", () => provider.captureCurrentDiagnostic()),
    vscode.commands.registerCommand("graphMemory.startTracking", () => provider.startManualTracking()),
    vscode.commands.registerCommand("graphMemory.stopTracking", () => provider.stopManualTracking())
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (getSetting("autoTraceOnEditorChange", true)) {
        provider.refreshFromEditor();
      }
      provider.pushWorkspaceHeartbeat();
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      if (getSetting("autoTraceOnEditorChange", true)) {
        provider.refreshFromEditor();
      }
      provider.pushWorkspaceHeartbeat();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      if (getSetting("autoTraceOnEditorChange", true)) {
        provider.refreshFromEditor();
      }
      provider.pushWorkspaceHeartbeat();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.handleWorkspaceChange();
    }),
    new vscode.Disposable(() => {
      provider.dispose();
    })
  );

  provider.handleWorkspaceChange();
}

function deactivate() {
  if (activeProvider) {
    activeProvider.dispose();
    activeProvider = null;
  }
}

class GraphMemoryViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = undefined;
    this.activityRunId = null;
    this.activityWorkspacePath = null;
    this.heartbeatTimer = null;
    this.state = {
      status: "idle",
      message: "Mo mot file trong workspace de trace context.",
      editor: null,
      trace: null,
      node: null,
      diagnostics: [],
      storage: null,
    };
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "refresh") {
        await this.refreshFromEditor(true);
      }

      if (message.type === "addNote" && message.note) {
        await this.addNote(message.note);
      }

      if (message.type === "selectNode" && message.nodeId) {
        await this.selectNode(message.nodeId);
      }

      if (message.type === "openFile" && message.file) {
        await this.openRelatedFile(message.file);
      }

      if (message.type === "captureDiagnostic") {
        await this.captureCurrentDiagnostic();
      }

      if (message.type === "exportGraph") {
        await this.exportGraph();
      }

      if (message.type === "backupGraph") {
        await this.backupGraph();
      }

      if (message.type === "importGraph" && message.sourcePath) {
        await this.importGraph(message.sourcePath, message.mode || "replace");
      }

      if (message.type === "openFolder" && message.kind) {
        await this.openFolder(message.kind);
      }

      if (message.type === "restoreLatestBackup") {
        await this.restoreLatestBackup();
      }

      if (message.type === "crawlProjects" && message.rootPath) {
        await this.crawlProjects(message.rootPath, message.maxDepth || 3);
      }

      if (message.type === "startTracking") {
        await this.startManualTracking();
      }

      if (message.type === "stopTracking") {
        await this.stopManualTracking();
      }
    });

    this.postState();
    this.refreshFromEditor();
    this.handleWorkspaceChange();
  }

  async refreshFromEditor(showErrors = false) {
    const editor = getBestAvailableEditor();

    if (!editor) {
      const tabContext = getActiveTabContext();
      this.state = {
        ...this.state,
        status: tabContext ? "empty" : "idle",
        message: tabContext
          ? "Co file tab dang mo nhung Antigravity khong expose thanh text editor. Graph Memory da fallback sang tab metadata."
          : "Chua co editor nao dang mo.",
        editor: tabContext,
        trace: null,
        node: null,
        diagnostics: [],
        storage: await this.tryGetStorageInfo(),
      };
      if (tabContext) {
        try {
          const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
          if (getSetting("autoTrackWorkspace", false) || this.activityRunId) {
            await this.ensureWorkspaceActivity(api, tabContext.workspacePath);
          }
          let trace = await api.trace(tabContext);
          let topNode = trace.results[0] ? await api.getNode(trace.results[0].id) : null;
          if (!topNode && getSetting("autoCreateNodeOnMiss", true)) {
            topNode = await api.upsertFromTrace({
              file: tabContext.relativePath,
              location: tabContext.location,
              symptom: tabContext.query || `Auto-created from ${tabContext.relativePath}`,
              title: "Captured Tab Context",
              severity: "medium",
              summary: `Auto-created from active tab for ${tabContext.relativePath}.`,
            });
            trace = await api.trace(tabContext);
          }
          if (topNode) {
            await api.setActiveNode(topNode.id);
          }
          this.state = {
            ...this.state,
            status: topNode ? "ready" : "empty",
            message: topNode
              ? "Da trace duoc context tu active tab trong Antigravity."
              : this.state.message,
            trace,
            node: topNode,
            storage: await api.getStorageInfo(),
          };
          await this.pushWorkspaceHeartbeat(tabContext, api);
        } catch (error) {
          this.state = {
            ...this.state,
            status: "error",
            message: `Khong the ket noi Graph Memory API: ${error.message}`,
          };
        }
      }
      this.postState();
      return;
    }

    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const editorContext = getEditorContext(editor);
      if (getSetting("autoTrackWorkspace", false) || this.activityRunId) {
        await this.ensureWorkspaceActivity(api, editorContext.workspacePath);
      }
      let trace = await api.trace(editorContext);
      let topNode = trace.results[0] ? await api.getNode(trace.results[0].id) : null;

      if (!topNode && getSetting("autoCreateNodeOnMiss", true)) {
        topNode = await api.upsertFromTrace({
          file: editorContext.relativePath,
          location: editorContext.location,
          symptom: editorContext.query || `Auto-created from ${editorContext.relativePath}`,
          title: "Captured Diagnostic",
          severity: editorContext.diagnostics[0]?.severity === "error" ? "high" : "medium",
          summary: `Auto-created from active editor for ${editorContext.relativePath}.`,
        });
        trace = await api.trace(editorContext);
      }

      if (topNode) {
        await api.setActiveNode(topNode.id);
        if (getSetting("autoSyncDiagnostics", true)) {
          await this.syncDiagnostics(api, topNode, editorContext);
          topNode = await api.getNode(topNode.id);
          trace = await api.trace(editorContext);
        }
      }

      this.state = {
        status: topNode ? "ready" : "empty",
        message: topNode
          ? "Da tim thay context node gan nhat tu file/diagnostic hien tai."
          : "Khong tim thay node phu hop. Thu them file vao graph-data.json hoac debug signal.",
        editor: editorContext,
        trace,
        node: topNode,
        diagnostics: editorContext.diagnostics,
        storage: await api.getStorageInfo(),
      };

      this.postState();
      await this.pushWorkspaceHeartbeat(editorContext, api);
    } catch (error) {
      this.state = {
        ...this.state,
        status: "error",
        message: `Khong the ket noi Graph Memory API: ${error.message}`,
      };
      this.postState();

      if (showErrors) {
        vscode.window.showErrorMessage(this.state.message);
      }
    }
  }

  async addNote(note) {
    if (!this.state.node) {
      vscode.window.showWarningMessage("Chua co node dang active de ghi note.");
      return;
    }

    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      await api.addNote(this.state.node.id, note);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the ghi note vao Graph Memory: ${error.message}`);
    }
  }

  async exportGraph() {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const result = await api.exportGraph();
      vscode.window.showInformationMessage(`Graph exported: ${result.exportPath}`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the export graph: ${error.message}`);
    }
  }

  async backupGraph() {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const result = await api.backupGraph();
      vscode.window.showInformationMessage(`DB backup created: ${result.backupPath}`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the backup graph: ${error.message}`);
    }
  }

  async importGraph(sourcePath, mode) {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const result = await api.importGraph(sourcePath, mode);
      vscode.window.showInformationMessage(`Graph imported: ${result.importPath}`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the import graph: ${error.message}`);
    }
  }

  async openFolder(kind) {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const result = await api.openFolder(kind);
      vscode.window.showInformationMessage(`Opened folder: ${result.openedPath}`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the open folder: ${error.message}`);
    }
  }

  async restoreLatestBackup() {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const result = await api.restoreLatestBackup();
      vscode.window.showInformationMessage(`Restored latest backup: ${result.restoredFrom}`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the restore latest backup: ${error.message}`);
    }
  }

  async crawlProjects(rootPath, maxDepth) {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const result = await api.crawlProjects(rootPath, maxDepth);
      vscode.window.showInformationMessage(`Crawled ${result.added} new / ${result.updated} updated project nodes.`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the crawl projects: ${error.message}`);
    }
  }

  async selectNode(nodeId) {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      await api.setActiveNode(nodeId);
      const node = await api.getNode(nodeId);
      this.state = {
        ...this.state,
        status: "ready",
        message: `Dang xem node ${node.name}.`,
        node,
      };
      this.postState();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the chon node: ${error.message}`);
    }
  }

  async openRelatedFile(relativeFile) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      vscode.window.showWarningMessage("Chua co workspace folder de mo file.");
      return;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, ...relativeFile.split("/"));

    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the mo file ${relativeFile}: ${error.message}`);
    }
  }

  async captureCurrentDiagnostic() {
    const editor = getBestAvailableEditor();

    if (!editor) {
      vscode.window.showWarningMessage("Chua co file dang mo.");
      return;
    }

    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const editorContext = getEditorContext(editor);
      const trace = await api.trace(editorContext);
      const targetNode =
        trace.results[0]
          ? await api.getNode(trace.results[0].id)
          : await api.upsertFromTrace({
              file: editorContext.relativePath,
              location: editorContext.location,
              symptom: editorContext.query || `Auto-created from ${editorContext.relativePath}`,
              title: "Captured Diagnostic",
              severity: editorContext.diagnostics[0]?.severity === "error" ? "high" : "medium",
              summary: `Auto-created from active editor for ${editorContext.relativePath}.`,
            });
      const targetId = targetNode?.id;

      if (!targetId) {
        vscode.window.showWarningMessage("Khong tim thay node de luu loi hien tai.");
        return;
      }

      const diagnostic = editorContext.diagnostics[0] || {
        message: `Manual capture from ${editorContext.relativePath}`,
        location: `${editorContext.relativePath}:${editorContext.line}`,
        severity: "info",
      };

      await api.addDebugSignal(targetId, {
        title: diagnostic.severity === "error" ? "Captured Error" : "Captured Diagnostic",
        location: diagnostic.location,
        symptom: diagnostic.message,
      });
      await api.addNote(
        targetId,
        `Captured diagnostic from VS Code at ${diagnostic.location}: ${diagnostic.message}`
      );
      await this.refreshFromEditor();
      vscode.window.showInformationMessage("Da them current error vao Graph Memory.");
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the luu current error: ${error.message}`);
    }
  }

  postState() {
    if (!this.view) {
      return;
    }

    this.view.webview.postMessage({
      type: "state",
      payload: this.state,
    });
  }

  async tryGetStorageInfo() {
    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      return await api.getStorageInfo();
    } catch {
      return null;
    }
  }

  async handleWorkspaceChange() {
    const workspacePath = getPrimaryWorkspacePath();

    if (!getSetting("autoTrackWorkspace", false)) {
      await this.stopWorkspaceActivity("completed", "Workspace tracking disabled.");
      return;
    }

    if (!workspacePath) {
      await this.stopWorkspaceActivity("completed", "Workspace closed.");
      return;
    }

    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      await this.ensureWorkspaceActivity(api, workspacePath);
      await this.pushWorkspaceHeartbeat(null, api);
    } catch {}
  }

  async ensureWorkspaceActivity(api, workspacePath) {
    const targetWorkspacePath = workspacePath || getPrimaryWorkspacePath();

    if (!targetWorkspacePath) {
      return null;
    }

    if (this.activityRunId && this.activityWorkspacePath === targetWorkspacePath) {
      this.ensureHeartbeatTimer();
      return this.activityRunId;
    }

    if (this.activityRunId && this.activityWorkspacePath !== targetWorkspacePath) {
      await this.stopWorkspaceActivity("completed", "Workspace changed.");
    }

    const run = await api.startActivity({
      workspacePath: targetWorkspacePath,
      toolSource: "vscode",
      summary: `VS Code workspace active: ${path.basename(targetWorkspacePath)}`,
      metadata: {
        detectedBy: "vscode-extension",
      },
    });

    this.activityRunId = run.id;
    this.activityWorkspacePath = targetWorkspacePath;
    this.ensureHeartbeatTimer();
    return this.activityRunId;
  }

  ensureHeartbeatTimer() {
    if (this.heartbeatTimer) {
      return;
    }

    const intervalMs = Math.max(10000, Number(getSetting("autoTrackHeartbeatMs", 30000)));
    this.heartbeatTimer = setInterval(() => {
      this.pushWorkspaceHeartbeat().catch(() => {});
    }, intervalMs);
  }

  async pushWorkspaceHeartbeat(editorContext = null, api = null) {
    if (!this.activityRunId) {
      return;
    }

    const client = api || new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
    const context = editorContext || getActiveEditorContext();

    await client.heartbeatActivity(this.activityRunId, {
      summary: context?.relativePath
        ? `VS Code active in ${context.relativePath}`
        : `VS Code workspace active: ${path.basename(this.activityWorkspacePath || "")}`,
      currentFile: context?.relativePath || null,
      latestError: context?.diagnostics?.[0]?.message || null,
      metadata: {
        detectedBy: "vscode-extension",
        line: context?.line || null,
        diagnosticsCount: context?.diagnostics?.length || 0,
      },
    });
  }

  async stopWorkspaceActivity(status = "completed", summary = "VS Code workspace closed.") {
    if (!this.activityRunId) {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.activityWorkspacePath = null;
      return;
    }

    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      const context = getActiveEditorContext();
      await api.finishActivity(this.activityRunId, {
        status,
        summary,
        currentFile: context?.relativePath || null,
        latestError: context?.diagnostics?.[0]?.message || null,
      });
    } catch {}

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.activityRunId = null;
    this.activityWorkspacePath = null;
  }

  async startManualTracking() {
    const workspacePath = getPrimaryWorkspacePath();
    if (!workspacePath) {
      vscode.window.showWarningMessage("Chua co workspace nao dang mo de start tracking.");
      return;
    }

    try {
      const api = new GraphMemoryApi(getSetting("baseUrl", "http://localhost:3010"));
      await this.ensureWorkspaceActivity(api, workspacePath);
      await this.pushWorkspaceHeartbeat(null, api);
      vscode.window.showInformationMessage(`Graph Memory tracking started for ${path.basename(workspacePath)}.`);
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the start tracking: ${error.message}`);
    }
  }

  async stopManualTracking() {
    try {
      await this.stopWorkspaceActivity("completed", "Tracking stopped manually from VS Code.");
      vscode.window.showInformationMessage("Graph Memory tracking stopped.");
      await this.refreshFromEditor();
    } catch (error) {
      vscode.window.showErrorMessage(`Khong the stop tracking: ${error.message}`);
    }
  }

  dispose() {
    this.stopWorkspaceActivity("completed", "VS Code extension deactivated.");
  }

  renderHtml(webview) {
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px;
    }
    .panel {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, white 12%);
    }
    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .pill {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    button {
      border: none;
      border-radius: 8px;
      padding: 8px 10px;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    textarea {
      width: 100%;
      min-height: 72px;
      margin-top: 8px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 8px;
      padding: 8px;
    }
    ul {
      padding-left: 18px;
      margin: 8px 0 0;
    }
    li {
      margin-bottom: 6px;
    }
    code {
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="title">Graph Memory</div>
    <div id="status" class="muted">Dang tai...</div>
    <div class="row">
      <button id="refreshButton">Refresh Context</button>
    </div>
  </div>
  <div id="content"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const content = document.getElementById("content");
    const status = document.getElementById("status");
    const refreshButton = document.getElementById("refreshButton");

    refreshButton.addEventListener("click", () => {
      vscode.postMessage({ type: "refresh" });
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type !== "state") {
        return;
      }

      render(message.payload);
    });

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function render(state) {
      status.textContent = state.message;

      const editor = state.editor
        ? \`<div class="panel">
            <div class="title">\${escapeHtml(state.editor.relativePath || state.editor.fileName)}</div>
            <div class="muted">Workspace file dang mo</div>
            <div class="row">
              <span class="pill">line \${state.editor.line}</span>
              <span class="pill">\${state.diagnostics.length} diagnostics</span>
            </div>
          </div>\`
        : "";

      const storage = state.storage
        ? \`<div class="panel">
            <div class="title">Storage</div>
            <div class="muted"><code>\${escapeHtml(state.storage.dbPath)}</code></div>
            <div class="row">
              <span class="pill">\${state.storage.nodeCount} nodes</span>
              <span class="pill">active \${escapeHtml(state.storage.activeNodeId || "-")}</span>
            </div>
            <div class="row">
              <button id="startTracking">Start Tracking</button>
              <button id="stopTracking">Stop Tracking</button>
              <button id="crawlProjects">Crawl Projects</button>
              <button id="openExports">Open Exports</button>
              <button id="openBackups">Open Backups</button>
              <button id="exportGraph">Export JSON</button>
              <button id="backupGraph">Backup DB</button>
              <button id="restoreLatestBackup">Restore Latest</button>
            </div>
            <textarea id="crawlRootInput" placeholder="C:\\\\Users\\\\DELL\\\\OneDrive\\\\Desktop\\\\sang kein"></textarea>
            <div class="row">
              <button data-crawl-depth="2" id="crawlDepth2">Crawl Depth 2</button>
              <button data-crawl-depth="3" id="crawlDepth3">Crawl Depth 3</button>
            </div>
            <textarea id="importPathInput" placeholder="C:\\\\Users\\\\DELL\\\\.graph-memory\\\\exports\\\\graph-export.json"></textarea>
            <div class="row">
              <button data-import-mode="replace" id="importReplace">Import Replace</button>
              <button data-import-mode="merge" id="importMerge">Import Merge</button>
            </div>
            <div class="muted">Recent exports</div>
            <ul>
              \${(state.storage.recentExports || []).map((item) => \`<li><code>\${escapeHtml(item.name)}</code><br><span class="muted">\${escapeHtml(item.path)}</span></li>\`).join("") || "<li>Chua co export nao.</li>"}
            </ul>
            <div class="muted">Recent backups</div>
            <ul>
              \${(state.storage.recentBackups || []).map((item) => \`<li><code>\${escapeHtml(item.name)}</code><br><span class="muted">\${escapeHtml(item.path)}</span></li>\`).join("") || "<li>Chua co backup nao.</li>"}
            </ul>
          </div>\`
        : "";

      const node = state.node
        ? \`<div class="panel">
            <div class="title">\${escapeHtml(state.node.name)}</div>
            <div class="muted">\${escapeHtml(state.node.summary)}</div>
            <div class="row">
              <span class="pill">\${escapeHtml(state.node.type)}</span>
              <span class="pill">\${escapeHtml(state.node.severity)}</span>
              <span class="pill">\${state.node.openIssues} issues</span>
            </div>
            <ul>
              \${state.node.files.map((file) => \`<li><button data-open-file="\${escapeHtml(file)}">Open <code>\${escapeHtml(file)}</code></button></li>\`).join("")}
            </ul>
            <ul>
              \${state.node.contextWindow.map((item) => \`<li><strong>\${escapeHtml(item.label)}:</strong> \${escapeHtml(item.detail)}</li>\`).join("")}
            </ul>
          </div>\`
        : "";

      const diagnostics = state.diagnostics?.length
        ? \`<div class="panel">
            <div class="title">Diagnostics</div>
            <ul>
              \${state.diagnostics.map((item) => \`<li><code>\${escapeHtml(item.location)}</code> - \${escapeHtml(item.message)}</li>\`).join("")}
            </ul>
          </div>\`
        : "";

      const trace = state.trace?.results?.length
        ? \`<div class="panel">
            <div class="title">Related Nodes</div>
            <ul>
              \${state.trace.results.map((item) => \`<li><button data-node-id="\${escapeHtml(item.id)}">\${escapeHtml(item.name)}</button> · \${escapeHtml(item.severity)} · \${item.files.map((file) => \`<code>\${escapeHtml(file)}</code>\`).join(", ")}</li>\`).join("")}
            </ul>
          </div>\`
        : "";

      const notes = state.node
        ? \`<div class="panel">
            <div class="title">Quick Note</div>
            <textarea id="noteInput" placeholder="Ghi lai phat hien moi sau khi debug..."></textarea>
            <div class="row">
              <button id="saveNote">Save Note</button>
              <button id="captureDiagnostic">Add Current Error</button>
            </div>
          </div>\`
        : "";

      content.innerHTML = storage + editor + node + diagnostics + trace + notes;

      const saveNoteButton = document.getElementById("saveNote");
      const noteInput = document.getElementById("noteInput");

      if (saveNoteButton && noteInput) {
        saveNoteButton.addEventListener("click", () => {
          if (!noteInput.value.trim()) {
            return;
          }

          vscode.postMessage({
            type: "addNote",
            note: noteInput.value.trim(),
          });
          noteInput.value = "";
        });
      }

      document.querySelectorAll("[data-node-id]").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({
            type: "selectNode",
            nodeId: button.getAttribute("data-node-id"),
          });
        });
      });

      document.querySelectorAll("[data-open-file]").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({
            type: "openFile",
            file: button.getAttribute("data-open-file"),
          });
        });
      });

      const captureDiagnosticButton = document.getElementById("captureDiagnostic");
      if (captureDiagnosticButton) {
        captureDiagnosticButton.addEventListener("click", () => {
          vscode.postMessage({ type: "captureDiagnostic" });
        });
      }

      const exportGraphButton = document.getElementById("exportGraph");
      if (exportGraphButton) {
        exportGraphButton.addEventListener("click", () => {
          vscode.postMessage({ type: "exportGraph" });
        });
      }

      const backupGraphButton = document.getElementById("backupGraph");
      if (backupGraphButton) {
        backupGraphButton.addEventListener("click", () => {
          vscode.postMessage({ type: "backupGraph" });
        });
      }

      const openExportsButton = document.getElementById("openExports");
      if (openExportsButton) {
        openExportsButton.addEventListener("click", () => {
          vscode.postMessage({ type: "openFolder", kind: "exports" });
        });
      }

      const openBackupsButton = document.getElementById("openBackups");
      if (openBackupsButton) {
        openBackupsButton.addEventListener("click", () => {
          vscode.postMessage({ type: "openFolder", kind: "backups" });
        });
      }

      const restoreLatestBackupButton = document.getElementById("restoreLatestBackup");
      if (restoreLatestBackupButton) {
        restoreLatestBackupButton.addEventListener("click", () => {
          vscode.postMessage({ type: "restoreLatestBackup" });
        });
      }

      const startTrackingButton = document.getElementById("startTracking");
      if (startTrackingButton) {
        startTrackingButton.addEventListener("click", () => {
          vscode.postMessage({ type: "startTracking" });
        });
      }

      const stopTrackingButton = document.getElementById("stopTracking");
      if (stopTrackingButton) {
        stopTrackingButton.addEventListener("click", () => {
          vscode.postMessage({ type: "stopTracking" });
        });
      }

      const crawlProjectsButton = document.getElementById("crawlProjects");
      const crawlRootInput = document.getElementById("crawlRootInput");
      const crawlButtons = [document.getElementById("crawlDepth2"), document.getElementById("crawlDepth3")];

      if (crawlProjectsButton && crawlRootInput) {
        crawlProjectsButton.addEventListener("click", () => {
          const rootPath = crawlRootInput.value.trim() || "C:\\\\Users\\\\DELL\\\\OneDrive\\\\Desktop\\\\sang kein";
          vscode.postMessage({ type: "crawlProjects", rootPath, maxDepth: 3 });
        });
      }

      crawlButtons.forEach((button) => {
        if (!button || !crawlRootInput) {
          return;
        }

        button.addEventListener("click", () => {
          const rootPath = crawlRootInput.value.trim() || "C:\\\\Users\\\\DELL\\\\OneDrive\\\\Desktop\\\\sang kein";
          vscode.postMessage({
            type: "crawlProjects",
            rootPath,
            maxDepth: Number(button.getAttribute("data-crawl-depth")),
          });
        });
      });

      const importPathInput = document.getElementById("importPathInput");
      const importReplaceButton = document.getElementById("importReplace");
      const importMergeButton = document.getElementById("importMerge");

      [importReplaceButton, importMergeButton].forEach((button) => {
        if (!button || !importPathInput) {
          return;
        }

        button.addEventListener("click", () => {
          if (!importPathInput.value.trim()) {
            return;
          }

          vscode.postMessage({
            type: "importGraph",
            sourcePath: importPathInput.value.trim(),
            mode: button.getAttribute("data-import-mode"),
          });
          importPathInput.value = "";
        });
      });
    }
  </script>
</body>
</html>`;
  }
}

class GraphMemoryApi {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async trace({ relativePath, fileName, location, query }) {
    const params = new URLSearchParams();

    if (relativePath) {
      params.set("file", relativePath);
    } else if (fileName) {
      params.set("file", fileName);
    }

    if (location) {
      params.set("location", location);
    }

    if (query) {
      params.set("query", query);
    }

    return this.request(`/api/trace?${params.toString()}`);
  }

  async getNode(nodeId) {
    return this.request(`/api/nodes/${encodeURIComponent(nodeId)}`);
  }

  async getStorageInfo() {
    return this.request("/api/storage");
  }

  async setActiveNode(nodeId) {
    return this.request("/api/active-node", {
      method: "POST",
      body: JSON.stringify({
        nodeId,
      }),
    });
  }

  async addNote(nodeId, note) {
    return this.request(`/api/nodes/${encodeURIComponent(nodeId)}/notes`, {
      method: "POST",
      body: JSON.stringify({
        note,
        role: "assistant",
      }),
    });
  }

  async addDebugSignal(nodeId, signal) {
    return this.request(`/api/nodes/${encodeURIComponent(nodeId)}/debug-signals`, {
      method: "POST",
      body: JSON.stringify(signal),
    });
  }

  async startActivity(payload) {
    return this.request("/api/activity/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async heartbeatActivity(runId, payload) {
    return this.request("/api/activity/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        runId,
        ...payload,
      }),
    });
  }

  async finishActivity(runId, payload) {
    return this.request("/api/activity/finish", {
      method: "POST",
      body: JSON.stringify({
        runId,
        ...payload,
      }),
    });
  }

  async exportGraph() {
    return this.request("/api/export", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async backupGraph() {
    return this.request("/api/backup", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async importGraph(sourcePath, mode) {
    return this.request("/api/import", {
      method: "POST",
      body: JSON.stringify({ sourcePath, mode }),
    });
  }

  async openFolder(kind) {
    return this.request("/api/open-folder", {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
  }

  async restoreLatestBackup() {
    return this.request("/api/restore-latest-backup", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async crawlProjects(rootPath, maxDepth) {
    return this.request("/api/crawl-projects", {
      method: "POST",
      body: JSON.stringify({ rootPath, maxDepth }),
    });
  }

  async request(route, init = {}) {
    const response = await fetch(`${this.baseUrl}${route}`, {
      headers: {
        "Content-Type": "application/json",
      },
      ...init,
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    }

    return payload;
  }

  async upsertFromTrace(payload) {
    return this.request("/api/nodes/upsert-from-trace", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

GraphMemoryViewProvider.prototype.syncDiagnostics = async function syncDiagnostics(api, node, editorContext) {
  const topDiagnostic = editorContext.diagnostics[0];

  if (!topDiagnostic) {
    return;
  }

  const exists = node.debugSignals.some(
    (signal) =>
      signal.location === topDiagnostic.location &&
      signal.symptom === topDiagnostic.message
  );

  if (exists) {
    return;
  }

  await api.addDebugSignal(node.id, {
    title: topDiagnostic.severity === "error" ? "Captured Error" : "Captured Diagnostic",
    location: topDiagnostic.location,
    symptom: topDiagnostic.message,
  });
};

function getEditorContext(editor) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const fileName = editor.document.fileName;
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, fileName).replaceAll("\\", "/")
    : path.basename(fileName);
  const line = editor.selection.active.line + 1;
  const diagnostics = vscode.languages
    .getDiagnostics(editor.document.uri)
    .map((item) => ({
      message: item.message,
      severity: diagnosticSeverity(item.severity),
      location: `${relativePath}:${item.range.start.line + 1}`,
    }));

  const firstDiagnostic = diagnostics[0];

  return {
    fileName: path.basename(fileName),
    relativePath,
    workspacePath: workspaceFolder?.uri.fsPath || null,
    line,
    location: firstDiagnostic ? firstDiagnostic.location : `${relativePath}:${line}`,
    query: firstDiagnostic ? firstDiagnostic.message : "",
    diagnostics,
  };
}

function getPrimaryWorkspacePath() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function getActiveEditorContext() {
  const editor = getBestAvailableEditor();
  if (!editor) {
    return getActiveTabContext();
  }
  return getEditorContext(editor);
}

function getBestAvailableEditor() {
  if (vscode.window.activeTextEditor) {
    return vscode.window.activeTextEditor;
  }

  const visibleEditor = vscode.window.visibleTextEditors.find((editor) => Boolean(editor?.document));
  if (visibleEditor) {
    return visibleEditor;
  }

  return null;
}

function getActiveTabContext() {
  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  const input = activeTab?.input;
  const uri = input?.uri || input?.modified;
  if (!uri || !uri.fsPath) {
    return null;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const fileName = uri.fsPath;
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, fileName).replaceAll("\\", "/")
    : path.basename(fileName);

  return {
    fileName: path.basename(fileName),
    relativePath,
    workspacePath: workspaceFolder?.uri.fsPath || getPrimaryWorkspacePath(),
    line: 1,
    location: `${relativePath}:1`,
    query: "",
    diagnostics: [],
  };
}

function diagnosticSeverity(value) {
  switch (value) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "unknown";
  }
}

function getSetting(name, fallback) {
  return vscode.workspace.getConfiguration("graphMemory").get(name, fallback);
}

module.exports = {
  activate,
  deactivate,
};
