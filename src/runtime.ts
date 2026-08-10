import { LexicalIndex } from "./lexical-index";
import { McpGateway } from "./mcp/mcp-gateway";
import { SemanticNavigator } from "./semantic/semantic-navigator";
import { SessionStore } from "./session-store";
import type { SymbolQueryResult, ToolDefinition, ToolExecutionResult } from "./types";
import { WorkspaceManager } from "./workspace-manager";

export class AssistantRuntime {
  private workspaceManager: WorkspaceManager;
  private workspaceRoot: string;
  private mcpGateway: McpGateway;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.workspaceManager = new WorkspaceManager();
    this.mcpGateway = new McpGateway(workspaceRoot);
  }

  async initializeIndex(): Promise<{ fileCount: number; snippetCount: number }> {
    const files = await this.workspaceManager.listIndexableFiles(this.workspaceRoot);
    const index = new LexicalIndex(this.workspaceRoot);
    await index.buildFromFiles(files);
    await index.persist();

    return {
      fileCount: index.getFileCount(),
      snippetCount: index.getSnippetCount()
    };
  }

  async ask(query: string, topK: number = 5): Promise<ReturnType<LexicalIndex["query"]>> {
    const index = await LexicalIndex.load(this.workspaceRoot);
    if (!index) {
      throw new Error("No index found. Run `lca init` first.");
    }

    const result = index.query(query, { topK });

    const sessionStore = new SessionStore(this.workspaceRoot);
    await sessionStore.appendQuery(
      query,
      result.results.map((entry) => `${entry.snippet.relativePath}:${entry.snippet.startLine}-${entry.snippet.endLine}`)
    );

    return result;
  }

  async querySymbol(
    symbol: string,
    mode: "find" | "refs",
    language: "typescript" | "python" | "all" = "all"
  ): Promise<SymbolQueryResult> {
    const navigator = new SemanticNavigator(this.workspaceRoot);
    return navigator.querySymbol(symbol, { mode, language });
  }

  async ensureToolPolicy(): Promise<void> {
    await this.mcpGateway.ensurePolicyFile();
  }

  async listTools(): Promise<ToolDefinition[]> {
    return this.mcpGateway.listTools();
  }

  async runTool(name: string, dryRun: boolean): Promise<ToolExecutionResult> {
    return this.mcpGateway.runTool(name, { dryRun });
  }
}
