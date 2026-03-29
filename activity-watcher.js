#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const db = require("./db");

const WATCH_INTERVAL_MS = Number(process.env.GRAPH_MEMORY_WATCH_INTERVAL_MS || 15000);
const ACTIVE_WINDOW_MS = Number(process.env.GRAPH_MEMORY_ACTIVE_WINDOW_MS || 15 * 60 * 1000);
const MAX_CODEX_SESSION_FILES = Number(process.env.GRAPH_MEMORY_MAX_CODEX_SESSIONS || 20);
const WATCH_VERBOSE = process.argv.includes("--verbose") || process.env.GRAPH_MEMORY_WATCH_VERBOSE === "1";
const WATCH_ONCE = process.argv.includes("--once");
const PRINT_JSON = process.argv.includes("--print");
const ENABLE_VSCODE_PROCESS_WATCH = process.env.GRAPH_MEMORY_WATCH_VSCODE === "1";

const trackedRuns = new Map();

main();

function main() {
  if (WATCH_ONCE) {
    const detections = collectDetections(new Date());
    syncDetections(detections, new Date());
    if (PRINT_JSON) {
      process.stdout.write(`${JSON.stringify(detections, null, 2)}\n`);
    }
    return;
  }

  log(`activity watcher started, poll=${WATCH_INTERVAL_MS}ms`);
  tick();
  setInterval(tick, WATCH_INTERVAL_MS).unref();
}

function tick() {
  const now = new Date();
  try {
    const detections = collectDetections(now);
    syncDetections(detections, now);
  } catch (error) {
    log(`watcher tick failed: ${error.message}`);
  }
}

function collectDetections(now) {
  return dedupeDetections([
    ...collectCodexDetections(now),
    ...collectProcessDetections(now),
  ]);
}

function syncDetections(detections, now) {
  const seen = new Set();

  detections.forEach((detection) => {
    seen.add(detection.key);
    const runId = detection.runId || buildRunId(detection);

    if (trackedRuns.has(detection.key)) {
      const tracked = trackedRuns.get(detection.key);
      tracked.lastSeenAt = now.toISOString();
      db.heartbeatActivity(runId, {
        summary: detection.summary,
        currentFile: detection.currentFile,
        latestError: detection.latestError,
        metadata: detection.metadata,
      });
      return;
    }

    const run = db.startActivity({
      runId,
      workspacePath: detection.workspacePath,
      toolSource: detection.toolSource,
      summary: detection.summary,
      currentFile: detection.currentFile,
      latestError: detection.latestError,
      metadata: detection.metadata,
    });

    trackedRuns.set(detection.key, {
      runId: run.id,
      workspacePath: detection.workspacePath,
      toolSource: detection.toolSource,
      lastSeenAt: now.toISOString(),
      summary: detection.summary,
      metadata: detection.metadata,
    });

    log(`start ${detection.toolSource} -> ${detection.workspacePath}`);
  });

  for (const [key, tracked] of trackedRuns.entries()) {
    if (seen.has(key)) {
      continue;
    }

    db.finishActivity(tracked.runId, {
      status: "completed",
      summary: tracked.summary || `Auto session finished for ${tracked.workspacePath}`,
      metadata: {
        ...(tracked.metadata || {}),
        finishedBy: "activity-watcher",
      },
    });
    trackedRuns.delete(key);
    log(`finish ${tracked.toolSource} -> ${tracked.workspacePath}`);
  }
}

