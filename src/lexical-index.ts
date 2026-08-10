import fs from "node:fs/promises";
import path from "node:path";

import { INDEX_FILE_NAME, dataFilePath } from "./config";
import { pathExists, readJsonFile, writeJsonFile } from "./fs-utils";
import { tokenFrequency, tokenize } from "./tokenizer";
import type {
  FileCandidate,
  FileIndexRecord,
  PersistedLexicalIndex,
  QueryResult,
  RankedSnippet,
  SnippetRecord
} from "./types";

const INDEX_VERSION = 1;
const SNIPPET_LINE_WINDOW = 20;

interface QueryOptions {
  topK?: number;
}

export class LexicalIndex {
  private workspaceRoot: string;
  private snippetsById: Map<string, SnippetRecord>;
  private files: FileIndexRecord[];
  private documentFrequency: Map<string, number>;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.snippetsById = new Map();
    this.files = [];
    this.documentFrequency = new Map();
  }

  static async load(workspaceRoot: string): Promise<LexicalIndex | null> {
    const indexPath = dataFilePath(workspaceRoot, INDEX_FILE_NAME);
    const exists = await pathExists(indexPath);
    if (!exists) {
      return null;
    }

    const persisted = await readJsonFile<PersistedLexicalIndex>(indexPath);
    if (persisted.version !== INDEX_VERSION) {
      return null;
    }

    const index = new LexicalIndex(workspaceRoot);
    index.files = persisted.files;
    for (const snippet of persisted.snippets) {
      index.snippetsById.set(snippet.id, snippet);
    }
    index.rebuildDocumentFrequency();
    return index;
  }

  async buildFromFiles(files: FileCandidate[]): Promise<void> {
    this.snippetsById.clear();
    this.files = [];
    this.documentFrequency.clear();

    for (const file of files) {
      const snippets = await this.indexFile(file);
      const snippetIds = snippets.map((snippet) => snippet.id);
      this.files.push({
        relativePath: file.relativePath,
        mtimeMs: file.mtimeMs,
        size: file.size,
        snippetIds
      });
      for (const snippet of snippets) {
        this.snippetsById.set(snippet.id, snippet);
      }
    }

    this.rebuildDocumentFrequency();
  }

  async persist(): Promise<void> {
    const indexPath = dataFilePath(this.workspaceRoot, INDEX_FILE_NAME);
    const payload: PersistedLexicalIndex = {
      version: INDEX_VERSION,
      workspaceRoot: this.workspaceRoot,
      indexedAt: new Date().toISOString(),
      files: this.files,
      snippets: Array.from(this.snippetsById.values())
    };
    await writeJsonFile(indexPath, payload);
  }

  query(queryText: string, options: QueryOptions = {}): QueryResult {
    const topK = options.topK ?? 5;
    const queryTokens = tokenize(queryText);
    if (queryTokens.length === 0) {
      return { query: queryText, results: [] };
    }

    const totalDocs = Math.max(this.snippetsById.size, 1);
    const ranked: RankedSnippet[] = [];

    for (const snippet of this.snippetsById.values()) {
      let score = 0;
      const matchedTerms = new Set<string>();

      for (const token of queryTokens) {
        const tf = snippet.tokenFreq[token] ?? 0;
        if (tf <= 0) {
          continue;
        }
        const df = this.documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + totalDocs / (1 + df));
        score += tf * idf;
        matchedTerms.add(token);
      }

      if (matchedTerms.size === 0) {
        continue;
      }

      const coverageBoost = matchedTerms.size / queryTokens.length;
      const normalizedScore = score * (1 + coverageBoost);

      ranked.push({
        snippet,
        score: normalizedScore,
        matchedTerms: Array.from(matchedTerms).sort()
      });
    }

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.snippet.relativePath !== b.snippet.relativePath) {
        return a.snippet.relativePath.localeCompare(b.snippet.relativePath);
      }
      return a.snippet.startLine - b.snippet.startLine;
    });

    return {
      query: queryText,
      results: ranked.slice(0, topK)
    };
  }

  getSnippetCount(): number {
    return this.snippetsById.size;
  }

  getFileCount(): number {
    return this.files.length;
  }

  private async indexFile(file: FileCandidate): Promise<SnippetRecord[]> {
    const content = await this.safeReadFile(file.absolutePath);
    if (content === null) {
      return [];
    }

    const lines = content.split(/\r?\n/);
    const snippets: SnippetRecord[] = [];

    for (let startIdx = 0; startIdx < lines.length; startIdx += SNIPPET_LINE_WINDOW) {
      const endExclusive = Math.min(startIdx + SNIPPET_LINE_WINDOW, lines.length);
      const slice = lines.slice(startIdx, endExclusive);
      const text = slice.join("\n").trim();
      if (!text) {
        continue;
      }
      const tokens = tokenize(text);
      if (tokens.length === 0) {
        continue;
      }

      const snippet: SnippetRecord = {
        id: `${file.relativePath}:${startIdx + 1}-${endExclusive}`,
        relativePath: file.relativePath,
        startLine: startIdx + 1,
        endLine: endExclusive,
        text,
        tokenFreq: tokenFrequency(tokens)
      };
      snippets.push(snippet);
    }

    return snippets;
  }

  private async safeReadFile(filePath: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return raw;
    } catch {
      return null;
    }
  }

  private rebuildDocumentFrequency(): void {
    this.documentFrequency.clear();

    for (const snippet of this.snippetsById.values()) {
      const uniqueTokens = Object.keys(snippet.tokenFreq);
      for (const token of uniqueTokens) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }
}

export function resolveAbsolutePath(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, relativePath);
}
