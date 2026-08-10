import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AssistantRuntime } from "../src/runtime";
import { LexicalIndex } from "../src/lexical-index";
import { WorkspaceManager } from "../src/workspace-manager";

async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lca-test-"));
}

describe("lexical index retrieval", () => {
  it("ranks relevant snippet above less relevant ones", async () => {
    const workspaceRoot = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspaceRoot, "workspace.ts"),
      [
        "export function discoverProjectRoot(startDir: string) {",
        "  return startDir;",
        "}",
        "",
        "export function fileWatcherHook() {",
        "  return 'watcher';",
        "}"
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(workspaceRoot, "notes.md"),
      "this file talks about shopping lists and recipes only",
      "utf8"
    );

    const workspaceManager = new WorkspaceManager();
    const files = await workspaceManager.listIndexableFiles(workspaceRoot);

    const index = new LexicalIndex(workspaceRoot);
    await index.buildFromFiles(files);

    const result = index.query("where is project root discovery", { topK: 3 });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.snippet.relativePath).toBe("workspace.ts");
    expect(result.results[0]?.snippet.startLine).toBe(1);
    expect(result.results[0]?.matchedTerms).toContain("project");
  });

  it("persists index and supports runtime ask flow", async () => {
    const workspaceRoot = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspaceRoot, "indexer.ts"),
      [
        "export const tokenization = (text: string) => text.toLowerCase();",
        "export const deterministicScoring = () => 42;"
      ].join("\n"),
      "utf8"
    );

    const runtime = new AssistantRuntime(workspaceRoot);
    const init = await runtime.initializeIndex();

    expect(init.fileCount).toBe(1);
    expect(init.snippetCount).toBeGreaterThan(0);

    const loadedIndex = await LexicalIndex.load(workspaceRoot);
    expect(loadedIndex).not.toBeNull();

    const result = await runtime.ask("deterministic scoring", 3);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.snippet.relativePath).toBe("indexer.ts");

    const sessionsPath = path.join(workspaceRoot, ".lca", "sessions.json");
    const sessionsRaw = await fs.readFile(sessionsPath, "utf8");
    expect(sessionsRaw).toContain("deterministic scoring");
  });
});