function collectCodexDetections(now) {
  if (!hasRunningProcess("Codex.exe")) {
    return [];
  }

  const codexHome = path.join(os.homedir(), ".codex");
  const sessionsRoot = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsRoot)) {
    return [];
  }

  const threadIndex = readCodexThreadIndex(path.join(codexHome, "session_index.jsonl"));
  const sessionFiles = listRecentSessionFiles(sessionsRoot, MAX_CODEX_SESSION_FILES);

  return sessionFiles
    .filter((file) => now.getTime() - file.modifiedAt.getTime() <= ACTIVE_WINDOW_MS)
    .map((file) => readCodexSessionCandidate(file, threadIndex))
    .filter(Boolean)
    .map((candidate) => ({
      key: `codex-session:${candidate.sessionId}`,
      runId: `watch-codex-session-${sanitizeId(candidate.sessionId)}`,
      workspacePath: candidate.workspacePath,
      toolSource: "codex",
      summary: candidate.threadName
        ? `Codex thread active: ${candidate.threadName}`
        : `Codex session active in ${path.basename(candidate.workspacePath)}`,
      currentFile: candidate.currentFile,
      latestError: null,
      metadata: {
        sessionId: candidate.sessionId,
        sessionFile: candidate.sessionFile,
        originator: candidate.originator,
        source: candidate.source,
        cliVersion: candidate.cliVersion,
        threadName: candidate.threadName || null,
        detectedBy: "codex-session-index",
      },
    }));
}

function collectProcessDetections(now) {
  const processes = getProcessSnapshot();
  return processes
    .filter((process) => detectToolFromProcess(process.name))
    .map((process) => buildProcessCandidate(process, now))
    .filter(Boolean);
}

function buildProcessCandidate(process, now) {
  const toolSource = detectToolFromProcess(process.name);
  if (!toolSource) {
    return null;
  }

  const resolved = resolveWorkspaceFromCommandLine(process.commandLine);
  if (!resolved?.workspacePath) {
    return null;
  }

  return {
    key: `process:${toolSource}:${process.processId}:${resolved.workspacePath}`,
    runId: `watch-${sanitizeId(`${toolSource}-${process.processId}-${resolved.workspacePath}`)}`,
    workspacePath: resolved.workspacePath,
    toolSource,
    summary: `${toolSource} process active in ${path.basename(resolved.workspacePath)}`,
    currentFile: resolved.currentFile,
    latestError: null,
    metadata: {
      processId: process.processId,
      processName: process.name,
      commandLine: process.commandLine,
      detectedAt: now.toISOString(),
      detectedBy: "process-command-line",
    },
  };
}

function detectToolFromProcess(processName) {
  const normalized = String(processName || "").toLowerCase();
  if (normalized === "cursor.exe") {
    return "cursor";
  }
  if (normalized === "antigravity.exe") {
    return "antigravity";
  }
  if (ENABLE_VSCODE_PROCESS_WATCH && normalized === "code.exe") {
    return "vscode";
  }
  return null;
}

function getProcessSnapshot() {
  const command = [
    "Get-CimInstance Win32_Process",
    "| Select-Object ProcessId, Name, CommandLine",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      cwd: __dirname,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Khong doc duoc process list.");
  }

  const parsed = parseJson(result.stdout.trim());
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  return items.map((item) => ({
    processId: Number(item.ProcessId),
    name: item.Name || "",
    commandLine: item.CommandLine || "",
  }));
}

function hasRunningProcess(processName) {
  return getProcessSnapshot().some((process) => String(process.name).toLowerCase() === processName.toLowerCase());
}

function resolveWorkspaceFromCommandLine(commandLine) {
  if (!commandLine) {
    return null;
  }

  const candidatePaths = [
    ...extractUriPaths(commandLine, "--folder-uri"),
    ...extractUriPaths(commandLine, "--file-uri"),
    ...extractQuotedWindowsPaths(commandLine),
  ];

  const seen = new Set();
  for (const candidate of candidatePaths) {
    const normalizedCandidate = String(candidate || "").trim();
    if (!normalizedCandidate || seen.has(normalizedCandidate.toLowerCase())) {
      continue;
    }
    seen.add(normalizedCandidate.toLowerCase());

    const resolved = resolveWorkspaceCandidate(normalizedCandidate);
    if (resolved?.workspacePath) {
      return resolved;
    }
  }

  return null;
}

function resolveWorkspaceCandidate(candidatePath) {
  const normalized = candidatePath.replaceAll("/", path.sep);
  if (!fs.existsSync(normalized)) {
    return null;
  }

  const stat = fs.statSync(normalized);
  const currentFile = stat.isFile() ? normalized : null;
  const startPath = stat.isFile() ? path.dirname(normalized) : normalized;
  const workspacePath = findWorkspaceRoot(startPath);

  if (!workspacePath) {
    return null;
  }

  return {
    workspacePath,
    currentFile,
  };
}

