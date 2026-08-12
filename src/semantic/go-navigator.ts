import fs from "node:fs";
import path from "node:path";

import { runWorker, defaultRunnerPath, toSymbolLocations, type WorkerRunRequest } from "./worker-runner";
import type { SymbolLocation } from "../types";

export class GoNavigator {
  private readonly binaryPath: string;
  private available: boolean | null = null;

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath ?? defaultRunnerPath(path.join("go", "go-symbol-worker"));
  }

  isAvailable(): boolean {
    if (this.available === null) {
      this.available = fs.existsSync(this.binaryPath);
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

    const response = await runWorker([this.binaryPath], request, "Go");
    if (!response.ok) {
      throw new Error(`Go analysis failed: ${response.error ?? "worker reported an error."}`);
    }

    return toSymbolLocations("go", response.results);
  }
}