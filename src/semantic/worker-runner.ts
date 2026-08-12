import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { SupportedSymbolLanguage, SymbolLocation } from "../types";

const requestTimeoutMs = 300_000;

export interface WorkerRunRequest {
  version: 1;
  mode: "find" | "refs";
  symbol: string;
  workspaceRoot: string;
  language?: string;
}

interface WorkerResultLocation {
  language: string;
  symbol: string;
  kind: "definition" | "reference";
  role: string;
  relativePath: string;
  line: number;
  column: number;
  confidence: "high" | "medium" | "low";
  source: string;
}

export interface WorkerResponse {
  ok: boolean;
  results: WorkerResultLocation[];
  error: string | null;
}

function defaultModuleCandidates(relative: string[]): string {
  const dirname = typeof __dirname === "string" ? __dirname : process.cwd();
  const candidates = [
    ...relative.map((tail) => path.join(dirname, "..", tail)),
    ...relative.map((tail) => path.join(process.cwd(), "dist", tail))
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0] ?? "";
}

export function resolveWorkerModules(defaults: Record<string, string[]>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, relative] of Object.entries(defaults)) {
    resolved[key] = defaultModuleCandidates(relative);
  }
  return resolved;
}

export function defaultRunnerPath(relative: string): string {
  return defaultModuleCandidates([relative]);
}

export function runWorker(argv: string[], request: WorkerRunRequest, label: string): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const binary = argv[0] ?? "";
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = spawn(binary, argv.slice(1), {
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(new Error(`Unable to start the ${label} analysis worker. ${String(error)}`));
      return;
    }

    if (!child) {
      reject(new Error(`Unable to start the ${label} analysis worker.`));
      return;
    }

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} analysis worker timed out after ${requestTimeoutMs / 1000}s.`));
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
        reject(new Error(`Unable to start the ${label} analysis worker: ${error.message}.`));
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const line = stdout.split(/\r?\n/).find((entry) => entry.trim().length > 0);
        if (line === undefined) {
          const detail = stderrChunks.join("").trim();
          reject(
            new Error(
              `${label} analysis worker produced no output (exit code ${code ?? "none"}).${detail ? ` ${detail.slice(0, 300)}` : ""}`
            )
          );
          return;
        }

        let parsed: WorkerResponse;
        try {
          parsed = JSON.parse(line) as WorkerResponse;
        } catch {
          reject(new Error(`${label} analysis worker returned invalid JSON: ${line.slice(0, 200)}`));
          return;
        }

        if (code !== 0 && !parsed.ok) {
          reject(new Error(parsed.error ?? `${label} analysis worker exited with code ${code}.`));
          return;
        }

        resolve({ ok: parsed.ok, results: parsed.results, error: parsed.error ?? null });
      });
    });

    child.stdin.end(JSON.stringify(request) + "\n", "utf8");
  });
}

export function toSymbolLocations(language: SupportedSymbolLanguage, locations: WorkerResultLocation[]): SymbolLocation[] {
  return locations.map((location) => ({
    language,
    symbol: location.symbol,
    kind: location.kind,
    role: location.role,
    relativePath: location.relativePath,
    line: location.line,
    column: location.column,
    confidence: location.confidence,
    source: location.source
  }));
}