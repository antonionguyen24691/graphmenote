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

    case "vault-config":
      print(await client.getVaultConfig());
      return;

    case "vault-set":
      ensure(args[0], "Can truyen rootPath.");
      print(await client.setVaultConfig(args[0]));
      return;

    case "vault-scaffold":
      ensure(args[0], "Can truyen rootPath.");
      print(await client.scaffoldVault(args[0]));
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
      print(await client.crawlProjects(rootPath, maxDepth, parseFlags(args.slice(2))));
      return;
    }

    case "workflow-prepare":
      print(await client.prepareWorkflowExecution(parseFlags(args)));
      return;

    case "modules":
      print(await client.findReusableModules(parseFlags(args)));
      return;

    case "brain-context":
      print(await client.getBrainContext(parseFlags(args)));
      return;

    case "brain-skills":
      print(await client.listBrainSkills(parseFlags(args)));
      return;

    case "brain-skill": {
      ensure(args[0], "Can truyen skillId.");
      print(await client.getBrainSkill(args[0]));
      return;
    }

    case "brain-skill-register": {
      const localPath = args[0];
      ensure(localPath, "Can truyen localPath.");
      print(await client.registerBrainSkill({ localPath, ...parseFlags(args.slice(1)) }));
      return;
    }

    case "brain-skill-update": {
      const sourceUrl = args[0];
      ensure(sourceUrl, "Can truyen sourceUrl.");
      print(await client.updateBrainSkillFromGit({ sourceUrl, ...parseFlags(args.slice(1)) }));
      return;
    }

    case "ai-providers":
      print(await client.listAiProviders(parseFlags(args)));
      return;

    case "ai-provider": {
      print(await client.getAiProvider(args[0] || parseFlags(args).providerId));
      return;
    }

    case "ai-provider-add": {
      const kind = args[0];
      const baseUrl = args[1];
      ensure(kind, "Can truyen provider kind, vi du ollama, vllm, llamacpp, harness.");
      ensure(baseUrl, "Can truyen baseUrl OpenAI-compatible.");
      print(await client.registerAiProvider(normalizeAiFlags({ kind, baseUrl, ...parseFlags(args.slice(2)) })));
      return;
    }

    case "ai-healthcheck":
      print(await client.healthcheckAiProvider(normalizeAiFlags(parseFlags(args))));
      return;

    case "ai-chat":
      print(await client.chatWithAiProvider(normalizeAiFlags(parseFlags(args))));
      return;

    case "ai-harness-run":
      print(await client.runAiHarness(normalizeAiFlags(parseFlags(args))));
      return;

    case "ai-model-runs":
      print(await client.listAiModelRuns(parseFlags(args)));
      return;

    case "ai-doctor":
      print(await client.runAiSetupDoctor(parseFlags(args)));
      return;

    case "ai-pick":
      print(await client.pickAiRuntime(parseFlags(args)));
      return;

    case "ai-profiles":
      print(await client.listAiRuntimeProfiles(parseFlags(args)));
      return;

    case "ai-profile": {
      print(await client.getAiRuntimeProfile(args[0] || parseFlags(args).profileId));
      return;
    }

    case "ai-profile-upsert":
      print(await client.upsertAiRuntimeProfile(normalizeAiFlags(parseFlags(args))));
      return;

    case "ai-chat-threads":
      print(await client.listAiChatThreads(parseFlags(args)));
      return;

    case "ai-chat-thread": {
      const threadId = args[0] || parseFlags(args).threadId;
      ensure(threadId, "Can truyen threadId.");
      print(await client.getAiChatThread(threadId, parseFlags(args.slice(1))));
      return;
    }

    case "ai-chat-start":
      print(await client.startAiChatThread(normalizeAiFlags(parseFlags(args))));
      return;

    case "ai-chat-send":
      print(await client.sendAiChatMessage(normalizeAiFlags(parseFlags(args))));
      return;

    case "project-match":
      print(await client.matchProjectToReusableModules({
        workspacePath: args[0],
        ...parseFlags(args.slice(1)),
      }));
      return;

    case "module-adoptions":
      print(await client.getModuleAdoptionMemory(parseFlags(args)));
      return;

    case "module-verifications":
      print(await client.getModuleVerificationMemory(parseFlags(args)));
      return;

    case "adoption-recipe":
      print(await client.getAdoptionRecipe(parseFlags(args)));
      return;

    case "adoption-execution-assist":
      print(await client.getAdoptionExecutionAssist(parseFlags(args)));
      return;

    case "adoption-patch-draft":
      print(await client.getAdoptionPatchDraft(parseFlags(args)));
      return;

    case "adoption-apply-preview":
      print(await client.getAdoptionApplyPreview(normalizeAdoptionApplyFlags(parseFlags(args))));
      return;

    case "adoption-apply":
      print(await client.applyAdoptionPatchDraft(normalizeAdoptionApplyFlags(parseFlags(args))));
      return;

    case "module-register": {
      const workspacePath = args[0];
      const entryPath = args[1];
      const capability = args[2];
      const name = args.slice(3).join(" ");
      ensure(workspacePath, "Can truyen workspacePath.");
      ensure(entryPath, "Can truyen entryPath.");
      ensure(capability, "Can truyen capability.");
      print(await client.registerReusableModule({ workspacePath, entryPath, capability, name }));
      return;
    }

    case "module-harvest": {
      const rootPath = args[0];
      ensure(rootPath, "Can truyen rootPath.");
      print(await client.harvestReusableModules(rootPath, parseFlags(args.slice(1))));
      return;
    }

    case "module-cleanup": {
      const workspacePath = args[0];
      ensure(workspacePath, "Can truyen workspacePath.");
      print(await client.cleanupModuleRegistry(workspacePath, parseFlags(args.slice(1))));
      return;
    }

    case "low-token-context":
      print(await client.getLowTokenContext(parseFlags(args)));
      return;

    case "implementation-context":
      print(await client.getImplementationContext(parseFlags(args)));
      return;

    case "implementation-upsert": {
      const workspacePath = args[0];
      const title = args[1];
      ensure(workspacePath, "Can truyen workspacePath.");
      ensure(title, "Can truyen title.");
      const flags = parseFlags(args.slice(2));
      print(await client.upsertImplementationThread({ workspacePath, title, ...normalizeImplementationFlags(flags) }));
      return;
    }

    case "module-adoption-record": {
      const moduleId = args[0];
      const targetWorkspacePath = args[1];
      ensure(moduleId, "Can truyen moduleId.");
      ensure(targetWorkspacePath, "Can truyen targetWorkspacePath.");
      const flags = parseFlags(args.slice(2));
      print(await client.recordModuleAdoption({
        moduleId,
        targetWorkspacePath,
        ...normalizeImplementationFlags(flags),
      }));
      return;
    }

    case "module-verification-record": {
      const moduleId = args[0];
      const targetWorkspacePath = args[1];
      ensure(moduleId, "Can truyen moduleId.");
      ensure(targetWorkspacePath, "Can truyen targetWorkspacePath.");
      const flags = parseFlags(args.slice(2));
      print(await client.recordModuleVerification({
        moduleId,
        targetWorkspacePath,
        ...normalizeImplementationFlags(flags),
      }));
      return;
    }

    case "search":
      print(await client.searchNodes(args.join(" ")));
      return;

    case "trace":
      print(await client.traceNode(parseFlags(args)));
      return;

    case "context-window":
      print(await client.getContextWindow(parseFlags(args)));
      return;

    case "trace-execution":
      print(await client.traceExecution(parseFlags(args)));
      return;

    case "impact-of-change":
      print(await client.impactOfChange(parseFlags(args)));
      return;

    case "debug-context":
      print(await client.getDebugContext(parseFlags(args)));
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

