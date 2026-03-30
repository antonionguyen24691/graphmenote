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

module.exports = {
  scanDirectoryTree,
  scanProjectSchema,
};
