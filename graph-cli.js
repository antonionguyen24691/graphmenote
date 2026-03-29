#!/usr/bin/env node

const { spawn } = require("node:child_process");
const client = require("./graph-client");

main().catch((error) => {
  console.error(error.message);
  if (error.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "graph":
      print(await client.getGraph());
      return;

    case "storage":
      print(await client.getStorageInfo());
      return;

    case "activity-overview":
      print(await client.getActivityOverview());
      return;

    case "activity-runs":
      print(await client.listActivityRuns(parseFlags(args)).then((payload) => payload.results ?? payload));
      return;

    case "activity-start": {
      const workspacePath = args[0];
      const toolSource = args[1] || "manual";
      const summary = args.slice(2).join(" ");
      ensure(workspacePath, "Can truyen workspacePath.");
      print(await client.startActivity({ workspacePath, toolSource, summary }));
      return;
    }

    case "activity-beat": {
      const runId = args[0];
      ensure(runId, "Can truyen runId.");
      print(await client.heartbeatActivity(runId, normalizeActivityFlags(parseFlags(args.slice(1)))));
      return;
    }

    case "activity-finish": {
      const runId = args[0];
      ensure(runId, "Can truyen runId.");
      print(await client.finishActivity(runId, normalizeActivityFlags(parseFlags(args.slice(1)))));
      return;
    }

    case "run": {
      const workspacePath = args[0];
      const toolSource = args[1] || "cli";
      const commandParts = args.slice(2);
      ensure(workspacePath, "Can truyen workspacePath.");
      ensure(commandParts.length, "Can truyen command can chay.");
      await runTrackedCommand(workspacePath, toolSource, commandParts);
      return;
    }

    case "open-folder":
      print(await client.openStorageFolder(args[0] || "storage"));
      return;

    case "crawl-projects": {
      const rootPath = args[0];
      const maxDepth = args[1] || 3;
      ensure(rootPath, "Can truyen rootPath.");
      print(await client.crawlProjects(rootPath, maxDepth));
      return;
    }

    case "search":
      print(await client.searchNodes(args.join(" ")));
      return;

    case "trace":
      print(await client.traceNode(parseFlags(args)));
      return;

    case "node":
      ensure(args[0], "Can truyen node id.");
      print(await client.getNode(args[0]));
      return;

    case "active":
      ensure(args[0], "Can truyen node id.");
      print(await client.setActiveNode(args[0]));
      return;

    case "create": {
      const file = args[0];
      const name = args.slice(1).join(" ");
      ensure(file, "Can truyen file.");
      print(await client.createNode({ file, name }));
      return;
    }

    case "upsert-trace": {
      const file = args[0];
      const location = args[1];
      const symptom = args.slice(2).join(" ");
      ensure(file, "Can truyen file.");
      print(await client.upsertNodeFromTrace({ file, location, symptom }));
      return;
    }

    case "note": {
      const nodeId = args[0];
      const note = args.slice(1).join(" ");
      ensure(nodeId, "Can truyen node id.");
      ensure(note, "Can truyen noi dung note.");
      print(await client.addNote(nodeId, note, "assistant"));
      return;
    }

    case "chat": {
      const nodeId = args[0];
      const message = args.slice(1).join(" ");
      ensure(nodeId, "Can truyen node id.");
      ensure(message, "Can truyen noi dung message.");
      print(await client.addChat(nodeId, message, "user"));
      return;
    }

    case "signal": {
      const nodeId = args[0];
      const title = args[1];
      const location = args[2];
      const symptom = args.slice(3).join(" ");
      ensure(nodeId, "Can truyen node id.");
      ensure(title, "Can truyen title.");
      ensure(location, "Can truyen location.");
      ensure(symptom, "Can truyen symptom.");
      print(await client.addDebugSignal(nodeId, { title, location, symptom }));
      return;
    }

    case "export":
      print(await client.exportGraph(args[0]));
      return;

    case "backup":
      print(await client.backupDatabase(args[0]));
      return;

    case "import": {
      const sourcePath = args[0];
      const mode = args[1] || "replace";
      ensure(sourcePath, "Can truyen sourcePath.");
      print(await client.importGraph(sourcePath, mode));
      return;
    }

    case "restore-latest-backup":
      print(await client.restoreLatestBackup());
      return;

    default:
      printHelp();
  }
}

function parseFlags(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (!key?.startsWith("--") || value === undefined) {
      continue;
    }

    result[key.slice(2)] = value;
  }

  return result;
}