function findWorkspaceRoot(startPath) {
  let current = path.resolve(startPath);
  let fallback = null;
  const home = path.resolve(os.homedir());

  while (current && current !== path.dirname(current)) {
    if (hasWorkspaceMarkers(current)) {
      return current;
    }

    if (!fallback && current.toLowerCase() !== home.toLowerCase()) {
      fallback = current;
    }

    current = path.dirname(current);
  }

  return fallback;
}

function hasWorkspaceMarkers(directory) {
  const markers = [
    "package.json",
    "pnpm-workspace.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    ".git",
    "README.md",
    "README",
  ];

  return markers.some((marker) => fs.existsSync(path.join(directory, marker)));
}

function extractUriPaths(commandLine, flagName) {
  const results = [];
  const regex = new RegExp(`${escapeRegex(flagName)}\\s+(?:"([^"]+)"|(\\S+))`, "gi");
  let match;

  while ((match = regex.exec(commandLine))) {
    const raw = match[1] || match[2];
    if (!raw) {
      continue;
    }

    if (/^file:/i.test(raw)) {
      try {
        const url = new URL(raw);
        const pathname = decodeURIComponent(url.pathname || "").replace(/^\/+/, "");
        results.push(pathname.replaceAll("/", "\\"));
      } catch {}
    }
  }

  return results;
}

function extractQuotedWindowsPaths(commandLine) {
  const regex = /"([A-Za-z]:\\[^"]+)"/g;
  const results = [];
  let match;

  while ((match = regex.exec(commandLine))) {
    results.push(match[1]);
  }

  return results;
}

function readCodexThreadIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return new Map();
  }

  const map = new Map();
  const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/).filter(Boolean);

  lines.forEach((line) => {
    const parsed = parseJson(line);
    if (parsed?.id) {
      map.set(parsed.id, parsed);
    }
  });

  return map;
}

function listRecentSessionFiles(rootPath, limit) {
  const files = [];
  walk(rootPath);
  return files.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime()).slice(0, limit);

  function walk(currentPath) {
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        return;
      }
      const stat = fs.statSync(fullPath);
      files.push({
        path: fullPath,
        modifiedAt: stat.mtime,
      });
    });
  }
}

function readCodexSessionCandidate(file, threadIndex) {
  const firstLine = readFirstLine(file.path);
  const parsed = parseJson(firstLine);
  if (parsed?.type !== "session_meta" || !parsed.payload?.cwd) {
    return null;
  }

  const sessionId = parsed.payload.id;
  const workspacePath = findWorkspaceRoot(parsed.payload.cwd);
  if (!workspacePath) {
    return null;
  }

  const threadInfo = threadIndex.get(sessionId);

  return {
    sessionId,
    workspacePath,
    sessionFile: file.path,
    originator: parsed.payload.originator || null,
    source: parsed.payload.source || null,
    cliVersion: parsed.payload.cli_version || null,
    threadName: threadInfo?.thread_name || null,
    currentFile: null,
  };
}

function readFirstLine(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const [firstLine] = content.split(/\r?\n/, 1);
  return firstLine || "";
}

function dedupeDetections(detections) {
  const seen = new Set();
  return detections.filter((detection) => {
    if (!detection?.workspacePath || !detection?.key) {
      return false;
    }
    const signature = `${detection.key}::${detection.workspacePath}`.toLowerCase();
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
}

function buildRunId(detection) {
  return `watch-${sanitizeId(`${detection.toolSource}-${detection.workspacePath}-${detection.key}`)}`;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function log(message) {
  if (!WATCH_VERBOSE) {
    return;
  }
  process.stdout.write(`[graph-memory-watcher] ${message}\n`);
}

module.exports = {
  collectCodexDetections,
  collectDetections,
  collectProcessDetections,
  dedupeDetections,
  extractQuotedWindowsPaths,
  extractUriPaths,
  findWorkspaceRoot,
  hasWorkspaceMarkers,
  listRecentSessionFiles,
  readCodexSessionCandidate,
  readCodexThreadIndex,
  resolveWorkspaceCandidate,
  resolveWorkspaceFromCommandLine,
};
