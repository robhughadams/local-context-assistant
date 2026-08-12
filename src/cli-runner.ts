import path from "node:path";

import { AssistantRuntime } from "./runtime";
import type { QueryResult, SymbolQueryResult, ToolExecutionResult } from "./types";
import { WorkspaceManager } from "./workspace-manager";

type CliCommand = "init" | "sync" | "ask" | "watch" | "symbol" | "mcp";
type SymbolSubcommand = "find" | "refs";
type SymbolLanguage = "typescript" | "python" | "csharp" | "java" | "kotlin" | "go" | "all";
type McpSubcommand = "init-policy" | "list-tools" | "run-tool";

type JsonEligibleCommand = "ask" | "symbol" | "mcp";

interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

interface RunCliOptions {
  cwd?: string;
  io?: CliIo;
}

const defaultIo: CliIo = {
  stdout: (message: string) => {
    console.log(message);
  },
  stderr: (message: string) => {
    console.error(message);
  }
};

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const [command, ...rest] = argv;
  const io = options.io ?? defaultIo;
  const workspaceManager = new WorkspaceManager();
  const workspaceRoot = workspaceManager.discoverProjectRoot(options.cwd ?? process.cwd());
  const runtime = new AssistantRuntime(workspaceRoot);
  let jsonMode = false;
  let jsonCommand: JsonEligibleCommand | null = null;

  if (!command || !isCommand(command)) {
    printUsage(io);
    return 1;
  }

  try {
    switch (command) {
      case "init": {
        const summary = await runtime.initializeIndex();
        io.stdout(`Indexed ${summary.fileCount} files and ${summary.snippetCount} snippets.`);
        return 0;
      }
      case "sync": {
        const summary = await runtime.syncIndex();
        io.stdout(
          `Synced index: +${summary.addedFiles} ~${summary.modifiedFiles} -${summary.deletedFiles} =${summary.unchangedFiles} (files=${summary.fileCount}, snippets=${summary.snippetCount})`
        );
        return 0;
      }
      case "ask": {
        const parsed = extractJsonFlag(rest);
        jsonMode = parsed.json;
        jsonCommand = "ask";

        const query = parsed.args.join(" ").trim();
        if (!query) {
          throw new Error('Query text is required. Example: lca ask "where is workspace detection"');
        }
        const result = await runtime.ask(query, 5);
        if (jsonMode) {
          printJson(io, {
            command: "ask",
            status: "ok",
            query: result.query,
            results: result.results.map((ranked, idx) => ({
              rank: idx + 1,
              score: ranked.score,
              matchedTerms: ranked.matchedTerms,
              snippet: {
                relativePath: ranked.snippet.relativePath,
                startLine: ranked.snippet.startLine,
                endLine: ranked.snippet.endLine,
                text: ranked.snippet.text
              }
            }))
          });
          return 0;
        }

        renderAskText(io, result);
        return 0;
      }
      case "watch": {
        io.stdout(`Watching ${path.basename(workspaceRoot)} for changes (basic mode)...`);
        const handle = workspaceManager.watchWorkspace(workspaceRoot, (relativePath) => {
          io.stdout(`changed: ${relativePath}`);
        });

        process.on("SIGINT", () => {
          handle.close();
          process.exit(0);
        });
        return 0;
      }
      case "symbol": {
        const parsedRoot = extractJsonFlag(rest);
        jsonMode = parsedRoot.json;
        jsonCommand = "symbol";

        const [subcommandRaw, ...symbolArgs] = parsedRoot.args;
        if (!subcommandRaw || !isSymbolSubcommand(subcommandRaw)) {
          throw new Error("Symbol subcommand is required. Example: lca symbol find discoverProjectRoot");
        }

        const parsed = parseSymbolArgs(symbolArgs);
        if (!parsed.symbol) {
          throw new Error("Symbol text is required. Example: lca symbol refs discoverProjectRoot");
        }

        const result = await runtime.querySymbol(parsed.symbol, subcommandRaw, parsed.language);
        if (jsonMode) {
          printJson(io, {
            command: "symbol",
            status: "ok",
            mode: result.mode,
            symbol: result.symbol,
            language: parsed.language,
            results: result.results
          });
          return 0;
        }

        renderSymbolText(io, result);
        return 0;
      }
      case "mcp": {
        const parsedRoot = extractJsonFlag(rest);
        jsonMode = parsedRoot.json;
        jsonCommand = "mcp";

        const [subcommandRaw, ...mcpArgs] = parsedRoot.args;
        if (!subcommandRaw || !isMcpSubcommand(subcommandRaw)) {
          throw new Error("MCP subcommand is required. Example: lca mcp list-tools");
        }

        if (subcommandRaw === "init-policy") {
          await runtime.ensureToolPolicy();
          if (jsonMode) {
            printJson(io, {
              command: "mcp",
              subcommand: "init-policy",
              status: "ok",
              policyPath: ".lca/tool-policy.json"
            });
            return 0;
          }
          io.stdout("Tool policy initialized at .lca/tool-policy.json");
          return 0;
        }

        if (subcommandRaw === "list-tools") {
          const tools = await runtime.listTools();
          if (jsonMode) {
            printJson(io, {
              command: "mcp",
              subcommand: "list-tools",
              status: "ok",
              tools
            });
            return 0;
          }

          if (tools.length === 0) {
            io.stdout("No tools are allowed. Policy is deny-by-default.");
            return 0;
          }

          for (const tool of tools) {
            const rendered = [tool.command, ...tool.args].join(" ");
            io.stdout(`${tool.name}: ${rendered}`);
          }
          return 0;
        }

        const parsed = parseRunToolArgs(mcpArgs);
        if (!parsed.name) {
          throw new Error("Tool name is required. Example: lca mcp run-tool eslint");
        }

        const result = await runtime.runTool(parsed.name, parsed.dryRun);
        if (jsonMode) {
          printJson(io, {
            command: "mcp",
            subcommand: "run-tool",
            status: result.status,
            result
          });
          if (result.status === "denied") {
            return 2;
          }
          if ((result.exitCode ?? 0) !== 0) {
            return result.exitCode ?? 1;
          }
          return 0;
        }

        return renderMcpRunToolText(io, result);
      }
      default:
        printUsage(io);
        return 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (jsonMode && jsonCommand) {
      printJson(io, {
        command: jsonCommand,
        status: "error",
        error: {
          message
        }
      });
      return 1;
    }

    io.stderr(`Error: ${message}`);
    return 1;
  }
}

