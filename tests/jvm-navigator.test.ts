import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AssistantRuntime } from "../src/runtime";

const testTimeoutMs = 240_000;
const fixtureJavaRoot = path.join(__dirname, "fixtures", "java");
const fixtureKotlinRoot = path.join(__dirname, "fixtures", "kotlin");
const workerJar = path.join(process.cwd(), "dist", "jvm", "symbol-worker.jar");

function jvmWorkerAvailable(): boolean {
  if (!fs.existsSync(workerJar)) {
    return false;
  }
  const javaHome = process.env.JAVA_HOME;
  const javaPath =
    javaHome && fs.existsSync(path.join(javaHome, "bin", "java"))
      ? path.join(javaHome, "bin", "java")
      : process.env.JAVA ?? "java";
  const probe = spawnSync(javaPath, ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

const describeJvm = jvmWorkerAvailable() ? describe : describe.skip;

describeJvm("java semantic navigation via the JVM worker", () => {
  it(
    "finds a Java class definition via the JVM worker",
    async () => {
      const runtime = new AssistantRuntime(fixtureJavaRoot);
      const result = await runtime.querySymbol("Calculator", "find", "java");

      expect(result.results.length).toBe(1);
      expect(result.results[0]).toMatchObject({
        language: "java",
        kind: "definition",
        role: "class",
        relativePath: "src/main/java/com/example/Calculator.java",
        confidence: "high",
        source: "javaparser-symbol-solver"
      });
    },
    testTimeoutMs
  );

  it(
    "returns deterministic Java references with confidence markers",
    async () => {
      const runtime = new AssistantRuntime(fixtureJavaRoot);
      const result = await runtime.querySymbol("add", "refs", "java");

      expect(result.results.map((entry) => `${entry.relativePath}:${entry.line}:${entry.role}`)).toEqual([
        "src/main/java/com/example/Calculator.java:6:definition-reference",
        "src/main/java/com/example/Main.java:6:reference"
      ]);
      expect(result.results[0]?.confidence).toBe("high");
      expect(result.results[1]?.confidence).toBe("medium");
    },
    testTimeoutMs
  );
});

describeJvm("kotlin semantic navigation via the JVM worker", () => {
  it(
    "finds a Kotlin data class definition via the JVM worker",
    async () => {
      const runtime = new AssistantRuntime(fixtureKotlinRoot);
      const result = await runtime.querySymbol("Greeter", "find", "kotlin");

      expect(result.results.length).toBe(1);
      expect(result.results[0]).toMatchObject({
        language: "kotlin",
        kind: "definition",
        role: "data-class",
        relativePath: "src/main/kotlin/com/example/Greeter.kt",
        confidence: "high",
        source: "kotlin-compiler"
      });
    },
    testTimeoutMs
  );

  it(
    "returns deterministic Kotlin references with confidence markers",
    async () => {
      const runtime = new AssistantRuntime(fixtureKotlinRoot);
      const result = await runtime.querySymbol("hello", "refs", "kotlin");

      expect(result.results.map((entry) => `${entry.relativePath}:${entry.line}:${entry.role}`)).toEqual([
        "src/main/kotlin/com/example/Greeter.kt:4:definition-reference",
        "src/main/kotlin/com/example/Main.kt:5:reference"
      ]);
      expect(result.results[0]?.confidence).toBe("high");
      expect(result.results[1]?.confidence).toBe("medium");
    },
    testTimeoutMs
  );

  it(
    "returns no results for an unknown symbol",
    async () => {
      const runtime = new AssistantRuntime(fixtureKotlinRoot);
      const result = await runtime.querySymbol("NoSuchSymbol", "find", "kotlin");

      expect(result.results).toEqual([]);
    },
    testTimeoutMs
  );
});
