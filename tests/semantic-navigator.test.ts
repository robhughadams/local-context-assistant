import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AssistantRuntime } from "../src/runtime";

async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lca-semantic-test-"));
}

describe("semantic symbol navigation", () => {
  it("finds TypeScript symbol definition using compiler API", async () => {
    const workspaceRoot = await createTempWorkspace();

    await fs.writeFile(
      path.join(workspaceRoot, "math.ts"),
      ["export function add(a: number, b: number): number {", "  return a + b;", "}"].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(workspaceRoot, "main.ts"),
      ["import { add } from './math';", "const result = add(1, 2);", "console.log(result);"]
        .join("\n"),
      "utf8"
    );

    const runtime = new AssistantRuntime(workspaceRoot);
    const result = await runtime.querySymbol("add", "find", "typescript");

    expect(result.results.length).toBeGreaterThan(0);
    const def = result.results.find((entry) => entry.relativePath === "math.ts");
    expect(def).toBeDefined();
    expect(def?.kind).toBe("definition");
    expect(def?.line).toBe(1);
    expect(def?.confidence).toBe("high");
  });

  it("returns deterministic TypeScript references with confidence markers", async () => {
    const workspaceRoot = await createTempWorkspace();

    await fs.writeFile(
      path.join(workspaceRoot, "user.ts"),
      [
        "export const userName = 'rob';",
        "export function printUser(): void {",
        "  console.log(userName);",
        "}",
        "printUser();"
      ].join("\n"),
      "utf8"
    );

    const runtime = new AssistantRuntime(workspaceRoot);
    const result = await runtime.querySymbol("userName", "refs", "typescript");

    expect(result.results.length).toBe(2);
    expect(result.results.map((entry) => entry.line)).toEqual([1, 3]);
    expect(result.results[0]?.confidence).toBe("high");
    expect(result.results[1]?.confidence).toBe("medium");
  });

  it("finds Python definition with heuristic confidence", async () => {
    const workspaceRoot = await createTempWorkspace();

    await fs.writeFile(
      path.join(workspaceRoot, "helpers.py"),
      ["def slugify(value):", "    return value.lower().replace(' ', '-')"].join("\n"),
      "utf8"
    );

    const runtime = new AssistantRuntime(workspaceRoot);
    const result = await runtime.querySymbol("slugify", "find", "python");

    expect(result.results.length).toBe(1);
    expect(result.results[0]?.relativePath).toBe("helpers.py");
    expect(result.results[0]?.line).toBe(1);
    expect(result.results[0]?.confidence).toBe("high");
    expect(result.results[0]?.source).toBe("python-heuristic");
  });

  it("returns Python references with deterministic ordering and confidence", async () => {
    const workspaceRoot = await createTempWorkspace();

    await fs.writeFile(
      path.join(workspaceRoot, "helpers.py"),
      ["def slugify(value):", "    return value.lower().replace(' ', '-')"].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(workspaceRoot, "app.py"),
      [
        "from helpers import slugify",
        "item = slugify('Fish Pie')",
        "print(item)",
        "# slugify in comment should be ignored"
      ].join("\n"),
      "utf8"
    );

    const runtime = new AssistantRuntime(workspaceRoot);
    const result = await runtime.querySymbol("slugify", "refs", "python");

    expect(result.results.length).toBe(3);
    expect(result.results.map((entry) => `${entry.relativePath}:${entry.line}`)).toEqual([
      "app.py:1",
      "app.py:2",
      "helpers.py:1"
    ]);
    expect(result.results[0]?.confidence).toBe("medium");
    expect(result.results[1]?.confidence).toBe("low");
    expect(result.results[2]?.role).toBe("definition-reference");
  });
});