function normalizeImplementationFlags(flags) {
  const payload = { ...flags };

  [
    "touchedFiles",
    "tags",
    "adapterChanges",
    "dependencyChanges",
    "envChanges",
    "passedTests",
    "failedTests",
    "integrationErrors",
    "fixPatterns",
    "verificationNotes",
  ].forEach((key) => {
    if (payload[key]) {
      payload[key] = String(payload[key])
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  });

  return payload;
}

function normalizeAiFlags(flags) {
  const payload = { ...flags };

  ["capabilities"].forEach((key) => {
    if (payload[key]) {
      payload[key] = String(payload[key])
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  });

  ["temperature"].forEach((key) => {
    if (payload[key] !== undefined) {
      payload[key] = Number(payload[key]);
    }
  });

  return payload;
}

function normalizeAdoptionApplyFlags(flags) {
  const payload = { ...flags };

  ["roles", "selectedFiles"].forEach((key) => {
    if (payload[key]) {
      payload[key] = String(payload[key])
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  });

  ["appendExisting", "overwriteExisting", "allowPackageJson", "allowPlaceholders", "apply"].forEach((key) => {
    if (payload[key] !== undefined) {
      payload[key] = ["true", "1", "yes", "on"].includes(String(payload[key]).trim().toLowerCase());
    }
  });

  if (payload.dependencyVersions) {
    try {
      payload.dependencyVersions = JSON.parse(payload.dependencyVersions);
    } catch {}
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
  const workflowPurpose = inferWorkflowPurposeFromCommand(commandText);
  let workflow = null;
  try {
    workflow = await client.prepareWorkflowExecution({
      workspacePath,
      purpose: workflowPurpose,
      query: commandText,
      toolSource,
      checkHealth: false,
    });
    console.error(`[graph-memory] workflow prepared: ${workflow.handoff?.summary || workflow.status}`);
  } catch (error) {
    console.error(`[graph-memory] workflow prepare failed: ${error.message}`);
  }
  const run = await client.startActivity({
    workspacePath,
    toolSource,
    commandText,
    summary: workflow?.handoff?.summary || `Running ${commandText}`,
    metadata: workflow
      ? {
          workflow: {
            purpose: workflow.purpose,
            status: workflow.status,
            runtime: workflow.runtime?.selected
              ? {
                  providerId: workflow.runtime.selected.providerId,
                  profileId: workflow.runtime.selected.profileId,
                  model: workflow.runtime.selected.model,
                }
              : null,
            recommendedFiles: (workflow.memory?.recommendedFiles || []).slice(0, 3),
            startWith: workflow.handoff?.startWith || null,
          },
        }
      : {},
  });

  console.error(`[graph-memory] activity ${run.id} started for ${workspacePath}`);

  const heartbeatTimer = setInterval(() => {
    client
      .heartbeatActivity(run.id, {
        summary: workflow?.handoff?.summary || `Running ${commandText}`,
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

function inferWorkflowPurposeFromCommand(commandText) {
  const normalized = String(commandText || "").toLowerCase();
  if (normalized.includes("deploy") || normalized.includes("vercel") || normalized.includes("release")) {
    return "deploy";
  }
  if (normalized.includes("crawl") || normalized.includes("scrape") || normalized.includes("scan")) {
    return "crawl";
  }
  if (normalized.includes("review") || normalized.includes("lint") || normalized.includes("test")) {
    return "review";
  }
  return "coding";
}

function printHelp() {
  console.log(`Graph Memory CLI

Usage:
  node graph-cli.js graph
  node graph-cli.js storage
  node graph-cli.js vault-config
  node graph-cli.js vault-set "C:\\Users\\DELL\\KnowledgeVault"
  node graph-cli.js vault-scaffold "C:\\Users\\DELL\\KnowledgeVault"
  node graph-cli.js activity-overview
  node graph-cli.js activity-runs --status running
  node graph-cli.js activity-start "C:\\repo" codex Dang debug auth
  node graph-cli.js activity-beat run-123 --file src/auth/index.ts --summary Dang trace login
  node graph-cli.js activity-finish run-123 --status completed --summary Da fix xong --touchedFiles src/auth/index.ts,src/auth/token-store.ts
  node graph-cli.js run "C:\\repo" codex npm run dev
  node graph-cli.js open-folder exports
  node graph-cli.js crawl-projects "C:\\Users\\DELL\\OneDrive\\Desktop\\sang kein" 3
  node graph-cli.js workflow-prepare --workspacePath "C:\\repo\\stock" --purpose deploy --query "prepare deploy workflow"
  node graph-cli.js brain-context --workspacePath "C:\\repo\\stock" --query ocr
  node graph-cli.js brain-skills --query testing
  node graph-cli.js brain-skill skill-testing-abc123
  node graph-cli.js brain-skill-register "C:\\skills\\my-skill" --name My Skill
  node graph-cli.js brain-skill-update https://github.com/org/repo.git --subdir skills/ocr --ref main --name OCR Skill
  node graph-cli.js ai-providers
  node graph-cli.js ai-provider-add ollama http://localhost:11434/v1 --model qwen2.5-coder --capabilities chat,json,harness
  node graph-cli.js ai-healthcheck --provider provider-ollama-local
  node graph-cli.js ai-chat --provider provider-ollama-local --model qwen2.5-coder --workspacePath "C:\\repo\\stock" --query "Tom tat viec can lam tiep"
  node graph-cli.js ai-harness-run --provider provider-ollama-local --suite harness
  node graph-cli.js ai-harness-run --provider provider-ollama-local --mode external --tasks gsm8k --limit 5 --applyChatTemplate true
  node graph-cli.js ai-harness-run --provider provider-ollama-local --importPath "C:\\evals\\gsm8k\\results.json" --moduleId module-ocr --workspacePath "C:\\repo\\new-app"
  node graph-cli.js ai-model-runs --limit 10
  node graph-cli.js ai-doctor --timeoutMs 1200
  node graph-cli.js ai-pick --purpose coding --checkHealth false
  node graph-cli.js ai-profiles
  node graph-cli.js ai-profile-upsert --id profile-local-crawl --name "Local Crawl" --purpose crawl --provider provider-ollama-local --model qwen2.5-coder --contextPolicy low-token
  node graph-cli.js ai-chat-start --workspacePath "C:\\repo\\stock" --title "Noi bo OCR rollout" --profile profile-local-coding
  node graph-cli.js ai-chat-send --threadId ai-chat-abc --message "Dang dung o dau?"
  node graph-cli.js ai-chat-threads --workspacePath "C:\\repo\\stock"
  node graph-cli.js modules --capability ocr --workspacePath "C:\\repo\\new-app"
  node graph-cli.js project-match "C:\\repo\\new-app" --query ocr
  node graph-cli.js module-adoptions --workspacePath "C:\\repo\\new-app"
  node graph-cli.js module-verifications --workspacePath "C:\\repo\\new-app"
  node graph-cli.js adoption-recipe --moduleId module-abc --targetWorkspacePath "C:\\repo\\new-app"
  node graph-cli.js adoption-execution-assist --moduleId module-abc --targetWorkspacePath "C:\\repo\\new-app"
  node graph-cli.js adoption-patch-draft --moduleId module-abc --targetWorkspacePath "C:\\repo\\new-app"
  node graph-cli.js adoption-apply-preview --moduleId module-abc --targetWorkspacePath "C:\\repo\\new-app" --appendExisting true
  node graph-cli.js adoption-apply --moduleId module-abc --targetWorkspacePath "C:\\repo\\new-app" --appendExisting true --allowPackageJson true --dependencyVersions "{\"firebase\":\"^12.0.0\"}"
  node graph-cli.js module-register "C:\\repo\\stock" "C:\\repo\\stock\\src\\ocr" ocr OCR Module
  node graph-cli.js module-harvest "C:\\repo\\stock" --maxDepth 5 --maxFiles 300
  node graph-cli.js module-cleanup "C:\\repo\\stock"
  node graph-cli.js low-token-context --workspacePath "C:\\repo\\stock" --query ocr
  node graph-cli.js implementation-context --workspacePath "C:\\repo\\stock"
  node graph-cli.js implementation-upsert "C:\\repo\\stock" "OCR rollout" --currentStep Wiring upload flow --nextStep Add OCR adapter
  node graph-cli.js module-adoption-record module-abc "C:\\repo\\new-app" --adoptionType adapt --integrationPattern Wrapped existing service behind local adapter
  node graph-cli.js module-verification-record module-abc "C:\\repo\\new-app" --passedTests auth smoke test,login flow --integrationErrors Missing FIREBASE_PROJECT_ID --fixPatterns Map FIREBASE_* keys in config/auth.ts
  node graph-cli.js search refresh token
  node graph-cli.js trace --file src/auth/token-store.ts
  node graph-cli.js trace --location src/auth/token-store.ts:88
  node graph-cli.js context-window --file src/auth/token-store.ts --query token
  node graph-cli.js trace-execution --nodeId auth-service
  node graph-cli.js impact-of-change --file src/auth/token-store.ts
  node graph-cli.js debug-context --file src/auth/token-store.ts --location src/auth/token-store.ts:88
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
