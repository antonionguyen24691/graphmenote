const fs = require("node:fs");
const path = require("node:path");

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".idea",
  ".vscode",
  ".agent",
]);

function crawlProjects(rootPath, options = {}) {
  const maxDepth = Number(options.maxDepth ?? 3);
  const results = [];
  const visited = new Set();

  walk(rootPath, 0);
  return attachProjectRelations(results);

  function walk(currentPath, depth) {
    if (depth > maxDepth || visited.has(currentPath)) {
      return;
    }
    visited.add(currentPath);

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const folderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const markers = detectProjectMarkers(folderNames, fileNames);

    if (markers.length) {
      results.push(buildProjectDescriptor(currentPath, rootPath, markers, folderNames, fileNames));
    }

    entries
      .filter((entry) => entry.isDirectory() && !IGNORE_DIRS.has(entry.name))
      .forEach((entry) => {
        walk(path.join(currentPath, entry.name), depth + 1);
      });
  }
}

function attachProjectRelations(nodes) {
  const pathEntries = nodes.map((node) => ({
    id: node.id,
    fullPath: node.files[0],
  }));

  nodes.forEach((node) => {
    const currentPath = node.files[0];
    const parentCandidate = pathEntries
      .filter((entry) => entry.id !== node.id && currentPath.startsWith(`${entry.fullPath}${path.sep}`))
      .sort((left, right) => right.fullPath.length - left.fullPath.length)[0];

    if (parentCandidate) {
      node.parentId = parentCandidate.id;
      node.relations = uniqueStrings([...(node.relations || []), parentCandidate.id]);
      const parentNode = nodes.find((entry) => entry.id === parentCandidate.id);
      parentNode.relations = uniqueStrings([...(parentNode.relations || []), node.id]);
    }
  });

  return nodes;
}

function detectProjectMarkers(folderNames, fileNames) {
  const markers = [];

  if (fileNames.includes("package.json")) {
    markers.push("package.json");
  }
  if (folderNames.includes(".git")) {
    markers.push(".git");
  }
  if (fileNames.some((name) => /^readme(\.|$)/i.test(name))) {
    markers.push("README");
  }
  if (folderNames.includes("src")) {
    markers.push("src");
  }
  if (folderNames.includes("app")) {
    markers.push("app");
  }
  if (folderNames.includes("components")) {
    markers.push("components");
  }
  if (folderNames.includes("packages") || folderNames.includes("apps")) {
    markers.push("monorepo");
  }

  return markers;
}

function buildProjectDescriptor(currentPath, rootPath, markers, folderNames, fileNames) {
  const relativePath = path.relative(rootPath, currentPath).replaceAll("\\", "/") || ".";
  const name = path.basename(currentPath);
  const packageJson = safeReadJson(path.join(currentPath, "package.json"));
  const packageName = typeof packageJson?.name === "string" ? packageJson.name : null;
  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts).slice(0, 6) : [];

  return {
    id: `project-${sanitizeId(relativePath === "." ? name : relativePath)}`,
    name: packageName || name,
    type: markers.includes("monorepo") ? "workspace" : "project",
    summary: buildSummary(name, relativePath, markers, packageJson),
    severity: "medium",
    files: [currentPath],
    relations: [],
    contextWindow: [
      {
        label: "Root path",
        detail: currentPath,
      },
      {
        label: "Detected markers",
        detail: markers.join(", "),
      },
      ...(scripts.length
        ? [
            {
              label: "Scripts",
              detail: scripts.join(", "),
            },
          ]
        : []),
    ],
    debugSignals: [],
    chatHistory: [],
    notes: [
      `Auto-ingested from crawl under ${rootPath}`,
      `Relative path: ${relativePath}`,
      `Folders: ${folderNames.slice(0, 8).join(", ") || "-"}`,
      `Files: ${fileNames.slice(0, 8).join(", ") || "-"}`,
    ],
    openIssues: 0,
  };
}

function buildSummary(name, relativePath, markers, packageJson) {
  const packageVersion = packageJson?.version ? ` v${packageJson.version}` : "";
  const markerText = markers.join(", ");
  return `${name}${packageVersion} detected at ${relativePath} with markers: ${markerText}.`;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sanitizeId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  crawlProjects,
};
