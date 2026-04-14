const fs = require("node:fs");
const path = require("node:path");
let ts = null;
try {
  ts = require("typescript");
} catch {
  ts = null;
}

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
  "__pycache__",
  ".tmp-activity",
  ".tmp-activity-check",
  ".tmp-memory",
  ".tmp-memory-api",
  ".tmp-memory-force",
  ".tmp-memory-verify",
  ".tmp-memory-verify2",
  "coverage",
  ".nyc_output",
]);

const IGNORE_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

const TABLE_COLORS = [
  "#5b8def", "#e67e22", "#2ecc71", "#e74c3c",
  "#9b59b6", "#1abc9c", "#f39c12", "#3498db",
  "#e91e63", "#00bcd4", "#8bc34a", "#ff5722",
  "#607d8b", "#795548", "#673ab7", "#009688",
];

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".php", ".java", ".go", ".rb",
]);
const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head"]);

function scanDirectoryTree(rootPath, maxDepth = 6) {
  const realRoot = resolveRealPath(rootPath);
  if (!realRoot) {
    throw new Error(`Path khong ton tai: ${rootPath}`);
  }

  return walkTree(realRoot, 0, maxDepth);
}

function walkTree(currentPath, depth, maxDepth) {
  if (depth > maxDepth) {
    return null;
  }

  let stat;
  try {
    stat = fs.statSync(currentPath);
  } catch {
    return null;
  }

  const name = path.basename(currentPath);

  if (stat.isFile()) {
    if (IGNORE_FILES.has(name)) {
      return null;
    }

    return {
      name,
      path: currentPath,
      type: "file",
      ext: path.extname(name).toLowerCase(),
      size: stat.size,
    };
  }

  if (!stat.isDirectory()) {
    return null;
  }

  if (IGNORE_DIRS.has(name) && depth > 0) {
    return null;
  }

  let entries;
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return {
      name,
      path: currentPath,
      type: "directory",
      children: [],
      fileCount: 0,
      dirCount: 0,
    };
  }

  const children = entries
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => walkTree(path.join(currentPath, entry.name), depth + 1, maxDepth))
    .filter(Boolean);

  const fileCount = children.filter((c) => c.type === "file").length;
  const dirCount = children.filter((c) => c.type === "directory").length;

  return {
    name,
    path: currentPath,
    type: "directory",
    children,
    fileCount,
    dirCount,
  };
}

function scanProjectSchema(rootPath) {
  const realRoot = resolveRealPath(rootPath);
  if (!realRoot) {
    throw new Error(`Path khong ton tai: ${rootPath}`);
  }

  const tables = [];
  const relations = [];
  const sources = [];

  const prismaFiles = findFilesByPattern(realRoot, /\.prisma$/i, 4);
  prismaFiles.forEach((filePath) => {
    sources.push({ type: "prisma", file: filePath });
    const result = parsePrismaSchema(filePath);
    mergeTables(tables, result.tables);
    mergeRelations(relations, result.relations);
  });

  const sqlFiles = findFilesByPattern(realRoot, /\.sql$/i, 5);
  sqlFiles.forEach((filePath) => {
    sources.push({ type: "sql", file: filePath });
    const result = parseSqlSchema(filePath);
    mergeTables(tables, result.tables);
    mergeRelations(relations, result.relations);
  });

  const modelFiles = findFilesByPattern(realRoot, /\.(model|schema|entity)\.(js|ts|jsx|tsx)$/i, 4);
  modelFiles.forEach((filePath) => {
    sources.push({ type: "model", file: filePath });
    const result = parseModelFile(filePath);
    mergeTables(tables, result.tables);
  });

  const djangoModelFiles = findFilesByPattern(realRoot, /models\.py$/i, 4);
  djangoModelFiles.forEach((filePath) => {
    sources.push({ type: "django", file: filePath });
    const result = parseDjangoModels(filePath);
    mergeTables(tables, result.tables);
    mergeRelations(relations, result.relations);
  });

  tables.forEach((table, index) => {
    if (!table.color) {
      table.color = TABLE_COLORS[index % TABLE_COLORS.length];
    }
  });

  return {
    tables,
    relations: deduplicateRelations(relations),
    sources,
    summary: `Found ${tables.length} tables, ${relations.length} relations from ${sources.length} source files.`,
  };
}

function parsePrismaSchema(filePath) {
  const tables = [];
  const relations = [];

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { tables, relations };
  }

  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const fields = [];
    const indexes = [];

    body.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
        if (trimmed.startsWith("@@index")) {
          const idxMatch = trimmed.match(/@@index\(\[([^\]]+)\]/);
          if (idxMatch) {
            indexes.push({
              type: "index",
              fields: idxMatch[1].split(",").map((f) => f.trim()),
            });
          }
        }
        if (trimmed.startsWith("@@unique")) {
          const uqMatch = trimmed.match(/@@unique\(\[([^\]]+)\]/);
          if (uqMatch) {
            indexes.push({
              type: "unique",
              fields: uqMatch[1].split(",").map((f) => f.trim()),
            });
          }
        }
        return;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) {
        return;
      }

      const fieldName = parts[0];
      let fieldType = parts[1];
      const isOptional = fieldType.endsWith("?");
      const isList = fieldType.endsWith("[]");
      fieldType = fieldType.replace(/[?\[\]]/g, "");

      const isPk = trimmed.includes("@id");
      const isUnique = trimmed.includes("@unique");
      const isFk = trimmed.includes("@relation");
      const hasDefault = trimmed.includes("@default");

      const primitiveTypes = new Set([
        "String", "Int", "Float", "Boolean", "DateTime",
        "BigInt", "Decimal", "Json", "Bytes",
      ]);

      if (!primitiveTypes.has(fieldType) && !isList) {
        relations.push({
          sourceTable: modelName,
          sourceField: fieldName,
          targetTable: fieldType,
          targetField: "id",
          type: "many_to_one",
        });
      }

      if (isList && !primitiveTypes.has(fieldType)) {
        relations.push({
          sourceTable: fieldType,
          sourceField: `${modelName.toLowerCase()}_id`,
          targetTable: modelName,
          targetField: "id",
          type: "one_to_many",
        });
        return;
      }

      fields.push({
        name: fieldName,
        type: mapPrismaType(fieldType),
        nullable: isOptional,
        isPrimaryKey: isPk,
        isUnique,
        isForeignKey: isFk,
        hasDefault,
      });
    });

    tables.push({
      name: modelName,
      fields,
      indexes,
      source: "prisma",
      sourceFile: filePath,
    });
  }

  const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  while ((match = enumRegex.exec(content)) !== null) {
    const enumName = match[1];
    const values = match[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//"));

    tables.push({
      name: enumName,
      fields: values.map((v) => ({
        name: v,
        type: "enum_value",
        nullable: false,
        isPrimaryKey: false,
        isUnique: false,
        isForeignKey: false,
        hasDefault: false,
      })),
      indexes: [],
      source: "prisma_enum",
      sourceFile: filePath,
    });
  }

  return { tables, relations };
}

