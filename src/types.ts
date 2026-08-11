export interface FileCandidate {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
  size: number;
}

export interface SnippetRecord {
  id: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  text: string;
  tokenFreq: Record<string, number>;
}

export interface FileIndexRecord {
  relativePath: string;
  mtimeMs: number;
  size: number;
  snippetIds: string[];
}

export interface PersistedLexicalIndex {
  version: number;
  workspaceRoot: string;
  indexedAt: string;
  files: FileIndexRecord[];
  snippets: SnippetRecord[];
}

export interface RankedSnippet {
  snippet: SnippetRecord;
  score: number;
  matchedTerms: string[];
}

export interface QueryResult {
  query: string;
  results: RankedSnippet[];
}

export interface IndexSyncSummary {
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  unchangedFiles: number;
  fileCount: number;
  snippetCount: number;
}

export interface SessionQueryEntry {
  at: string;
  query: string;
  topResultPaths: string[];
}

export interface SessionRecord {
  id: string;
  startedAt: string;
  lastUpdatedAt: string;
  entries: SessionQueryEntry[];
}

export interface SessionStoreFile {
  version: number;
  sessions: SessionRecord[];
}

export type SupportedSymbolLanguage = "typescript" | "python";

export type SymbolMatchKind = "definition" | "reference";

export type SymbolConfidence = "high" | "medium" | "low";

export interface SymbolLocation {
  language: SupportedSymbolLanguage;
  symbol: string;
  kind: SymbolMatchKind;
  role: string;
  relativePath: string;
  line: number;
  column: number;
  confidence: SymbolConfidence;
  source: string;
}

export interface SymbolQueryResult {
  symbol: string;
  mode: "find" | "refs";
  results: SymbolLocation[];
}

export interface ToolCommandPolicy {
  name: string;
  command: string;
  args: string[];
}

export interface ToolPolicyFile {
  version: number;
  tools: ToolCommandPolicy[];
}

export interface ToolDefinition {
  name: string;
  command: string;
  args: string[];
}

export type ToolExecutionStatus = "dry-run" | "executed" | "denied";

export interface ToolExecutionResult {
  tool: ToolDefinition;
  status: ToolExecutionStatus;
  reason?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

export interface ToolActionLogEntry {
  at: string;
  workspaceRoot: string;
  tool: ToolDefinition;
  status: ToolExecutionStatus;
  dryRun: boolean;
  reason?: string;
  exitCode?: number;
}
