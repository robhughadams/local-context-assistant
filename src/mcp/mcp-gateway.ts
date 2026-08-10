import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ToolActionLogger } from "./tool-action-logger";
import { ToolPolicyStore } from "./tool-policy-store";
import type { ToolDefinition, ToolExecutionResult } from "../types";

const execFileAsync = promisify(execFile);

export interface RunToolOptions {
  dryRun?: boolean;
}

export class McpGateway {
  private workspaceRoot: string;
  private policyStore: ToolPolicyStore;
  private actionLogger: ToolActionLogger;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.policyStore = new ToolPolicyStore(workspaceRoot);
    this.actionLogger = new ToolActionLogger(workspaceRoot);
  }

  async ensurePolicyFile(): Promise<void> {
    await this.policyStore.ensurePolicyFile();
  }

  async listTools(): Promise<ToolDefinition[]> {
    return this.policyStore.listTools();
  }

  async runTool(name: string, options: RunToolOptions = {}): Promise<ToolExecutionResult> {
    const dryRun = options.dryRun ?? false;
    const tool = await this.policyStore.findTool(name);
    if (!tool) {
      const result: ToolExecutionResult = {
        tool: {
          name: name.trim(),
          command: "",
          args: []
        },
        status: "denied",
        reason: `Tool "${name}" is not in the allowlist policy.`,
        stdout: "",
        stderr: ""
      };

      await this.logAction(result, dryRun);
      return result;
    }

    if (dryRun) {
      const result: ToolExecutionResult = {
        tool,
        status: "dry-run",
        reason: "Execution skipped because dry-run mode is enabled.",
        stdout: "",
        stderr: ""
      };

      await this.logAction(result, true);
      return result;
    }

    try {
      const output = await execFileAsync(tool.command, tool.args, {
        cwd: this.workspaceRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });

      const result: ToolExecutionResult = {
        tool,
        status: "executed",
        exitCode: 0,
        stdout: output.stdout,
        stderr: output.stderr
      };

      await this.logAction(result, false);
      return result;
    } catch (error: unknown) {
      const executionError = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const exitCode = typeof executionError.code === "number" ? executionError.code : 1;
      const stderr = executionError.stderr ?? executionError.message ?? "Unknown execution error";
      const stdout = executionError.stdout ?? "";

      const result: ToolExecutionResult = {
        tool,
        status: "executed",
        exitCode,
        stdout,
        stderr
      };

      await this.logAction(result, false);
      return result;
    }
  }

  private async logAction(result: ToolExecutionResult, dryRun: boolean): Promise<void> {
    await this.actionLogger.append({
      at: new Date().toISOString(),
      workspaceRoot: this.workspaceRoot,
      tool: result.tool,
      status: result.status,
      dryRun,
      reason: result.reason,
      exitCode: result.exitCode
    });
  }
}