function parseSqlSchema(filePath) {
  const tables = [];
  const relations = [];

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { tables, relations };
  }

  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(([^;]+)\)/gi;
  let match;

  while ((match = createTableRegex.exec(content)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const fields = [];
    const indexes = [];

    body.split(",").forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      const upperLine = line.toUpperCase();

      if (upperLine.startsWith("PRIMARY KEY")) {
        const pkMatch = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
        if (pkMatch) {
          const pkFields = pkMatch[1].split(",").map((f) => f.trim().replace(/[`"']/g, ""));
          pkFields.forEach((pkField) => {
            const existing = fields.find((f) => f.name === pkField);
            if (existing) {
              existing.isPrimaryKey = true;
            }
          });
        }
        return;
      }

      if (upperLine.startsWith("FOREIGN KEY") || upperLine.startsWith("CONSTRAINT")) {
        const fkMatch = line.match(/FOREIGN\s+KEY\s*\([`"']?(\w+)[`"']?\)\s*REFERENCES\s+[`"']?(\w+)[`"']?\s*\([`"']?(\w+)[`"']?\)/i);
        if (fkMatch) {
          relations.push({
            sourceTable: tableName,
            sourceField: fkMatch[1],
            targetTable: fkMatch[2],
            targetField: fkMatch[3],
            type: "foreign_key",
          });
          const existing = fields.find((f) => f.name === fkMatch[1]);
          if (existing) {
            existing.isForeignKey = true;
          }
        }
        return;
      }

      if (upperLine.startsWith("INDEX") || upperLine.startsWith("KEY") || upperLine.startsWith("UNIQUE")) {
        const idxMatch = line.match(/(?:UNIQUE\s+)?(?:INDEX|KEY)\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i);
        if (idxMatch) {
          indexes.push({
            type: upperLine.startsWith("UNIQUE") ? "unique" : "index",
            name: idxMatch[1],
            fields: idxMatch[2].split(",").map((f) => f.trim().replace(/[`"']/g, "")),
          });
        }
        return;
      }

      const colMatch = line.match(/^[`"']?(\w+)[`"']?\s+(\w+(?:\([^)]*\))?)/i);
      if (!colMatch) return;

      const fieldName = colMatch[1];
      const fieldType = colMatch[2];

      fields.push({
        name: fieldName,
        type: mapSqlType(fieldType),
        nullable: !upperLine.includes("NOT NULL"),
        isPrimaryKey: upperLine.includes("PRIMARY KEY") || upperLine.includes("AUTO_INCREMENT") || upperLine.includes("AUTOINCREMENT"),
        isUnique: upperLine.includes("UNIQUE"),
        isForeignKey: false,
        hasDefault: upperLine.includes("DEFAULT"),
      });
    });

    tables.push({
      name: tableName,
      fields,
      indexes,
      source: "sql",
      sourceFile: filePath,
    });
  }

  return { tables, relations };
}

function parseModelFile(filePath) {
  const tables = [];

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { tables };
  }

  const basename = path.basename(filePath, path.extname(filePath));
  const modelName = basename
    .replace(/\.(model|schema|entity)$/i, "")
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

  const fields = [];

  const propRegex = /(\w+)\s*[:=]\s*['"]?(string|number|boolean|int|integer|float|double|text|date|datetime|timestamp|varchar|bigint|decimal|json|uuid|blob)['"]?/gi;
  let propMatch;
  while ((propMatch = propRegex.exec(content)) !== null) {
    if (!fields.some((f) => f.name === propMatch[1])) {
      fields.push({
        name: propMatch[1],
        type: mapGenericType(propMatch[2]),
        nullable: false,
        isPrimaryKey: propMatch[1].toLowerCase() === "id",
        isUnique: propMatch[1].toLowerCase() === "id",
        isForeignKey: propMatch[1].toLowerCase().endsWith("_id") || propMatch[1].toLowerCase().endsWith("id"),
        hasDefault: false,
      });
    }
  }

  const typeRegex = /(\w+)\s*[?]?\s*:\s*(string|number|boolean|Date|bigint|any|object)\b/g;
  while ((propMatch = typeRegex.exec(content)) !== null) {
    if (!fields.some((f) => f.name === propMatch[1])) {
      fields.push({
        name: propMatch[1],
        type: mapGenericType(propMatch[2]),
        nullable: content.charAt(typeRegex.lastIndex - propMatch[0].length + propMatch[1].length) === "?",
        isPrimaryKey: propMatch[1].toLowerCase() === "id",
        isUnique: false,
        isForeignKey: propMatch[1].toLowerCase().endsWith("_id"),
        hasDefault: false,
      });
    }
  }

  if (fields.length > 0) {
    tables.push({
      name: modelName,
      fields,
      indexes: [],
      source: "model_file",
      sourceFile: filePath,
    });
  }

  return { tables };
}

function parseDjangoModels(filePath) {
  const tables = [];
  const relations = [];

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { tables, relations };
  }

  const classRegex = /class\s+(\w+)\s*\([\w.,\s]*models\.Model[\w.,\s]*\)\s*:/g;
  let classMatch;

  while ((classMatch = classRegex.exec(content)) !== null) {
    const className = classMatch[1];
    const classStart = classMatch.index + classMatch[0].length;

    let classEnd = content.length;
    const nextClassMatch = /\nclass\s+\w+/g;
    nextClassMatch.lastIndex = classStart;
    const nextClass = nextClassMatch.exec(content);
    if (nextClass) {
      classEnd = nextClass.index;
    }

    const classBody = content.substring(classStart, classEnd);
    const fields = [];

    const fieldRegex = /^\s{4}(\w+)\s*=\s*models\.(\w+)\s*\(([^)]*)\)/gm;
    let fieldMatch;

    while ((fieldMatch = fieldRegex.exec(classBody)) !== null) {
      const fieldName = fieldMatch[1];
      const djangoType = fieldMatch[2];
      const args = fieldMatch[3];

      const isFk = ["ForeignKey", "OneToOneField"].includes(djangoType);
      const isM2M = djangoType === "ManyToManyField";

      if (isFk || isM2M) {
        const targetMatch = args.match(/['"]?(\w+)['"]?/);
        if (targetMatch) {
          relations.push({
            sourceTable: className,
            sourceField: isFk ? `${fieldName}_id` : fieldName,
            targetTable: targetMatch[1] === "self" ? className : targetMatch[1],
            targetField: "id",
            type: isFk ? "foreign_key" : "many_to_many",
          });
        }
      }

      fields.push({
        name: isFk ? `${fieldName}_id` : fieldName,
        type: mapDjangoType(djangoType),
        nullable: args.includes("null=True"),
        isPrimaryKey: djangoType === "AutoField" || djangoType === "BigAutoField",
        isUnique: args.includes("unique=True"),
        isForeignKey: isFk,
        hasDefault: args.includes("default="),
      });
    }

    if (!fields.some((f) => f.isPrimaryKey)) {
      fields.unshift({
        name: "id",
        type: "int",
        nullable: false,
        isPrimaryKey: true,
        isUnique: true,
        isForeignKey: false,
        hasDefault: true,
      });
    }

    tables.push({
      name: className,
      fields,
      indexes: [],
      source: "django",
      sourceFile: filePath,
    });
  }

  return { tables, relations };
}

function findFilesByPattern(rootPath, pattern, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return [];

  let entries;
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];

  entries.forEach((entry) => {
    const fullPath = path.join(rootPath, entry.name);

    if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }

    if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) {
      results.push(...findFilesByPattern(fullPath, pattern, maxDepth, depth + 1));
    }
  });

  return results;
}

function mergeTables(target, source) {
  source.forEach((table) => {
    const existing = target.find(
      (t) => t.name.toLowerCase() === table.name.toLowerCase()
    );
    if (existing) {
      table.fields.forEach((field) => {
        if (!existing.fields.some((f) => f.name === field.name)) {
          existing.fields.push(field);
        }
      });
      existing.indexes.push(...(table.indexes || []));
    } else {
      target.push(table);
    }
  });
}

function mergeRelations(target, source) {
  source.forEach((rel) => {
    const exists = target.some(
      (r) =>
        r.sourceTable === rel.sourceTable &&
        r.sourceField === rel.sourceField &&
        r.targetTable === rel.targetTable &&
        r.targetField === rel.targetField
    );
    if (!exists) {
      target.push(rel);
    }
  });
}

function deduplicateRelations(relations) {
  const unique = new Map();
  relations.forEach((rel) => {
    const key = `${rel.sourceTable}::${rel.sourceField}::${rel.targetTable}::${rel.targetField}`;
    if (!unique.has(key)) {
      unique.set(key, rel);
    }
  });
  return [...unique.values()];
}

function mapPrismaType(prismaType) {
  const map = {
    String: "varchar",
    Int: "int",
    Float: "float",
    Boolean: "tinyint",
    DateTime: "datetime",
    BigInt: "bigint",
    Decimal: "decimal",
    Json: "json",
    Bytes: "blob",
  };
  return map[prismaType] || prismaType.toLowerCase();
}

function mapSqlType(sqlType) {
  const normalized = sqlType.toLowerCase().replace(/\([^)]*\)/, "");
  const map = {
    varchar: "varchar",
    char: "varchar",
    text: "text",
    int: "int",
    integer: "int",
    bigint: "bigint",
    smallint: "smallint",
    tinyint: "tinyint",
    float: "float",
    double: "double",
    decimal: "decimal",
    numeric: "decimal",
    boolean: "tinyint",
    bool: "tinyint",
    date: "date",
    datetime: "datetime",
    timestamp: "datetime",
    time: "time",
    json: "json",
    jsonb: "json",
    blob: "blob",
    uuid: "varchar",
    serial: "int",
    bigserial: "bigint",
  };
  return map[normalized] || normalized;
}

function mapGenericType(type) {
  const normalized = type.toLowerCase();
  const map = {
    string: "varchar",
    number: "int",
    boolean: "tinyint",
    int: "int",
    integer: "int",
    float: "float",
    double: "float",
    text: "text",
    date: "datetime",
    datetime: "datetime",
    timestamp: "datetime",
    varchar: "varchar",
    bigint: "bigint",
    decimal: "decimal",
    json: "json",
    uuid: "varchar",
    blob: "blob",
    any: "json",
    object: "json",
  };
  return map[normalized] || normalized;
}

function mapDjangoType(djangoType) {
  const map = {
    AutoField: "int",
    BigAutoField: "bigint",
    CharField: "varchar",
    TextField: "text",
    IntegerField: "int",
    BigIntegerField: "bigint",
    SmallIntegerField: "smallint",
    PositiveIntegerField: "int",
    FloatField: "float",
    DecimalField: "decimal",
    BooleanField: "tinyint",
    NullBooleanField: "tinyint",
    DateField: "date",
    DateTimeField: "datetime",
    TimeField: "time",
    EmailField: "varchar",
    URLField: "varchar",
    UUIDField: "varchar",
    FileField: "varchar",
    ImageField: "varchar",
    JSONField: "json",
    BinaryField: "blob",
    SlugField: "varchar",
    IPAddressField: "varchar",
    ForeignKey: "int?",
    OneToOneField: "int?",
    ManyToManyField: "m2m",
  };
  return map[djangoType] || djangoType.toLowerCase();
}

function resolveRealPath(inputPath) {
  try {
    const resolved = path.resolve(inputPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

function scanProjectPipeline(rootPath, options = {}) {
  const realRoot = resolveRealPath(rootPath);
  if (!realRoot) {
    throw new Error(`Path khong ton tai: ${rootPath}`);
  }

  const maxDepth = Number(options.maxDepth || 6);
  const maxFiles = Number(options.maxFiles || 220);
  const sourceFiles = collectSourceFiles(realRoot, maxDepth).slice(0, maxFiles);
  const sourceSet = new Set(sourceFiles);

  const files = sourceFiles.map((filePath) => analyzeSourceFile(filePath, realRoot));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const edges = [];

  files.forEach((file) => {
    file.importsResolved = file.imports
      .map((specifier) => resolveImportTarget(specifier, file.path, realRoot))
      .filter((candidate) => candidate && sourceSet.has(candidate) && filesByPath.has(candidate));

    file.resolvedImports = (file.importEntries || [])
      .map((entry) => {
        const targetPath = resolveImportTarget(entry.source, file.path, realRoot);
        if (!targetPath || !sourceSet.has(targetPath) || !filesByPath.has(targetPath)) {
          return null;
        }
        return {
          ...entry,
          targetPath,
        };
      })
      .filter(Boolean);

    file.importsResolved.forEach((targetPath) => {
      const target = filesByPath.get(targetPath);
      if (!target) {
        return;
      }
      edges.push({
        source: file.id,
        target: target.id,
        sourcePath: file.path,
        targetPath,
        type: "imports",
      });
    });
  });

  const uniqueEdges = deduplicatePipelineEdges(edges);
  const execution = buildExecutionTraces(files, filesByPath);
  const executionTraces = execution.traces;
  const inboundById = new Map();
  const outboundById = new Map();
  uniqueEdges.forEach((edge) => {
    inboundById.set(edge.target, (inboundById.get(edge.target) || 0) + 1);
    outboundById.set(edge.source, (outboundById.get(edge.source) || 0) + 1);
  });

  const nodes = files.map((file) => ({
    id: file.id,
    name: file.name,
    path: file.path,
    relativePath: file.relativePath,
    ext: file.ext,
    role: file.role,
    symbols: file.symbols || [],
    exportedSymbols: file.exportedSymbols || [],
    defaultExportSymbol: file.defaultExportSymbol || null,
    hasDefaultExport: Boolean(file.hasDefaultExport),
    callSites: file.callSites || [],
    routeDefs: file.routeDefs || [],
    titleColor: TABLE_COLORS[hashString(file.relativePath) % TABLE_COLORS.length],
    fields: buildPipelineFields(file, inboundById.get(file.id) || 0, outboundById.get(file.id) || 0),
    indexes: buildPipelineIndexes(file),
    inbound: inboundById.get(file.id) || 0,
    outbound: outboundById.get(file.id) || 0,
  }));

  const stageOrder = ["entry", "ui", "service", "repository", "domain", "data", "model", "support", "config", "unknown"];
  const stages = stageOrder
    .map((role) => ({
      role,
      label: roleToLabel(role),
      nodes: nodes.filter((node) => node.role === role).map((node) => node.id),
    }))
    .filter((stage) => stage.nodes.length);

  return {
    rootPath: realRoot,
    filesAnalyzed: files.length,
    importLinks: uniqueEdges.length,
    symbolCount: files.reduce((sum, file) => sum + (file.symbols?.length || 0), 0),
    traceCount: executionTraces.length,
    frameworkAdapters: detectFrameworkAdapters(files),
    nodes,
    edges: uniqueEdges,
    traces: executionTraces,
    callSiteGraph: execution.callSiteGraph,
    impact: execution.impact,
    stages,
    summary: `Scanned ${files.length} source files, extracted ${files.reduce((sum, file) => sum + (file.symbols?.length || 0), 0)} symbols, resolved ${uniqueEdges.length} local links, and found ${executionTraces.length} route traces.`,
  };
}

function collectSourceFiles(rootPath, maxDepth = 6, depth = 0) {
  if (depth > maxDepth) {
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  entries.forEach((entry) => {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        results.push(...collectSourceFiles(fullPath, maxDepth, depth + 1));
      }
      return;
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IGNORE_FILES.has(entry.name) && SOURCE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  });

  return results;
}

function analyzeSourceFile(filePath, rootPath) {
  const normalizedFilePath = path.normalize(filePath);
  let content = "";
  try {
    content = fs.readFileSync(normalizedFilePath, "utf8");
  } catch {
    content = "";
  }

  const ext = path.extname(normalizedFilePath).toLowerCase();
  const relativePath = path.relative(rootPath, normalizedFilePath) || path.basename(normalizedFilePath);
  const astInfo = extractAstInfo(content, normalizedFilePath, ext);
  const imports = astInfo.imports.length ? astInfo.imports : extractImports(content, ext);

  return {
    id: `pipe-${relativePath.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: path.basename(normalizedFilePath),
    path: normalizedFilePath,
    rootPath,
    relativePath,
    ext,
    imports,
    importEntries: astInfo.importEntries || [],
    exportEntries: astInfo.exportEntries || [],
    defaultExportSymbol: astInfo.defaultExportSymbol || null,
    hasDefaultExport: Boolean(astInfo.defaultExportSymbol || (astInfo.exportEntries || []).some((entry) => entry.kind === "default")),
    role: detectPipelineRole(relativePath, content),
    symbols: astInfo.symbols,
    exportedSymbols: astInfo.exportedSymbols,
    callSites: astInfo.callSites,
    routeDefs: astInfo.routeDefs || [],
  };
}

function extractAstInfo(content, filePath, ext) {
  if (!ts || ![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    return {
      imports: [],
      importEntries: [],
      exportEntries: [],
      defaultExportSymbol: null,
      symbols: [],
      exportedSymbols: [],
      callSites: [],
      routeDefs: [],
    };
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(ext)
  );

  const imports = new Set();
  const importEntries = [];
  const exportEntries = [];
  const symbols = [];
  const exportedSymbols = new Set();
  const callSites = new Set();
  const routeDefs = [];
  let defaultExportSymbol = null;

  const pushSymbol = (name, kind, node, extra = {}) => {
    if (!name) {
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const entry = {
      name,
      kind,
      line,
      exported: Boolean(extra.exported),
      async: Boolean(extra.async),
      container: extra.container || null,
      calls: [],
      callDetails: [],
      aliases: {},
      importRefs: [],
    };
    symbols.push(entry);
    if (entry.exported) {
      exportedSymbols.add(name);
    }
    return entry;
  };

  const addImportEntry = (entry) => {
    if (!entry || !entry.source) {
      return;
    }
    importEntries.push(entry);
  };

  const addExportEntry = (entry) => {
    if (!entry || !entry.kind) {
      return;
    }
    exportEntries.push(entry);
  };

  const getSymbolEntry = (symbolName) =>
    symbols.find((item) => item.name === symbolName || `${item.container}.${item.name}` === symbolName);

  const visit = (node, currentSymbolName = null) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.add(node.moduleSpecifier.text);
      const source = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) {
        addImportEntry({ local: clause.name.text, imported: "default", source, kind: "default" });
      }
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          addImportEntry({ local: clause.namedBindings.name.text, imported: "*", source, kind: "namespace" });
        } else if (ts.isNamedImports(clause.namedBindings)) {
          clause.namedBindings.elements.forEach((element) => {
            addImportEntry({
              local: element.name.text,
              imported: (element.propertyName || element.name).text,
              source,
              kind: "named",
            });
          });
        }
      }
    }

    if (ts.isExportDeclaration(node)) {
      const source = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
      if (!node.exportClause && source) {
        addExportEntry({ kind: "star", source });
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach((element) => {
          const local = (element.propertyName || element.name).text;
          const exported = element.name.text;
          addExportEntry({
            kind: "named",
            source,
            local,
            exported,
            imported: local,
          });
          exportedSymbols.add(exported);
        });
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      pushSymbol(node.name.text, "function", node, {
        exported: isNodeExported(node),
        async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
      });
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
        defaultExportSymbol = node.name.text;
        addExportEntry({
          kind: "default",
          source: null,
          local: node.name.text,
          exported: "default",
          imported: "default",
        });
      }
      ts.forEachChild(node, (child) => visit(child, node.name.text));
      return;
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushSymbol(node.name.text, "class", node, {
        exported: isNodeExported(node),
      });
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
        defaultExportSymbol = node.name.text;
        addExportEntry({
          kind: "default",
          source: null,
          local: node.name.text,
          exported: "default",
          imported: "default",
        });
      }
      const controllerBase = extractControllerBase(node);
      node.members.forEach((member) => {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          pushSymbol(member.name.text, "method", member, {
            container: node.name.text,
            async: hasModifier(member, ts.SyntaxKind.AsyncKeyword),
          });
          const routeDef = extractDecoratorRoute(member, controllerBase, node.name.text, sourceFile);
          if (routeDef) {
            routeDefs.push(routeDef);
          }
          ts.forEachChild(member, (child) => visit(child, `${node.name.text}.${member.name.text}`));
          return;
        }
        if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          pushSymbol(member.name.text, "property", member, {
            container: node.name.text,
          });
        }
      });
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(node.name.text, "interface", node, {
        exported: isNodeExported(node),
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(node.name.text, "type", node, {
        exported: isNodeExported(node),
      });
    } else if (ts.isEnumDeclaration(node)) {
      pushSymbol(node.name.text, "enum", node, {
        exported: isNodeExported(node),
      });
    } else if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((declaration) => {
        if (ts.isIdentifier(declaration.name)) {
          const initializer = declaration.initializer;
          const isFn =
            initializer &&
            (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
          pushSymbol(declaration.name.text, isFn ? "function-var" : "variable", declaration, {
            exported: isNodeExported(node),
            async: Boolean(initializer && "modifiers" in initializer && hasModifier(initializer, ts.SyntaxKind.AsyncKeyword)),
          });
          if (currentSymbolName) {
            const ownerSymbol = getSymbolEntry(currentSymbolName);
            const aliasTarget = extractAliasTarget(initializer);
            if (ownerSymbol && aliasTarget) {
              ownerSymbol.aliases[declaration.name.text] = aliasTarget;
            }
          }
          if (isFn && initializer) {
            ts.forEachChild(initializer, (child) => visit(child, declaration.name.text));
          }
        }
      });
    } else if (ts.isCallExpression(node)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const callDetail = getCallExpressionDetail(node.expression, sourceFile, line);
      if (callDetail?.name) {
        callSites.add(callDetail.displayName);
        const routeDef = extractRouteCall(node, currentSymbolName, sourceFile);
        if (routeDef) {
          routeDefs.push(routeDef);
        }
        const targetSymbol = getSymbolEntry(currentSymbolName);
        if (targetSymbol) {
          targetSymbol.calls.push(callDetail.name);
          targetSymbol.callDetails.push(callDetail);
        }
      }
    } else if (ts.isIdentifier(node) && currentSymbolName) {
      if (shouldTrackIdentifierReference(node)) {
        const ownerSymbol = getSymbolEntry(currentSymbolName);
        if (ownerSymbol && importEntries.some((entry) => entry.local === node.text)) {
          ownerSymbol.importRefs.push(node.text);
        }
      }
    } else if (ts.isExportAssignment(node)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const local = ts.isIdentifier(node.expression) ? node.expression.text : "default";
      defaultExportSymbol = local;
      addExportEntry({
        kind: "default",
        source: null,
        local,
        exported: "default",
        imported: "default",
        line,
      });
    }

    ts.forEachChild(node, (child) => visit(child, currentSymbolName));
  };

  visit(sourceFile);

  if (defaultExportSymbol && !exportedSymbols.has(defaultExportSymbol)) {
    exportedSymbols.add(defaultExportSymbol);
  } else if (!defaultExportSymbol && exportEntries.some((entry) => entry.kind === "default")) {
    exportedSymbols.add("default");
  }

  return {
    imports: [...imports],
    importEntries,
    exportEntries,
    defaultExportSymbol,
    symbols: deduplicateSymbols(symbols),
    exportedSymbols: [...exportedSymbols],
    callSites: [...callSites],
    routeDefs: deduplicateRouteDefs(routeDefs),
  };
}

function getScriptKind(ext) {
  switch (ext) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

function isNodeExported(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function getCallExpressionName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function getCallExpressionDetail(expression, sourceFile, line = null) {
  if (ts.isIdentifier(expression)) {
    return {
      name: expression.text,
      objectName: null,
      expression: expression.text,
      displayName: expression.text,
      memberName: expression.text,
      line,
    };
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const objectName = expression.expression.getText(sourceFile);
    const memberName = expression.name.text;
    return {
      name: memberName,
      objectName,
      expression: `${objectName}.${memberName}`,
      displayName: `${objectName}.${memberName}`,
      memberName,
      line,
    };
  }
  return null;
}

function extractAliasTarget(initializer) {
  if (!initializer) {
    return null;
  }
  if (ts.isNewExpression(initializer)) {
    return initializer.expression.getText();
  }
  if (ts.isIdentifier(initializer)) {
    return initializer.text;
  }
  if (ts.isPropertyAccessExpression(initializer)) {
    return initializer.getText();
  }
  return null;
}

function deduplicateSymbols(symbols) {
  const unique = new Map();
  symbols.forEach((symbol) => {
    const key = `${symbol.kind}:${symbol.container || "-"}:${symbol.name}:${symbol.line}`;
    if (!unique.has(key)) {
      symbol.importRefs = [...new Set(symbol.importRefs || [])];
      symbol.calls = [...new Set(symbol.calls || [])];
      unique.set(key, symbol);
    }
  });
  return [...unique.values()];
}

function shouldTrackIdentifierReference(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if (
    (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)) {
    return false;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return false;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return false;
  }
  return true;
}

function deduplicateRouteDefs(routeDefs) {
  const unique = new Map();
  routeDefs.forEach((route) => {
    const key = `${route.method}:${route.path}:${route.handlerSymbol}:${route.filePath}`;
    if (!unique.has(key)) {
      unique.set(key, route);
    }
  });
  return [...unique.values()];
}

function extractControllerBase(classNode) {
  const decorators = ts.canHaveDecorators(classNode) ? ts.getDecorators(classNode) || [] : [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "Controller") {
      const arg = expression.arguments[0];
      return extractLiteralPath(arg);
    }
  }
  return "";
}

function extractDecoratorRoute(methodNode, controllerBase, className, sourceFile) {
  const decorators = ts.canHaveDecorators(methodNode) ? ts.getDecorators(methodNode) || [] : [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
      continue;
    }
    const method = expression.expression.text.toLowerCase();
    if (!HTTP_METHODS.has(method)) {
      continue;
    }
    const routePath = extractLiteralPath(expression.arguments[0]);
    return {
      id: `route-${className}-${methodNode.name.getText(sourceFile)}-${method}-${routePath || "root"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      method: method.toUpperCase(),
      path: joinRoutePath(controllerBase, routePath),
      handlerSymbol: `${className}.${methodNode.name.getText(sourceFile)}`,
      handlerName: methodNode.name.getText(sourceFile),
      filePath: path.normalize(sourceFile.fileName),
      framework: "nest",
      line: sourceFile.getLineAndCharacterOfPosition(methodNode.getStart(sourceFile)).line + 1,
    };
  }
  return null;
}

function extractRouteCall(node, currentSymbolName, sourceFile) {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const methodName = node.expression.name.text.toLowerCase();
  if (!HTTP_METHODS.has(methodName)) {
    return null;
  }
  const objectName = node.expression.expression.getText(sourceFile);
  if (!/^(app|router|server|fastify|route)$/i.test(objectName)) {
    return null;
  }

  const args = node.arguments || [];
  const routePath = extractLiteralPath(args[0]) || "/";
  const handlerArg = args.find((arg, index) => index > 0 && (ts.isIdentifier(arg) || ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)));
  const handlerSymbol = ts.isIdentifier(handlerArg)
    ? handlerArg.text
    : currentSymbolName || `${methodName.toUpperCase()} ${routePath}`;
  const inlineCalls = handlerArg && (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg))
    ? extractInlineHandlerCalls(handlerArg)
    : [];

  return {
    id: `route-${methodName}-${routePath}-${handlerSymbol}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    method: methodName.toUpperCase(),
    path: routePath,
    handlerSymbol,
    handlerName: handlerSymbol,
    filePath: path.normalize(sourceFile.fileName),
    framework: "express",
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    inlineCalls,
  };
}

function extractInlineHandlerCalls(fnNode) {
  const calls = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callName = getCallExpressionName(node.expression);
      if (callName && !["json", "send", "status", "filter", "map", "forEach"].includes(callName)) {
        calls.add(callName);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fnNode.body, visit);
  return [...calls];
}

function extractLiteralPath(node) {
  if (!node) {
    return "";
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return "";
}

function joinRoutePath(basePath, routePath) {
  const left = String(basePath || "").replace(/\/+$/, "");
  const right = String(routePath || "").replace(/^\/+/, "");
  if (!left && !right) {
    return "/";
  }
  if (!left) {
    return `/${right}`;
  }
  if (!right) {
    return left.startsWith("/") ? left : `/${left}`;
  }
  return `${left.startsWith("/") ? left : `/${left}`}/${right}`;
}

function extractImports(content, ext) {
  const imports = new Set();
  const add = (value) => {
    if (value && typeof value === "string") {
      imports.add(value.trim());
    }
  };

  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    const importRegex = /import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/g;
    const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) add(match[1]);
    while ((match = requireRegex.exec(content)) !== null) add(match[1]);
  } else if (ext === ".py") {
    const fromRegex = /^\s*from\s+([a-zA-Z0-9_./]+)\s+import\s+/gm;
    const importRegex = /^\s*import\s+([a-zA-Z0-9_./]+)/gm;
    let match;
    while ((match = fromRegex.exec(content)) !== null) add(match[1]);
    while ((match = importRegex.exec(content)) !== null) add(match[1]);
  } else if (ext === ".php") {
    const useRegex = /^\s*use\s+([^;]+);/gm;
    const requireRegex = /(require|include)(?:_once)?\s*\(?\s*["']([^"']+)["']/gm;
    let match;
    while ((match = useRegex.exec(content)) !== null) add(match[1]);
    while ((match = requireRegex.exec(content)) !== null) add(match[2]);
  } else if (ext === ".java" || ext === ".go") {
    const importRegex = /^\s*import\s+(?:\(\s*)?["']?([^"'\s;]+)["']?/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) add(match[1]);
  }

  return [...imports];
}

function detectPipelineRole(relativePath, content) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();

  if (/(^|\/)(api|routes?|router|controllers?)(\/|$)/.test(normalized) || /app\.(t|j)sx?$|main\.(t|j)sx?$|server\.(t|j)sx?$/.test(normalized)) {
    return "entry";
  }
  if (/(^|\/)(pages?|views?|components?|ui|screens?)(\/|$)/.test(normalized)) {
    return "ui";
  }
  if (/(^|\/)(services?|usecases?|handlers?)(\/|$)/.test(normalized)) {
    return "service";
  }
  if (/(^|\/)(repositories?|repo|dao|stores?|queries|gateways)(\/|$)/.test(normalized)) {
    return "repository";
  }
  if (/(^|\/)(domain|core|logic|modules?)(\/|$)/.test(normalized)) {
    return "domain";
  }
  if (/(^|\/)(clients?|adapters?|db|database)(\/|$)/.test(normalized)) {
    return "data";
  }
  if (/(^|\/)(models?|entities?|schemas?|prisma|migrations?)(\/|$)/.test(normalized)) {
    return "model";
  }
  if (/(^|\/)(config|env|settings)(\/|$)/.test(normalized)) {
    return "config";
  }
  if (/(^|\/)(lib|utils?|hooks|shared|helpers?)(\/|$)/.test(normalized)) {
    return "support";
  }
  if (/express|router\.|app\.(get|post|put|delete)|fastify|nestjs/i.test(content)) {
    return "entry";
  }
  if (/repository|repo|dao|querybuilder|prisma\.[a-z]+|typeorm.*repository|sequelize.*model|mongoose.*model/i.test(content)) {
    return "repository";
  }
  if (/prisma|typeorm|sequelize|mongoose|sqlalchemy|django\.db/i.test(content)) {
    return "data";
  }
  return "unknown";
}

function resolveImportTarget(specifier, importerPath, rootPath) {
  if (!specifier) {
    return null;
  }

  const normalized = specifier.replaceAll("\\", "/");
  const candidates = [];

  if (normalized.startsWith(".")) {
    candidates.push(path.resolve(path.dirname(importerPath), normalized));
  } else if (normalized.startsWith("@/") || normalized.startsWith("~/")) {
    candidates.push(path.resolve(rootPath, normalized.slice(2)));
    candidates.push(path.resolve(rootPath, "src", normalized.slice(2)));
  } else if (normalized.startsWith("src/")) {
    candidates.push(path.resolve(rootPath, normalized));
  } else {
    return null;
  }

  for (const basePath of candidates) {
    const resolved = resolveModuleCandidate(basePath);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function resolveModuleCandidate(basePath) {
  const candidates = [basePath];
  SOURCE_EXTENSIONS.forEach((ext) => {
    candidates.push(`${basePath}${ext}`);
    candidates.push(path.join(basePath, `index${ext}`));
  });

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function deduplicatePipelineEdges(edges) {
  const unique = new Map();
  edges.forEach((edge) => {
    const key = `${edge.source}::${edge.target}::${edge.type}`;
    if (!unique.has(key)) {
      unique.set(key, edge);
    }
  });
  return [...unique.values()];
}

function buildExecutionTraces(files, filesByPath) {
  const symbolRegistry = buildSymbolRegistry(files);
  const exportRegistry = buildExportRegistry(files, filesByPath, symbolRegistry);
  const importRegistry = buildImportRegistry(files, filesByPath);
  const resolutionContext = {
    symbolRegistry,
    importRegistry,
    exportRegistry,
  };
  const traces = [];

  files.forEach((file) => {
    (file.routeDefs || []).forEach((routeDef) => {
      const rootSymbol = resolveSymbolReference(file, routeDef.handlerSymbol, resolutionContext);
      const visited = new Set();
      const steps = [];

      steps.push({
        kind: "route",
        label: `${routeDef.method} ${routeDef.path}`,
        role: "entry",
        filePath: routeDef.filePath,
        symbol: routeDef.handlerSymbol,
        line: routeDef.line,
      });

      if (routeDef.inlineCalls?.length) {
        const ownerFile = filesByPath.get(routeDef.filePath) || files.find((file) => file.path === routeDef.filePath);
        if (!ownerFile) {
          const compactSteps = compactTraceSteps(steps);
          traces.push({
            id: routeDef.id,
            method: routeDef.method,
            path: routeDef.path,
            framework: routeDef.framework,
            handlerSymbol: routeDef.handlerSymbol,
            filePath: routeDef.filePath,
            steps: compactSteps,
            lanes: buildTraceLanes(compactSteps),
            traceGraph: buildTraceGraph(compactSteps),
          });
          return;
        }
        routeDef.inlineCalls.forEach((callName) => {
          const nextSymbol = resolveSymbolReference(ownerFile, callName, resolutionContext);
          if (nextSymbol) {
            traceSymbolChain(nextSymbol, resolutionContext, visited, steps, 0);
          }
        });
      } else if (rootSymbol) {
        traceSymbolChain(rootSymbol, resolutionContext, visited, steps, 0);
      }

      const compactSteps = compactTraceSteps(steps);
      traces.push({
        id: routeDef.id,
        method: routeDef.method,
        path: routeDef.path,
        framework: routeDef.framework,
        handlerSymbol: routeDef.handlerSymbol,
        filePath: routeDef.filePath,
        steps: compactSteps,
        lanes: buildTraceLanes(compactSteps),
        traceGraph: buildTraceGraph(compactSteps),
      });
    });
  });

  const compactedTraces = traces.filter((trace) => trace.steps.length > 1);
  const callSiteGraph = buildCallSiteGraph(files, resolutionContext);

  return {
    traces: compactedTraces,
    callSiteGraph,
    impact: buildCallSiteImpact(callSiteGraph),
  };
}

function buildSymbolRegistry(files) {
  const registry = new Map();
  files.forEach((file) => {
    (file.symbols || []).forEach((symbol) => {
      const key = getSymbolRegistryKey(file.path, symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name);
      registry.set(key, {
        ...symbol,
        filePath: file.path,
        relativePath: file.relativePath,
        role: file.role,
      });

      if (symbol.container) {
        registry.set(getSymbolRegistryKey(file.path, symbol.name), {
          ...symbol,
          filePath: file.path,
          relativePath: file.relativePath,
          role: file.role,
        });
      }
    });
  });
  return registry;
}

function buildImportRegistry(files, filesByPath) {
  const registry = new Map();
  files.forEach((file) => {
    const localMap = new Map();
    (file.resolvedImports || []).forEach((entry) => {
      const targetFile = filesByPath.get(entry.targetPath);
      if (!targetFile) {
        return;
      }

      localMap.set(entry.local, {
        targetFilePath: targetFile.path,
        importedName: entry.imported,
        kind: entry.kind,
        local: entry.local,
        source: entry.source,
      });
    });
    registry.set(file.path, localMap);
  });
  return registry;
}

function buildExportRegistry(files, filesByPath, symbolRegistry) {
  const registry = new Map();
  files.forEach((file) => {
    const named = new Map();
    const stars = [];
    let defaultExport = null;

    (file.symbols || []).forEach((symbol) => {
      if (symbol.exported) {
        named.set(symbol.name, {
          type: "local",
          symbolName: symbol.name,
        });
      }
    });

    (file.exportEntries || []).forEach((entry) => {
      const resolvedTargetPath = entry.source
        ? resolveImportTarget(entry.source, file.path, file.rootPath || path.dirname(file.path))
        : null;

      if (entry.kind === "star" && resolvedTargetPath && filesByPath.has(resolvedTargetPath)) {
        stars.push(resolvedTargetPath);
        return;
      }

      if (entry.kind === "default") {
        if (resolvedTargetPath && filesByPath.has(resolvedTargetPath)) {
          defaultExport = {
            type: "reexport",
            targetFilePath: resolvedTargetPath,
            importedName: "default",
            importKind: "default",
          };
        } else {
          defaultExport = {
            type: "local",
            symbolName: entry.local || file.defaultExportSymbol || "default",
          };
        }
        return;
      }

      if (entry.kind === "named") {
        const exportedName = entry.exported || entry.local;
        if (!exportedName) {
          return;
        }
        if (resolvedTargetPath && filesByPath.has(resolvedTargetPath)) {
          named.set(exportedName, {
            type: "reexport",
            targetFilePath: resolvedTargetPath,
            importedName: entry.imported || entry.local || exportedName,
            importKind: entry.imported === "default" || entry.local === "default" ? "default" : "named",
          });
        } else {
          named.set(exportedName, {
            type: "local",
            symbolName: entry.local || exportedName,
          });
        }
      }
    });

    if (!defaultExport && file.defaultExportSymbol) {
      defaultExport = {
        type: "local",
        symbolName: file.defaultExportSymbol,
      };
    }

    registry.set(file.path, {
      named,
      stars,
      defaultExport,
    });
  });
  return registry;
}

function resolveSymbolReference(file, symbolName, resolutionContext) {
  if (!symbolName) {
    return null;
  }
  const { importRegistry, symbolRegistry } = resolutionContext;

  const local = resolveLocalSymbol(file.path, symbolName, symbolRegistry);
  if (local) return local;

  const simpleName = String(symbolName).split(".").pop();
  const simpleLocal = resolveLocalSymbol(file.path, simpleName, symbolRegistry);
  if (simpleLocal) return simpleLocal;

  const imports = importRegistry.get(file.path);
  if (!imports) {
    return null;
  }

  const ownerName = normalizeOwnerName(String(symbolName).includes(".") ? String(symbolName).split(".").slice(0, -1).join(".") : symbolName);
  const imported = imports.get(simpleName) || imports.get(symbolName) || (ownerName ? imports.get(ownerName) : null);
  if (!imported) {
    return null;
  }

  if (ownerName && String(symbolName).includes(".")) {
    return resolveImportedMember(imported, simpleName, resolutionContext);
  }

  return resolveImportedMember(imported, null, resolutionContext);
}

function traceSymbolChain(symbolRef, resolutionContext, visited, steps, depth) {
  if (!symbolRef || depth > 8) {
    return;
  }
  const { importRegistry } = resolutionContext;

  const visitKey = `${symbolRef.filePath}::${symbolRef.container || "-"}::${symbolRef.name}`;
  if (visited.has(visitKey)) {
    return;
  }
  visited.add(visitKey);

  steps.push({
    kind: "symbol",
    label: symbolRef.container ? `${symbolRef.container}.${symbolRef.name}` : symbolRef.name,
    role: symbolRef.role || "unknown",
    filePath: symbolRef.filePath,
    symbol: symbolRef.name,
    line: symbolRef.line,
  });

  const callerFileImports = importRegistry.get(symbolRef.filePath);
  const calls = symbolRef.callDetails?.length ? symbolRef.callDetails : (symbolRef.calls || []).map((callName) => ({ name: callName }));
  calls.forEach((callDetail) => {
    const nextSymbol = resolveNextSymbolFromCall(
      symbolRef,
      callDetail,
      callerFileImports,
      resolutionContext
    );
    if (nextSymbol) {
      traceSymbolChain(nextSymbol, resolutionContext, visited, steps, depth + 1);
    }
  });

  (symbolRef.importRefs || []).forEach((refName) => {
    const imported = callerFileImports?.get(refName);
    const nextSymbol = resolveImportedMember(imported, null, resolutionContext);
    if (nextSymbol) {
      traceSymbolChain(nextSymbol, resolutionContext, visited, steps, depth + 1);
    }
  });
}

function resolveNextSymbolFromCall(symbolRef, callDetail, callerFileImports, resolutionContext) {
  const { symbolRegistry } = resolutionContext;
  const callName = callDetail?.name;
  if (!callName) {
    return null;
  }

  let nextSymbol = symbolRegistry.get(getSymbolRegistryKey(symbolRef.filePath, callName));
  if (!nextSymbol && symbolRef.container) {
    nextSymbol = symbolRegistry.get(getSymbolRegistryKey(symbolRef.filePath, `${symbolRef.container}.${callName}`));
  }
  if (nextSymbol) {
    return nextSymbol;
  }

  const ownerName = normalizeOwnerName(callDetail.objectName);
  if (ownerName) {
    const aliasTarget = symbolRef.aliases?.[ownerName];
    if (aliasTarget) {
      const aliased = resolveAliasedMember(symbolRef.filePath, aliasTarget, callName, callerFileImports, resolutionContext);
      if (aliased) {
        return aliased;
      }
    }

    const importedOwner = callerFileImports?.get(ownerName);
    if (importedOwner) {
      const imported = resolveImportedMember(importedOwner, callName, resolutionContext);
      if (imported) {
        return imported;
      }
    }

    const directOwner = symbolRegistry.get(getSymbolRegistryKey(symbolRef.filePath, ownerName));
    if (directOwner?.kind === "class") {
      return (
        symbolRegistry.get(getSymbolRegistryKey(symbolRef.filePath, `${directOwner.name}.${callName}`)) ||
        symbolRegistry.get(getSymbolRegistryKey(symbolRef.filePath, callName))
      );
    }
  }

  if (callerFileImports?.has(callName)) {
    const imported = callerFileImports.get(callName);
    return resolveImportedMember(imported, null, resolutionContext);
  }

  return null;
}

function resolveAliasedMember(filePath, aliasTarget, memberName, callerFileImports, resolutionContext) {
  const { symbolRegistry } = resolutionContext;
  const normalizedTarget = String(aliasTarget || "").split(".").pop();
  const localClass = symbolRegistry.get(getSymbolRegistryKey(filePath, normalizedTarget));
  if (localClass?.kind === "class") {
    return (
      symbolRegistry.get(getSymbolRegistryKey(filePath, `${localClass.name}.${memberName}`)) ||
      symbolRegistry.get(getSymbolRegistryKey(filePath, memberName))
    );
  }

  const importedTarget = callerFileImports?.get(normalizedTarget);
  if (importedTarget) {
    return resolveImportedMember(importedTarget, memberName, resolutionContext);
  }

  return null;
}

function resolveImportedMember(imported, memberName, resolutionContext) {
  const { symbolRegistry } = resolutionContext;
  if (!imported?.targetFilePath) {
    return null;
  }

  if (imported.kind === "namespace" && memberName) {
    return resolveExportedSymbol(imported.targetFilePath, memberName, resolutionContext);
  }

  if (memberName) {
    if (imported.importedName) {
      const rootSymbol = imported.kind === "default"
        ? resolveExportedSymbol(imported.targetFilePath, "default", resolutionContext)
        : resolveExportedSymbol(imported.targetFilePath, imported.importedName, resolutionContext);

      const importedClass =
        rootSymbol ||
        resolveLocalSymbol(imported.targetFilePath, imported.importedName, symbolRegistry);
      if (importedClass?.kind === "class") {
        return (
          symbolRegistry.get(getSymbolRegistryKey(imported.targetFilePath, `${importedClass.name}.${memberName}`)) ||
          symbolRegistry.get(getSymbolRegistryKey(imported.targetFilePath, memberName))
        );
      }
    }

    return (
      resolveExportedSymbol(imported.targetFilePath, memberName, resolutionContext) ||
      resolveLocalSymbol(imported.targetFilePath, memberName, symbolRegistry) ||
      null
    );
  }

  if (imported.kind === "default") {
    return resolveExportedSymbol(imported.targetFilePath, "default", resolutionContext);
  }

  if (imported.importedName) {
    return resolveExportedSymbol(imported.targetFilePath, imported.importedName, resolutionContext) || null;
  }

  return null;
}

function resolveExportedSymbol(filePath, exportName, resolutionContext, visited = new Set()) {
  if (!filePath || !exportName) {
    return null;
  }
  const key = `${filePath}::${exportName}`;
  if (visited.has(key)) {
    return null;
  }
  visited.add(key);

  const { exportRegistry, symbolRegistry } = resolutionContext;
  const fileExports = exportRegistry.get(filePath);
  if (!fileExports) {
    return resolveLocalSymbol(filePath, exportName, symbolRegistry);
  }

  if (exportName === "default" && fileExports.defaultExport) {
    const entry = fileExports.defaultExport;
    if (entry.type === "local") {
      return resolveLocalSymbol(filePath, entry.symbolName, symbolRegistry);
    }
    return resolveExportedSymbol(entry.targetFilePath, entry.importedName || "default", resolutionContext, visited);
  }

  const namedEntry = fileExports.named.get(exportName);
  if (namedEntry) {
    if (namedEntry.type === "local") {
      return resolveLocalSymbol(filePath, namedEntry.symbolName || exportName, symbolRegistry);
    }
    const importedName = namedEntry.importKind === "default" ? "default" : (namedEntry.importedName || exportName);
    return resolveExportedSymbol(namedEntry.targetFilePath, importedName, resolutionContext, visited);
  }

  for (const starTarget of fileExports.stars || []) {
    const starResolved = resolveExportedSymbol(starTarget, exportName, resolutionContext, visited);
    if (starResolved) {
      return starResolved;
    }
  }

  return resolveLocalSymbol(filePath, exportName, symbolRegistry);
}

function resolveLocalSymbol(filePath, symbolName, symbolRegistry) {
  if (!filePath || !symbolName) {
    return null;
  }
  const normalized = String(symbolName);
  const candidates = [
    normalized,
    normalized.split(".").pop(),
  ];
  for (const candidate of candidates) {
    const exact = symbolRegistry.get(getSymbolRegistryKey(filePath, candidate));
    if (exact) {
      return exact;
    }
  }
  return null;
}

function buildCallSiteGraph(files, resolutionContext) {
  const { symbolRegistry, importRegistry } = resolutionContext;
  const nodes = new Map();
  const edges = new Map();

  symbolRegistry.forEach((symbolRef) => {
    if (!symbolRef?.name || !symbolRef?.filePath) {
      return;
    }
    const sourceNode = toCallSiteNode(symbolRef);
    nodes.set(sourceNode.id, sourceNode);
    const callerFileImports = importRegistry.get(symbolRef.filePath);
    const calls = symbolRef.callDetails?.length ? symbolRef.callDetails : (symbolRef.calls || []).map((name) => ({ name }));
    calls.forEach((callDetail) => {
      const target = resolveNextSymbolFromCall(symbolRef, callDetail, callerFileImports, resolutionContext);
      if (!target) {
        return;
      }
      const targetNode = toCallSiteNode(target);
      nodes.set(targetNode.id, targetNode);
      const line = Number(callDetail?.line || 0) || sourceNode.line || 0;
      const edgeId = `${sourceNode.id}=>${targetNode.id}@${line}:${callDetail?.expression || callDetail?.name || "call"}`;
      if (!edges.has(edgeId)) {
        edges.set(edgeId, {
          id: edgeId,
          source: sourceNode.id,
          target: targetNode.id,
          type: "call-site",
          callName: callDetail?.name || "",
          expression: callDetail?.expression || callDetail?.name || "",
          line: line || null,
          filePath: symbolRef.filePath,
        });
      }
    });
  });

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function toCallSiteNode(symbolRef) {
  const symbolLabel = symbolRef.container ? `${symbolRef.container}.${symbolRef.name}` : symbolRef.name;
  return {
    id: `${symbolRef.filePath}::${symbolLabel}`,
    label: symbolLabel,
    symbol: symbolRef.name,
    kind: symbolRef.kind || "symbol",
    role: symbolRef.role || "unknown",
    filePath: symbolRef.filePath,
    line: symbolRef.line || null,
  };
}

function buildCallSiteImpact(callSiteGraph) {
  const inbound = new Map();
  const outbound = new Map();
  (callSiteGraph.edges || []).forEach((edge) => {
    outbound.set(edge.source, (outbound.get(edge.source) || 0) + 1);
    inbound.set(edge.target, (inbound.get(edge.target) || 0) + 1);
  });

  const nodes = (callSiteGraph.nodes || []).map((node) => ({
    ...node,
    callers: inbound.get(node.id) || 0,
    callees: outbound.get(node.id) || 0,
    score: (inbound.get(node.id) || 0) * 2 + (outbound.get(node.id) || 0),
  }));

  return {
    totalSymbols: nodes.length,
    totalCallSites: (callSiteGraph.edges || []).length,
    hotSpots: nodes
      .sort((left, right) => right.score - left.score)
      .slice(0, 25),
  };
}

function detectFrameworkAdapters(files) {
  const summarize = (regex) => {
    const matched = files.filter((file) => {
      const imports = (file.imports || []).join(" ").toLowerCase();
      const symbols = (file.callSites || []).join(" ").toLowerCase();
      return regex.test(`${imports} ${symbols}`);
    });
    return {
      enabled: matched.length > 0,
      files: matched.slice(0, 20).map((item) => item.path),
      count: matched.length,
    };
  };

  return {
    express: summarize(/\bexpress\b|\brouter\b|\bapp\.(get|post|put|delete|patch)\b/),
    nest: summarize(/@nestjs|controller|injectable|nestjs/),
    prisma: summarize(/@prisma\/client|\bprisma\./),
    typeorm: summarize(/\btypeorm\b|createquerybuilder|repository</),
    mongoose: summarize(/\bmongoose\b|schema\(|model\(/),
  };
}

function normalizeOwnerName(objectName) {
  if (!objectName) {
    return null;
  }
  const trimmed = String(objectName).trim();
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.split(".").pop() || null;
}

function compactTraceSteps(steps) {
  const compacted = [];
  const seen = new Set();
  steps.forEach((step) => {
    const key = `${step.kind}:${step.filePath}:${step.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      compacted.push(step);
    }
  });
  return compacted;
}

function buildTraceLanes(steps) {
  const laneOrder = ["entry", "service", "repository", "model", "domain", "support", "config", "unknown"];
  const grouped = new Map(laneOrder.map((lane) => [lane, []]));

  steps.forEach((step, index) => {
    const lane = getTraceLane(step);
    grouped.get(lane)?.push({
      ...step,
      lane,
      order: index,
    });
  });

  return laneOrder
    .map((lane) => ({
      lane,
      label: roleToLabel(lane),
      steps: grouped.get(lane) || [],
    }))
    .filter((lane) => lane.steps.length);
}

function buildTraceGraph(steps) {
  const laneOrder = ["entry", "service", "repository", "model", "domain", "support", "config", "unknown"];
  const lanePositions = new Map(laneOrder.map((lane, index) => [lane, index]));
  const laneCounts = new Map();
  const nodes = [];
  const edges = [];
  const nodesByKey = new Map();

  steps.forEach((step, index) => {
    const lane = getTraceLane(step);
    const key = `${step.kind}:${step.filePath}:${step.label}:${step.line || 0}`;
    if (!nodesByKey.has(key)) {
      const row = laneCounts.get(lane) || 0;
      laneCounts.set(lane, row + 1);
      const node = {
        id: `trace-node-${index}-${Math.abs(hashString(key))}`,
        key,
        label: step.label,
        lane,
        laneLabel: roleToLabel(lane),
        role: step.role || lane,
        kind: step.kind,
        filePath: step.filePath,
        symbol: step.symbol || null,
        line: step.line || null,
        order: index,
        x: lanePositions.has(lane) ? lanePositions.get(lane) : laneOrder.length - 1,
        y: row,
      };
      nodesByKey.set(key, node);
      nodes.push(node);
    }

    if (index > 0) {
      const prev = steps[index - 1];
      const prevKey = `${prev.kind}:${prev.filePath}:${prev.label}:${prev.line || 0}`;
      const sourceNode = nodesByKey.get(prevKey);
      const targetNode = nodesByKey.get(key);
      if (sourceNode && targetNode && sourceNode.id !== targetNode.id) {
        edges.push({
          id: `trace-edge-${sourceNode.id}-${targetNode.id}`,
          source: sourceNode.id,
          target: targetNode.id,
          sourceLane: sourceNode.lane,
          targetLane: targetNode.lane,
          type: "flow",
        });
      }
    }
  });

  return {
    nodes,
    edges: deduplicateTraceEdges(edges),
  };
}

function deduplicateTraceEdges(edges) {
  const unique = new Map();
  edges.forEach((edge) => {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    if (!unique.has(key)) {
      unique.set(key, edge);
    }
  });
  return [...unique.values()];
}

function getTraceLane(step) {
  const role = step.role || "unknown";
  const label = `${step.label || ""} ${step.filePath || ""}`.toLowerCase();

  if (role === "entry" || step.kind === "route") return "entry";
  if (role === "service" || /service|usecase|handler/.test(label)) return "service";
  if (role === "repository" || role === "data" || /(^|[^a-z])(repo|repository|dao|query|prisma|sequelize|typeorm|mongoose|db|database)([^a-z]|$)/.test(label)) return "repository";
  if (role === "model" || /model|entity|schema|table/.test(label)) return "model";
  if (role === "domain") return "domain";
  if (role === "support") return "support";
  if (role === "config") return "config";
  return "unknown";
}

function getSymbolRegistryKey(filePath, symbolName) {
  return `${filePath}::${symbolName}`;
}

function buildPipelineFields(file, inbound, outbound) {
  const rows = [
    { name: file.relativePath, type: file.role, isPrimaryKey: true, isForeignKey: false },
    { name: "symbols", type: String(file.symbols?.length || 0), isPrimaryKey: false, isForeignKey: false },
    { name: "exports", type: String(file.exportedSymbols?.length || 0), isPrimaryKey: false, isForeignKey: true },
    { name: "calls", type: String(file.callSites?.length || 0), isPrimaryKey: false, isForeignKey: false },
    { name: "imports", type: String(file.imports.length), isPrimaryKey: false, isForeignKey: true },
    { name: "inbound", type: String(inbound), isPrimaryKey: false, isForeignKey: false },
    { name: "outbound", type: String(outbound), isPrimaryKey: false, isForeignKey: false },
  ];

  (file.symbols || []).slice(0, 5).forEach((symbol) => {
    rows.push({
      name: truncateValue(symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name, 36),
      type: symbol.kind,
      isPrimaryKey: Boolean(symbol.exported),
      isForeignKey: false,
    });
  });

  if (rows.length < 9) {
    file.imports.slice(0, 4).forEach((item) => {
      rows.push({
        name: truncateValue(item, 36),
        type: "import",
        isPrimaryKey: false,
        isForeignKey: true,
      });
    });
  }

  return rows.slice(0, 10);
}

function buildPipelineIndexes(file) {
  const indexes = [
    {
      type: "role",
      fields: [file.role],
    },
    {
      type: "ext",
      fields: [file.ext.replace(".", "") || "file"],
    },
  ];

  if (file.exportedSymbols?.length) {
    indexes.push({
      type: "exports",
      fields: file.exportedSymbols.slice(0, 3),
    });
  }

  if (file.callSites?.length) {
    indexes.push({
      type: "calls",
      fields: file.callSites.slice(0, 3),
    });
  }

  return indexes;
}

function roleToLabel(role) {
  const labels = {
    entry: "Entry / Route",
    ui: "UI / View",
    service: "Service",
    domain: "Domain",
    data: "Data / Repository",
    repository: "Repository / Data",
    model: "Model / Schema",
    support: "Shared / Utils",
    config: "Config",
    unknown: "Unknown",
  };
  return labels[role] || role;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
}

function truncateValue(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

module.exports = {
  scanDirectoryTree,
  scanProjectSchema,
  scanProjectPipeline,
};
