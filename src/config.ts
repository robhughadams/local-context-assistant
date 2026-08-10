import path from "node:path";

export const DATA_DIR_NAME = ".lca";
export const INDEX_FILE_NAME = "index.json";
export const SESSIONS_FILE_NAME = "sessions.json";
export const TOOL_POLICY_FILE_NAME = "tool-policy.json";
export const ACTION_LOG_FILE_NAME = "actions.log.jsonl";

export const DEFAULT_INCLUDE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".yml",
  ".yaml",
  ".toml",
  ".txt"
]);

export const DEFAULT_EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".idea",
  ".vscode",
  "coverage",
  DATA_DIR_NAME
]);

export const DEFAULT_EXCLUDE_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

export const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "with"
]);

export function dataFilePath(workspaceRoot: string, fileName: string): string {
  return path.join(workspaceRoot, DATA_DIR_NAME, fileName);
}
