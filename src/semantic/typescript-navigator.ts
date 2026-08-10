import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { SymbolLocation } from "../types";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", ".lca", "coverage", "build"]);

export class TypeScriptNavigator {
  async findDefinitions(workspaceRoot: string, symbolName: string): Promise<SymbolLocation[]> {
    const files = await collectTypeScriptFiles(workspaceRoot);
    if (files.length === 0) {
      return [];
    }

    const service = await createLanguageService(workspaceRoot, files);
    const results: SymbolLocation[] = [];

    for (const filePath of files) {
      const sourceFile = service.program.getSourceFile(filePath);
      if (!sourceFile) {
        continue;
      }

      for (const identifierPos of collectIdentifierPositions(sourceFile, symbolName)) {
        const definitions = service.languageService.getDefinitionAtPosition(filePath, identifierPos) ?? [];
        for (const definition of definitions) {
          const location = toDefinitionLocation(workspaceRoot, service.program, symbolName, definition);
          if (location) {
            results.push(location);
          }
        }
      }
    }

    return dedupeAndSort(results);
  }

  async findReferences(workspaceRoot: string, symbolName: string): Promise<SymbolLocation[]> {
    const files = await collectTypeScriptFiles(workspaceRoot);
    if (files.length === 0) {
      return [];
    }

    const service = await createLanguageService(workspaceRoot, files);
    const results: SymbolLocation[] = [];

    for (const filePath of files) {
      const sourceFile = service.program.getSourceFile(filePath);
      if (!sourceFile) {
        continue;
      }

      for (const identifierPos of collectIdentifierPositions(sourceFile, symbolName)) {
        const references = service.languageService.getReferencesAtPosition(filePath, identifierPos) ?? [];
        for (const reference of references) {
          const location = toReferenceLocation(workspaceRoot, service.program, symbolName, reference as ts.ReferenceEntry);
          if (location) {
            results.push(location);
          }
        }
      }
    }

    return dedupeAndSort(results);
  }
}

function toDefinitionLocation(
  workspaceRoot: string,
  program: ts.Program,
  symbolName: string,
  definition: ts.DefinitionInfo
): SymbolLocation | null {
  const sourceFile = program.getSourceFile(definition.fileName);
  if (!sourceFile || !isWorkspaceTypeScriptFile(workspaceRoot, definition.fileName)) {
    return null;
  }

  const lc = sourceFile.getLineAndCharacterOfPosition(definition.textSpan.start);
  return {
    language: "typescript",
    symbol: symbolName,
    kind: "definition",
    role: definition.kind,
    relativePath: toRelativePath(workspaceRoot, definition.fileName),
    line: lc.line + 1,
    column: lc.character + 1,
    confidence: "high",
    source: "typescript-compiler-api"
  };
}

function toReferenceLocation(
  workspaceRoot: string,
  program: ts.Program,
  symbolName: string,
  reference: ts.ReferenceEntry
): SymbolLocation | null {
  const sourceFile = program.getSourceFile(reference.fileName);
  if (!sourceFile || !isWorkspaceTypeScriptFile(workspaceRoot, reference.fileName)) {
    return null;
  }

  const lc = sourceFile.getLineAndCharacterOfPosition(reference.textSpan.start);
  const isDefinition = isReferenceDefinition(reference) || isDeclarationIdentifierAtPosition(sourceFile, reference.textSpan.start);
  return {
    language: "typescript",
    symbol: symbolName,
    kind: "reference",
    role: isDefinition ? "definition-reference" : "reference",
    relativePath: toRelativePath(workspaceRoot, reference.fileName),
    line: lc.line + 1,
    column: lc.character + 1,
    confidence: isDefinition ? "high" : "medium",
    source: "typescript-compiler-api"
  };
}

function isReferenceDefinition(reference: ts.ReferenceEntry): boolean {
  const maybeWithFlag = reference as ts.ReferenceEntry & { isDefinition?: boolean };
  return maybeWithFlag.isDefinition === true;
}

function isDeclarationIdentifierAtPosition(sourceFile: ts.SourceFile, position: number): boolean {
  let matched = false;

  const visit = (node: ts.Node): void => {
    if (matched) {
      return;
    }

    if (position < node.getStart(sourceFile) || position >= node.getEnd()) {
      return;
    }

    if (ts.isIdentifier(node) && node.getStart(sourceFile) === position) {
      const parent = node.parent;
      matched =
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isClassDeclaration(parent) && parent.name === node) ||
        (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
        (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
        (ts.isEnumDeclaration(parent) && parent.name === node) ||
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return matched;
}

function collectIdentifierPositions(sourceFile: ts.SourceFile, symbolName: string): number[] {
  const output: number[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === symbolName) {
      output.push(node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return output;
}

async function createLanguageService(workspaceRoot: string, filePaths: string[]): Promise<{
  languageService: ts.LanguageService;
  program: ts.Program;
}> {
  const versions = new Map<string, string>();
  const snapshots = new Map<string, ts.IScriptSnapshot>();

  await Promise.all(
    filePaths.map(async (filePath) => {
      const text = await fs.readFile(filePath, "utf8");
      versions.set(filePath, "1");
      snapshots.set(filePath, ts.ScriptSnapshot.fromString(text));
    })
  );

  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    skipLibCheck: true,
    noEmit: true
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => filePaths,
    getScriptVersion: (fileName) => versions.get(fileName) ?? "1",
    getScriptSnapshot: (fileName) => {
      const existing = snapshots.get(fileName);
      if (existing) {
        return existing;
      }
      if (!ts.sys.fileExists(fileName)) {
        return undefined;
      }
      const raw = ts.sys.readFile(fileName);
      if (raw === undefined) {
        return undefined;
      }
      return ts.ScriptSnapshot.fromString(raw);
    },
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => workspaceRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };

  const languageService = ts.createLanguageService(host);
  const program = languageService.getProgram();
  if (!program) {
    throw new Error("Unable to initialize TypeScript program for semantic navigation.");
  }

  return { languageService, program };
}

async function collectTypeScriptFiles(workspaceRoot: string): Promise<string[]> {
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

    if (TS_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(absolutePath);
    }
  }
}

function isWorkspaceTypeScriptFile(workspaceRoot: string, fileName: string): boolean {
  const absolute = path.resolve(fileName);
  const root = path.resolve(workspaceRoot);
  if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) {
    return false;
  }
  return TS_EXTENSIONS.has(path.extname(absolute).toLowerCase());
}

function toRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
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