function isCommand(value: string): value is CliCommand {
  return value === "init" || value === "sync" || value === "ask" || value === "watch" || value === "symbol" || value === "mcp";
}

function isSymbolSubcommand(value: string): value is SymbolSubcommand {
  return value === "find" || value === "refs";
}

function parseSymbolArgs(args: string[]): { symbol: string; language: SymbolLanguage } {
  let language: SymbolLanguage = "all";
  const parts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--lang") {
      const langValue = args[index + 1];
      if (!isLanguage(langValue)) {
        throw new Error("Invalid language. Use --lang typescript|python|csharp|java|kotlin|go|all.");
      }
      language = langValue;
      index += 1;
      continue;
    }
    parts.push(token);
  }

  return {
    symbol: parts.join(" ").trim(),
    language
  };
}

function isLanguage(value: string | undefined): value is SymbolLanguage {
  return value === "typescript" || value === "python" || value === "csharp" || value === "java" || value === "kotlin" || value === "go" || value === "all";
}

function isMcpSubcommand(value: string): value is McpSubcommand {
  return value === "init-policy" || value === "list-tools" || value === "run-tool";
}

function parseRunToolArgs(args: string[]): { name: string; dryRun: boolean } {
  let dryRun = false;
  const parts: string[] = [];

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    parts.push(arg);
  }

  return {
    name: parts.join(" ").trim(),
    dryRun
  };
}

function extractJsonFlag(args: string[]): { args: string[]; json: boolean } {
  let json = false;
  const output: string[] = [];

  for (const token of args) {
    if (token === "--json") {
      json = true;
      continue;
    }
    output.push(token);
  }

  return {
    args: output,
    json
  };
}

function renderAskText(io: CliIo, result: QueryResult): void {
  if (result.results.length === 0) {
    io.stdout("No matching snippets found.");
    return;
  }

  for (const [idx, ranked] of result.results.entries()) {
    const location = `${ranked.snippet.relativePath}:${ranked.snippet.startLine}-${ranked.snippet.endLine}`;
    const preview = ranked.snippet.text.split("\n").slice(0, 4).join("\n");
    io.stdout(`#${idx + 1} score=${ranked.score.toFixed(3)} ${location}`);
    io.stdout(`matched: ${ranked.matchedTerms.join(", ")}`);
    io.stdout(preview);
    io.stdout("---");
  }
}

function renderSymbolText(io: CliIo, result: SymbolQueryResult): void {
  if (result.results.length === 0) {
    io.stdout(`No symbol matches found for "${result.symbol}".`);
    return;
  }

  for (const [idx, match] of result.results.entries()) {
    io.stdout(
      `#${idx + 1} ${match.language} ${match.kind} ${match.relativePath}:${match.line}:${match.column} confidence=${match.confidence}`
    );
    io.stdout(`role: ${match.role}`);
    io.stdout(`source: ${match.source}`);
    io.stdout("---");
  }
}

function renderMcpRunToolText(io: CliIo, result: ToolExecutionResult): number {
  if (result.status === "denied") {
    io.stdout(`DENIED: ${result.reason ?? "blocked by policy"}`);
    return 2;
  }

  if (result.status === "dry-run") {
    io.stdout(`DRY-RUN: ${result.tool.name} -> ${result.tool.command} ${result.tool.args.join(" ")}`.trim());
    return 0;
  }

  io.stdout(`EXIT CODE: ${result.exitCode ?? 1}`);
  if (result.stdout.trim().length > 0) {
    io.stdout("--- stdout ---");
    io.stdout(result.stdout.trimEnd());
  }
  if (result.stderr.trim().length > 0) {
    io.stdout("--- stderr ---");
    io.stdout(result.stderr.trimEnd());
  }

  if ((result.exitCode ?? 1) !== 0) {
    return result.exitCode ?? 1;
  }

  return 0;
}

function printJson(io: CliIo, payload: unknown): void {
  io.stdout(JSON.stringify(payload));
}

function printUsage(io: CliIo): void {
  io.stdout("Usage:");
  io.stdout("  lca init");
  io.stdout("  lca sync");
  io.stdout("  lca ask <query> [--json]");
  io.stdout("  lca watch");
  io.stdout("  lca symbol find <symbol> [--lang typescript|python|csharp|java|kotlin|go|all] [--json]");
  io.stdout("  lca symbol refs <symbol> [--lang typescript|python|csharp|java|kotlin|go|all] [--json]");
  io.stdout("  lca mcp init-policy [--json]");
  io.stdout("  lca mcp list-tools [--json]");
  io.stdout("  lca mcp run-tool <tool-name> [--dry-run] [--json]");
}