function normalizeActivityFlags(flags) {
  const payload = { ...flags };

  if (payload.touchedFiles) {
    payload.touchedFiles = String(payload.touchedFiles)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (payload.command) {
    payload.commandText = payload.command;
    delete payload.command;
  }

  if (payload.file) {
    payload.currentFile = payload.file;
  }

  return payload;
}

function ensure(value, message) {
  if (!value || !String(value).trim()) {
    throw new Error(message);
  }
}

async function runTrackedCommand(workspacePath, toolSource, commandParts) {
  const commandText = commandParts.join(" ");
  const run = await client.startActivity({
    workspacePath,
    toolSource,
    commandText,
    summary: `Running ${commandText}`,
  });

  console.error(`[graph-memory] activity ${run.id} started for ${workspacePath}`);

  const heartbeatTimer = setInterval(() => {
    client
      .heartbeatActivity(run.id, {
        summary: `Running ${commandText}`,
        commandText,
      })
      .catch(() => {});
  }, 30000);

  const child = spawn(commandText, {
    cwd: workspacePath,
    shell: true,
    stdio: "inherit",
  });
  let finalized = false;

  const shutdown = async (status, extra = {}) => {
    if (finalized) {
      return;
    }
    finalized = true;
    clearInterval(heartbeatTimer);
    try {
      const finished = await client.finishActivity(run.id, {
        status,
        summary: extra.summary || `${commandText} ${status}`,
        metadata: {
          exitCode: extra.exitCode ?? null,
          signal: extra.signal ?? null,
        },
      });
      console.error(`[graph-memory] activity ${finished.id} ${finished.status}`);
    } catch (error) {
      console.error(`[graph-memory] finish failed: ${error.message}`);
    }
  };

  const stopChild = async (signalName) => {
    try {
      if (!child.killed) {
        child.kill(signalName);
      }
    } catch {}
    await shutdown("stopped", {
      summary: `${commandText} stopped by ${signalName}`,
      signal: signalName,
    });
    process.exitCode = 1;
  };

  process.once("SIGINT", () => {
    stopChild("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopChild("SIGTERM");
  });

  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", async (code, signal) => {
      const status = code === 0 ? "completed" : signal ? "stopped" : "failed";
      await shutdown(status, {
        summary:
          status === "completed"
            ? `${commandText} completed`
            : `${commandText} exited with ${signal || code}`,
        exitCode: code,
        signal,
      });
      process.exitCode = typeof code === "number" ? code : status === "completed" ? 0 : 1;
      resolve();
    });
  });
}

function print(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp() {
  console.log(`Graph Memory CLI

Usage:
  node graph-cli.js graph
  node graph-cli.js storage
  node graph-cli.js activity-overview
  node graph-cli.js activity-runs --status running
  node graph-cli.js activity-start "C:\\repo" codex Dang debug auth
  node graph-cli.js activity-beat run-123 --file src/auth/index.ts --summary Dang trace login
  node graph-cli.js activity-finish run-123 --status completed --summary Da fix xong --touchedFiles src/auth/index.ts,src/auth/token-store.ts
  node graph-cli.js run "C:\\repo" codex npm run dev
  node graph-cli.js open-folder exports
  node graph-cli.js crawl-projects "C:\\Users\\DELL\\OneDrive\\Desktop\\sang kein" 3
  node graph-cli.js search refresh token
  node graph-cli.js trace --file src/auth/token-store.ts
  node graph-cli.js trace --location src/auth/token-store.ts:88
  node graph-cli.js node auth-service
  node graph-cli.js active auth-service
  node graph-cli.js create src/new/module.ts New Module
  node graph-cli.js upsert-trace src/new/module.ts src/new/module.ts:10 Error message
  node graph-cli.js note auth-service Can lock refresh token flow
  node graph-cli.js chat auth-service User bao loi xuat hien sau sleep tab
  node graph-cli.js signal auth-service Timeout src/auth/index.ts:42 Request treo sau khi resume
  node graph-cli.js export
  node graph-cli.js backup
  node graph-cli.js import C:\\path\\to\\graph-export.json replace
  node graph-cli.js restore-latest-backup
`);
}
