import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AssistantRuntime } from "../src/runtime";

const testTimeoutMs = 180_000;
const fixtureRoot = path.join(__dirname, "fixtures", "go");
const workerBinary = path.join(process.cwd(), "dist", "go", "go-symbol-worker");

function goWorkerAvailable(): boolean {
  if (!fs.existsSync(workerBinary)) {
    return false;
  }
  const probe = spawnSync("go", ["version"], { encoding: "utf8" });
  return probe.status === 0;
}

const describeGo = goWorkerAvailable() ? describe : describe.skip;

describeGo("go semantic navigation via the go worker", () => {
  it(
    "finds a Go struct definition via the go worker",
    async () => {
      const runtime = new AssistantRuntime(fixtureRoot);
      const result = await runtime.querySymbol("Greeter", "find", "go");

      expect(result.results.length).toBe(1);
      expect(result.results[0]).toMatchObject({
        language: "go",
        kind: "definition",
        role: "struct",
        relativePath: "greeting/greeting.go",
        confidence: "high",
        source: "go-type-checker"
      });
    },
    testTimeoutMs
  );

  it(
    "returns deterministic Go references with confidence markers",
    async () => {
      const runtime = new AssistantRuntime(fixtureRoot);
      const result = await runtime.querySymbol("NewGreeter", "refs", "go");

      expect(result.results.map((entry) => `${entry.relativePath}:${entry.line}:${entry.role}`)).toEqual([
        "cmd/main.go:10:reference",
        "greeting/greeting.go:7:definition-reference"
      ]);
      expect(result.results[0]?.confidence).toBe("medium");
      expect(result.results[1]?.confidence).toBe("high");
    },
    testTimeoutMs
  );

  it(
    "returns no results for an unknown symbol",
    async () => {
      const runtime = new AssistantRuntime(fixtureRoot);
      const result = await runtime.querySymbol("NoSuchSymbol", "find", "go");

      expect(result.results).toEqual([]);
    },
    testTimeoutMs
  );
});
