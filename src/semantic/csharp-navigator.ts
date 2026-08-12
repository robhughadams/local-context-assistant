import { runWorker, defaultRunnerPath, type WorkerRunRequest } from "./worker-runner";
import type { SymbolLocation } from "../types";
import fs from "node:fs";
import path from "node:path";

export class CSharpNavigator {
  private readonly modulePath: string;
  private available: boolean | null = null;

  constructor(modulePath?: string) {
    this.modulePath = modulePath ?? defaultRunnerPath(path.join("roslyn", "roslyn-worker.dll"));
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
    const request: WorkerRunRequest = {
      version: 1,
      mode,
      symbol: symbolName,
      workspaceRoot
    };

    const response = await runWorker(["dotnet", this.modulePath], request, "C#");
    if (!response.ok) {
      throw new Error(`C# analysis failed: ${response.error ?? "worker reported an error."}`);
    }

    return response.results.map((location) => ({
      language: "csharp" as const,
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
}