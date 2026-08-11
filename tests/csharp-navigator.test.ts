import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AssistantRuntime } from "../src/runtime";

const testTimeoutMs = 120_000;
const fixtureRoot = path.join(__dirname, "fixtures", "csharp");
const workerModule = path.join(process.cwd(), "dist", "roslyn", "roslyn-worker.dll");

function csharpWorkerAvailable(): boolean {
  if (!fs.existsSync(workerModule)) {
    return false;
  }
  const probe = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

const describeCsharp = csharpWorkerAvailable() ? describe : describe.skip;

describeCsharp("csharp semantic navigation via Roslyn worker", () => {
  it(
    "finds C# type definition via the Roslyn worker",
    async () => {
      const runtime = new AssistantRuntime(fixtureRoot);
      const result = await runtime.querySymbol("Calculator", "find", "csharp");

      expect(result.results.length).toBe(1);
      expect(result.results[0]).toMatchObject({
        language: "csharp",
        kind: "definition",
        relativePath: "Calculator.cs",
        confidence: "high",
        source: "roslyn-compiler-api"
      });
    },
    testTimeoutMs
  );

  it(
    "returns deterministic C# references with confidence markers",
    async () => {
      const runtime = new AssistantRuntime(fixtureRoot);
      const result = await runtime.querySymbol("Calculator", "refs", "csharp");

      expect(result.results.map((entry) => `${entry.relativePath}:${entry.line}:${entry.role}`)).toEqual([
        "Calculator.cs:3:definition-reference",
        "Program.cs:7:reference"
      ]);
      expect(result.results[0]?.confidence).toBe("high");
      expect(result.results[1]?.confidence).toBe("medium");
    },
    testTimeoutMs
  );

  it(
    "returns no results for an unknown symbol",
    async () => {
      const runtime = new AssistantRuntime(fixtureRoot);
      const result = await runtime.querySymbol("NoSuchSymbol", "find", "csharp");

      expect(result.results).toEqual([]);
    },
    testTimeoutMs
  );
});