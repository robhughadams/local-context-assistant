import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ACTION_LOG_FILE_NAME, TOOL_POLICY_FILE_NAME } from "../src/config";
import { AssistantRuntime } from "../src/runtime";
import type { ToolActionLogEntry, ToolPolicyFile } from "../src/types";

async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lca-mcp-test-"));
}

async function writePolicy(workspaceRoot: string, policy: ToolPolicyFile): Promise<void> {
  const policyPath = path.join(workspaceRoot, ".lca", TOOL_POLICY_FILE_NAME);
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

async function readActionLog(workspaceRoot: string): Promise<ToolActionLogEntry[]> {
  const actionLogPath = path.join(workspaceRoot, ".lca", ACTION_LOG_FILE_NAME);
  const raw = await fs.readFile(actionLogPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ToolActionLogEntry);
}

describe("MCP gateway policy and execution", () => {
  it("denies tools that are not allowlisted with a clear reason and audit entry", async () => {
    const workspaceRoot = await createTempWorkspace();
    const runtime = new AssistantRuntime(workspaceRoot);

    const result = await runtime.runTool("not-allowed", false);

    expect(result.status).toBe("denied");
    expect(result.reason).toContain("allowlist policy");

    const logEntries = await readActionLog(workspaceRoot);
    expect(logEntries.length).toBe(1);
    expect(logEntries[0]?.status).toBe("denied");
    expect(logEntries[0]?.dryRun).toBe(false);
  });

  it("executes allowlisted tool and captures output with audit entry", async () => {
    const workspaceRoot = await createTempWorkspace();
    await writePolicy(workspaceRoot, {
      version: 1,
      tools: [
        {
          name: "print-ok",
          command: process.execPath,
          args: ["-e", "process.stdout.write('ok'); process.stderr.write('warn')"]
        }
      ]
    });

    const runtime = new AssistantRuntime(workspaceRoot);
    const result = await runtime.runTool("print-ok", false);

    expect(result.status).toBe("executed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("warn");

    const logEntries = await readActionLog(workspaceRoot);
    expect(logEntries.length).toBe(1);
    expect(logEntries[0]?.status).toBe("executed");
    expect(logEntries[0]?.tool.name).toBe("print-ok");
    expect(logEntries[0]?.dryRun).toBe(false);
    expect(logEntries[0]?.exitCode).toBe(0);
  });

  it("supports dry-run mode and records a dry-run audit entry", async () => {
    const workspaceRoot = await createTempWorkspace();
    await writePolicy(workspaceRoot, {
      version: 1,
      tools: [
        {
          name: "dry-example",
          command: process.execPath,
          args: ["-e", "process.stdout.write('should-not-run')"]
        }
      ]
    });

    const runtime = new AssistantRuntime(workspaceRoot);
    const result = await runtime.runTool("dry-example", true);

    expect(result.status).toBe("dry-run");
    expect(result.reason).toContain("dry-run mode");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");

    const logEntries = await readActionLog(workspaceRoot);
    expect(logEntries.length).toBe(1);
    expect(logEntries[0]?.status).toBe("dry-run");
    expect(logEntries[0]?.dryRun).toBe(true);
    expect(logEntries[0]?.tool.name).toBe("dry-example");
  });

  it("initializes deny-by-default policy file when requested", async () => {
    const workspaceRoot = await createTempWorkspace();
    const runtime = new AssistantRuntime(workspaceRoot);

    await runtime.ensureToolPolicy();
    const tools = await runtime.listTools();

    expect(tools).toEqual([]);

    const policyPath = path.join(workspaceRoot, ".lca", TOOL_POLICY_FILE_NAME);
    const policyRaw = await fs.readFile(policyPath, "utf8");
    expect(policyRaw).toContain('"tools": []');
  });
});
