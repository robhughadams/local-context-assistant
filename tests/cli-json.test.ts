import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli-runner";
import type { ToolPolicyFile } from "../src/types";
import { TOOL_POLICY_FILE_NAME } from "../src/config";

interface CapturedIo {
  stdout: string[];
  stderr: string[];
}

async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lca-cli-json-test-"));
}

async function writePolicy(workspaceRoot: string, policy: ToolPolicyFile): Promise<void> {
  const policyPath = path.join(workspaceRoot, ".lca", TOOL_POLICY_FILE_NAME);
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

function createIoCapture(): { io: { stdout: (line: string) => void; stderr: (line: string) => void }; captured: CapturedIo } {
  const captured: CapturedIo = { stdout: [], stderr: [] };
  return {
    io: {
      stdout: (line: string) => {
        captured.stdout.push(line);
      },
      stderr: (line: string) => {
        captured.stderr.push(line);
      }
    },
    captured
  };
}

describe("CLI JSON mode", () => {
  it("returns structured JSON for ask success", async () => {
    const workspaceRoot = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceRoot, "info.ts"), "export const FLAG = 'json-ask-success';\n", "utf8");

    const initCapture = createIoCapture();
    await runCli(["init"], { cwd: workspaceRoot, io: initCapture.io });

    const askCapture = createIoCapture();
    const exitCode = await runCli(["ask", "json-ask-success", "--json"], { cwd: workspaceRoot, io: askCapture.io });

    expect(exitCode).toBe(0);
    expect(askCapture.captured.stderr).toEqual([]);
    expect(askCapture.captured.stdout.length).toBe(1);

    const payload = JSON.parse(askCapture.captured.stdout[0] ?? "{}") as {
      command: string;
      status: string;
      query: string;
      results: Array<{ snippet: { relativePath: string } }>;
    };

    expect(payload.command).toBe("ask");
    expect(payload.status).toBe("ok");
    expect(payload.query).toBe("json-ask-success");
    expect(payload.results[0]?.snippet.relativePath).toBe("info.ts");
  });

  it("returns structured JSON for symbol success", async () => {
    const workspaceRoot = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceRoot, "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");

    const symbolCapture = createIoCapture();
    const exitCode = await runCli(["symbol", "find", "add", "--lang", "typescript", "--json"], {
      cwd: workspaceRoot,
      io: symbolCapture.io
    });

    expect(exitCode).toBe(0);
    expect(symbolCapture.captured.stderr).toEqual([]);
    const payload = JSON.parse(symbolCapture.captured.stdout[0] ?? "{}") as {
      command: string;
      status: string;
      mode: string;
      results: Array<{ relativePath: string }>;
    };

    expect(payload.command).toBe("symbol");
    expect(payload.status).toBe("ok");
    expect(payload.mode).toBe("find");
    expect(payload.results.some((entry) => entry.relativePath === "math.ts")).toBe(true);
  });

  it("returns structured JSON for mcp success", async () => {
    const workspaceRoot = await createTempWorkspace();
    await writePolicy(workspaceRoot, {
      version: 1,
      tools: [
        {
          name: "print-ok",
          command: process.execPath,
          args: ["-e", "process.stdout.write('ok-json')"]
        }
      ]
    });

    const mcpCapture = createIoCapture();
    const exitCode = await runCli(["mcp", "run-tool", "print-ok", "--json"], { cwd: workspaceRoot, io: mcpCapture.io });

    expect(exitCode).toBe(0);
    expect(mcpCapture.captured.stderr).toEqual([]);
    const payload = JSON.parse(mcpCapture.captured.stdout[0] ?? "{}") as {
      command: string;
      subcommand: string;
      status: string;
      result: { stdout: string; status: string };
    };

    expect(payload.command).toBe("mcp");
    expect(payload.subcommand).toBe("run-tool");
    expect(payload.status).toBe("executed");
    expect(payload.result.status).toBe("executed");
    expect(payload.result.stdout).toBe("ok-json");
  });

  it("returns structured JSON and denied exit code for blocked mcp tool", async () => {
    const workspaceRoot = await createTempWorkspace();

    const mcpCapture = createIoCapture();
    const exitCode = await runCli(["mcp", "run-tool", "blocked-tool", "--json"], { cwd: workspaceRoot, io: mcpCapture.io });

    expect(exitCode).toBe(2);
    expect(mcpCapture.captured.stderr).toEqual([]);
    const payload = JSON.parse(mcpCapture.captured.stdout[0] ?? "{}") as {
      command: string;
      subcommand: string;
      status: string;
      result: { reason?: string };
    };

    expect(payload.command).toBe("mcp");
    expect(payload.subcommand).toBe("run-tool");
    expect(payload.status).toBe("denied");
    expect(payload.result.reason).toContain("allowlist policy");
  });
});
