import fs from "node:fs";
import path from "node:path";

import { runWorker, defaultRunnerPath, toSymbolLocations, type WorkerRunRequest } from "./worker-runner";
import type { SymbolLocation } from "../types";

function defaultJarPath(): string {
  const jarDefault = defaultRunnerPath(path.join("jvm", "symbol-worker.jar"));
  const javaExecutable = defaultRunnerPath(path.join("jvm-symbol-worker", "build", "libs", "symbol-worker.jar"));
  return fs.existsSync(jarDefault) ? jarDefault : javaExecutable;
}

function defaultJavaPath(): string {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const fromHome = path.join(javaHome, "bin", "java");
    if (fs.existsSync(fromHome)) {
      return fromHome;
    }
  }
  return process.env.JAVA ?? "java";
}

export class JvmNavigator {
  private readonly jarPath: string;
  private readonly javaPath: string;
  private available: boolean | null = null;

  constructor(jarPath?: string, javaPath?: string) {
    this.jarPath = jarPath ?? defaultJarPath();
    this.javaPath = javaPath ?? defaultJavaPath();
  }

  isAvailable(): boolean {
    if (this.available === null) {
      this.available = fs.existsSync(this.jarPath);
    }
    return this.available;
  }

  async findDefinitions(workspaceRoot: string, symbolName: string, language: "java" | "kotlin"): Promise<SymbolLocation[]> {
    return this.query(workspaceRoot, symbolName, "find", language);
  }

  async findReferences(workspaceRoot: string, symbolName: string, language: "java" | "kotlin"): Promise<SymbolLocation[]> {
    return this.query(workspaceRoot, symbolName, "refs", language);
  }

  private async query(
    workspaceRoot: string,
    symbolName: string,
    mode: "find" | "refs",
    language: "java" | "kotlin"
  ): Promise<SymbolLocation[]> {
    const request: WorkerRunRequest = {
      version: 1,
      mode,
      symbol: symbolName,
      workspaceRoot,
      language
    };

    const response = await runWorker([this.javaPath, "-jar", this.jarPath], request, "JVM");
    if (!response.ok) {
      throw new Error(`JVM analysis failed: ${response.error ?? "worker reported an error."}`);
    }

    return toSymbolLocations(language, response.results);
  }
}