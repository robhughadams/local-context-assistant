import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { SymbolLocation } from "../types";

const requestTimeoutMs = 300_000;

interface WorkerRequest {
  version: 1;
  mode: "find" | "refs";
  symbol: string;
  workspaceRoot: string;
}

interface WorkerResultLocation {
  language: "csharp";
  symbol: string;
  kind: "definition" | "reference";
  role: string;
  relativePath: string;
  line: number;
  column: number;
  confidence: "high" | "medium" | "low";
  source: string;
}

interface WorkerResponse {
  ok: boolean;
  results: WorkerResultLocation[];
  error: string | null;
}

export class CSharpNavigator {
  private readonly modulePath: string;
  private available: boolean | null = null;

  constructor(modulePath?: string) {
    this.modulePath = modulePath ?? defaultWorkerModulePath();
  }

  isAvailable(): boolean {
    if (this.available === null) {
      this.available = fs.existsSync(this.modulePath);
    }
    return this.available;
  }

  async findDefinitions(workspaceRoot: string, symbolName: string): Promise<SymbolLocation[]> {
    return this.query(workspaceRoot, symbolName, "find");
  }

  async findReferences(workspaceRoot: string, symbolName: string): Promise<SymbolLocation[]> {
    return this.query(workspaceRoot, symbolName, "refs");
  }

  private async query(workspaceRoot: string, symbolName: string, mode: "find" | "refs"): Promise<SymbolLocation[]> {
    const request: WorkerRequest = {
      version: 1,
      mode,
      symbol: symbolName,
      workspaceRoot
    };

    const response = await runWorker(this.modulePath, request);
    if (!response.ok) {
      throw new Error(`C# analysis failed: ${response.error ?? "worker reported an error."}`);
    }

    return response.results;
  }
}

function defaultWorkerModulePath(): string {
  const dirname = typeof __dirname === "string" ? __dirname : process.cwd();
  const candidates = [
    path.join(dirname, "..", "roslyn", "roslyn-worker.dll"),
    path.join(process.cwd(), "dist", "roslyn", "roslyn-worker.dll")
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  const fallback = candidates[0] ?? path.join(process.cwd(), "roslyn", "roslyn-worker.dll");
  return found ?? fallback;
}

function runWorker(modulePath: string, request: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = spawn("dotnet", [modulePath], {
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(new Error(`Unable to start the C# analysis worker. ${String(error)}`));
      return;
    }

    if (!child) {
      reject(new Error("Unable to start the C# analysis worker."));
      return;
    }

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`C# analysis worker timed out after ${requestTimeoutMs / 1000}s.`));
    }, requestTimeoutMs);

    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      operation();
    };

    let stdout = "";
    const stderrChunks: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      finish(() => {
        reject(new Error(`Unable to start the C# analysis worker: ${error.message}. Is dotnet installed?`));
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const line = stdout.split(/\r?\n/).find((entry) => entry.trim().length > 0);
        if (line === undefined) {
          const detail = stderrChunks.join("").trim();
          reject(
            new Error(
              `C# analysis worker produced no output (exit code ${code ?? "none"}).${detail ? ` ${detail.slice(0, 300)}` : ""}`
            )
          );
          return;
        }

        let parsed: WorkerResponse;
        try {
          parsed = JSON.parse(line) as WorkerResponse;
        } catch {
          reject(new Error(`C# analysis worker returned invalid JSON: ${line.slice(0, 200)}`));
          return;
        }

        if (code !== 0 && !parsed.ok) {
          reject(new Error(parsed.error ?? `C# analysis worker exited with code ${code}.`));
          return;
        }

        resolve(parsed);
      });
    });

    child.stdin.end(JSON.stringify(request) + "\n", "utf8");
  });
}