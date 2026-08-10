import { TOOL_POLICY_FILE_NAME, dataFilePath } from "../config";
import { pathExists, readJsonFile, writeJsonFile } from "../fs-utils";
import type { ToolDefinition, ToolPolicyFile } from "../types";

const POLICY_VERSION = 1;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function normalizeTool(tool: ToolDefinition): ToolDefinition {
  return {
    name: tool.name.trim(),
    command: tool.command.trim(),
    args: tool.args.map((arg) => arg.trim())
  };
}

export class ToolPolicyStore {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async listTools(): Promise<ToolDefinition[]> {
    const policy = await this.loadPolicy();
    return policy.tools.map((tool) => normalizeTool(tool));
  }

  async findTool(name: string): Promise<ToolDefinition | null> {
    const normalizedName = name.trim();
    const tools = await this.listTools();
    return tools.find((tool) => tool.name === normalizedName) ?? null;
  }

  async isToolAllowed(tool: ToolDefinition): Promise<boolean> {
    const candidate = normalizeTool(tool);
    const tools = await this.listTools();
    return tools.some((allowed) => {
      if (allowed.name !== candidate.name || allowed.command !== candidate.command) {
        return false;
      }
      if (allowed.args.length !== candidate.args.length) {
        return false;
      }
      return allowed.args.every((arg, index) => arg === candidate.args[index]);
    });
  }

  async ensurePolicyFile(): Promise<void> {
    const policyPath = dataFilePath(this.workspaceRoot, TOOL_POLICY_FILE_NAME);
    const exists = await pathExists(policyPath);
    if (exists) {
      return;
    }

    const emptyPolicy: ToolPolicyFile = {
      version: POLICY_VERSION,
      tools: []
    };
    await writeJsonFile(policyPath, emptyPolicy);
  }

  private async loadPolicy(): Promise<ToolPolicyFile> {
    const policyPath = dataFilePath(this.workspaceRoot, TOOL_POLICY_FILE_NAME);
    const exists = await pathExists(policyPath);
    if (!exists) {
      return {
        version: POLICY_VERSION,
        tools: []
      };
    }

    const parsed = await readJsonFile<ToolPolicyFile>(policyPath);
    if (!this.isValidPolicy(parsed)) {
      return {
        version: POLICY_VERSION,
        tools: []
      };
    }

    return parsed;
  }

  private isValidPolicy(policy: unknown): policy is ToolPolicyFile {
    if (typeof policy !== "object" || policy === null) {
      return false;
    }

    const candidate = policy as Partial<ToolPolicyFile>;
    if (candidate.version !== POLICY_VERSION || !Array.isArray(candidate.tools)) {
      return false;
    }

    return candidate.tools.every((tool) => {
      if (typeof tool !== "object" || tool === null) {
        return false;
      }

      const maybeTool = tool as Partial<ToolDefinition>;
      return (
        typeof maybeTool.name === "string" &&
        maybeTool.name.trim().length > 0 &&
        typeof maybeTool.command === "string" &&
        maybeTool.command.trim().length > 0 &&
        isStringArray(maybeTool.args)
      );
    });
  }
}
