import fs from "node:fs/promises";
import path from "node:path";

import type { SymbolLocation } from "../types";

const PYTHON_EXTENSION = ".py";
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", ".lca", "coverage", "build", "__pycache__", ".venv", "venv"]);

interface PythonSymbolMatch {
  kind: "definition" | "reference";
  role: string;
  line: number;
  column: number;
  confidence: "high" | "medium" | "low";
  source: string;
}

export class PythonNavigator {
  async findDefinitions(workspaceRoot: string, symbolName: string): Promise<SymbolLocation[]> {
    const files = await collectPythonFiles(workspaceRoot);
    const output: SymbolLocation[] = [];

    for (const absolutePath of files) {
      const content = await safeReadFile(absolutePath);
      if (content === null) {
        continue;
      }

      const matches = extractSymbolMatches(content, symbolName, "definition");
      for (const match of matches) {
        output.push(toSymbolLocation(workspaceRoot, absolutePath, symbolName, match));
      }
    }

    return dedupeAndSort(output);
  }

  async findReferences(workspaceRoot: string, symbolName: string): Promise<SymbolLocation[]> {
    const files = await collectPythonFiles(workspaceRoot);
    const output: SymbolLocation[] = [];

    for (const absolutePath of files) {
      const content = await safeReadFile(absolutePath);
      if (content === null) {
        continue;
      }

      const matches = extractSymbolMatches(content, symbolName, "reference");
      for (const match of matches) {
        output.push(toSymbolLocation(workspaceRoot, absolutePath, symbolName, match));
      }
    }

    return dedupeAndSort(output);
  }
}

function extractSymbolMatches(content: string, symbolName: string, mode: "definition" | "reference"): PythonSymbolMatch[] {
  const lines = content.split(/\r?\n/);
  const matches: PythonSymbolMatch[] = [];
  const normalizedSymbol = escapeRegExp(symbolName);
  const definitionRegexes: [RegExp, RegExp, RegExp] = [
    new RegExp(`^\\s*def\\s+${normalizedSymbol}\\b`),
    new RegExp(`^\\s*class\\s+${normalizedSymbol}\\b`),
    new RegExp(`^\\s*${normalizedSymbol}\\s*=`, "u")
  ];

  const symbolRegex = new RegExp(`\\b${normalizedSymbol}\\b`, "g");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("#")) {
      continue;
    }

    const definitionRole = classifyDefinition(rawLine, definitionRegexes);
    const symbolMentions = collectSymbolColumns(rawLine, symbolRegex);

    if (mode === "definition") {
      if (!definitionRole || symbolMentions.length === 0) {
        continue;
      }
      const firstColumn = symbolMentions[0];
      if (firstColumn === undefined) {
        continue;
      }
      matches.push({
        kind: "definition",
        role: definitionRole,
        line: lineNumber,
        column: firstColumn,
        confidence: definitionRole === "assignment" ? "medium" : "high",
        source: "python-heuristic"
      });
      continue;
    }

    if (symbolMentions.length === 0) {
      continue;
    }

    for (const column of symbolMentions) {
      if (definitionRole) {
        matches.push({
          kind: "reference",
          role: "definition-reference",
          line: lineNumber,
          column,
          confidence: "medium",
          source: "python-heuristic"
        });
      } else if (isLikelyImportLine(rawLine)) {
        matches.push({
          kind: "reference",
          role: "import-reference",
          line: lineNumber,
          column,
          confidence: "medium",
          source: "python-heuristic"
        });
      } else {
        matches.push({
          kind: "reference",
          role: "reference",
          line: lineNumber,
          column,
          confidence: "low",
          source: "python-heuristic"
        });
      }
    }
  }

  return matches;
}

function classifyDefinition(rawLine: string, definitionRegexes: readonly [RegExp, RegExp, RegExp]): string | null {
  if (definitionRegexes[0].test(rawLine)) {
    return "function";
  }
  if (definitionRegexes[1].test(rawLine)) {
    return "class";
  }
  if (definitionRegexes[2].test(rawLine)) {
    return "assignment";
  }
  return null;
}

function collectSymbolColumns(rawLine: string, symbolRegex: RegExp): number[] {
  const columns: number[] = [];
  const lineWithoutStringLiterals = rawLine.replace(/(['"])(?:(?=(\\?))\2.)*?\1/g, " ");
  const lineWithoutComments = lineWithoutStringLiterals.replace(/#.*/, "");

  symbolRegex.lastIndex = 0;
  for (;;) {
    const match = symbolRegex.exec(lineWithoutComments);
    if (!match) {
      break;
    }
    if (typeof match.index === "number") {
      columns.push(match.index + 1);
    }
  }

  return columns;
}

function isLikelyImportLine(rawLine: string): boolean {
  const trimmed = rawLine.trimStart();
  return trimmed.startsWith("import ") || trimmed.startsWith("from ");
}

function toSymbolLocation(
  workspaceRoot: string,
  absolutePath: string,
  symbolName: string,
  match: PythonSymbolMatch
): SymbolLocation {
  return {
    language: "python",
    symbol: symbolName,
    kind: match.kind,
    role: match.role,
    relativePath: path.relative(workspaceRoot, absolutePath).split(path.sep).join("/"),
    line: match.line,
    column: match.column,
    confidence: match.confidence,
    source: match.source
  };
}

async function collectPythonFiles(workspaceRoot: string): Promise<string[]> {
  const output: string[] = [];
  await walk(workspaceRoot, output);
  output.sort();
  return output;
}

async function walk(currentDir: string, output: string[]): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      await walk(absolutePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (path.extname(entry.name).toLowerCase() === PYTHON_EXTENSION) {
      output.push(absolutePath);
    }
  }
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function dedupeAndSort(items: SymbolLocation[]): SymbolLocation[] {
  const seen = new Set<string>();
  const unique: SymbolLocation[] = [];

  for (const item of items) {
    const key = [item.language, item.kind, item.relativePath, item.line, item.column, item.role].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  unique.sort((a, b) => {
    if (a.relativePath !== b.relativePath) {
      return a.relativePath.localeCompare(b.relativePath);
    }
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    if (a.column !== b.column) {
      return a.column - b.column;
    }
    return a.role.localeCompare(b.role);
  });

  return unique;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
