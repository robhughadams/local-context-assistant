#!/usr/bin/env node
import path from "node:path";

import { AssistantRuntime } from "./runtime";
import { WorkspaceManager } from "./workspace-manager";

type CliCommand = "init" | "ask" | "watch" | "symbol" | "mcp";
type SymbolSubcommand = "find" | "refs";
type SymbolLanguage = "typescript" | "python" | "all";
type McpSubcommand = "init-policy" | "list-tools" | "run-tool";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const workspaceManager = new WorkspaceManager();
  const workspaceRoot = workspaceManager.discoverProjectRoot(process.cwd());
  const runtime = new AssistantRuntime(workspaceRoot);

  if (!command || !isCommand(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "init": {
      const summary = await runtime.initializeIndex();
      console.log(`Indexed ${summary.fileCount} files and ${summary.snippetCount} snippets.`);
      return;
    }
    case "ask": {
      const query = rest.join(" ").trim();
      if (!query) {
        throw new Error("Query text is required. Example: lca ask \"where is workspace detection\"");
      }
      const result = await runtime.ask(query, 5);
      if (result.results.length === 0) {
        console.log("No matching snippets found.");
        return;
      }
      for (const [idx, ranked] of result.results.entries()) {
        const location = `${ranked.snippet.relativePath}:${ranked.snippet.startLine}-${ranked.snippet.endLine}`;
        const preview = ranked.snippet.text.split("\n").slice(0, 4).join("\n");
        console.log(`#${idx + 1} score=${ranked.score.toFixed(3)} ${location}`);
        console.log(`matched: ${ranked.matchedTerms.join(", ")}`);
        console.log(preview);
        console.log("---");
      }
      return;
    }
    case "watch": {
      console.log(`Watching ${path.basename(workspaceRoot)} for changes (basic mode)...`);
      const handle = workspaceManager.watchWorkspace(workspaceRoot, (relativePath) => {
        console.log(`changed: ${relativePath}`);
      });

      process.on("SIGINT", () => {
        handle.close();
        process.exit(0);
      });
      return;
    }
    case "symbol": {
      const [subcommandRaw, ...symbolArgs] = rest;
      if (!subcommandRaw || !isSymbolSubcommand(subcommandRaw)) {
        throw new Error("Symbol subcommand is required. Example: lca symbol find discoverProjectRoot");
      }

      const parsed = parseSymbolArgs(symbolArgs);
      if (!parsed.symbol) {
        throw new Error("Symbol text is required. Example: lca symbol refs discoverProjectRoot");
      }

      const result = await runtime.querySymbol(parsed.symbol, subcommandRaw, parsed.language);
      if (result.results.length === 0) {
        console.log(`No symbol matches found for "${result.symbol}".`);
        return;
      }

      for (const [idx, match] of result.results.entries()) {
        console.log(
          `#${idx + 1} ${match.language} ${match.kind} ${match.relativePath}:${match.line}:${match.column} confidence=${match.confidence}`
        );
        console.log(`role: ${match.role}`);
        console.log(`source: ${match.source}`);
        console.log("---");
      }
      return;
    }
    case "mcp": {
      const [subcommandRaw, ...mcpArgs] = rest;
      if (!subcommandRaw || !isMcpSubcommand(subcommandRaw)) {
        throw new Error("MCP subcommand is required. Example: lca mcp list-tools");
      }

      if (subcommandRaw === "init-policy") {
        await runtime.ensureToolPolicy();
        console.log("Tool policy initialized at .lca/tool-policy.json");
        return;
      }

      if (subcommandRaw === "list-tools") {
        const tools = await runtime.listTools();
        if (tools.length === 0) {
          console.log("No tools are allowed. Policy is deny-by-default.");
          return;
        }

        for (const tool of tools) {
          const rendered = [tool.command, ...tool.args].join(" ");
          console.log(`${tool.name}: ${rendered}`);
        }
        return;
      }

      const parsed = parseRunToolArgs(mcpArgs);
      if (!parsed.name) {
        throw new Error("Tool name is required. Example: lca mcp run-tool eslint");
      }

      const result = await runtime.runTool(parsed.name, parsed.dryRun);
      if (result.status === "denied") {
        console.log(`DENIED: ${result.reason ?? "blocked by policy"}`);
        process.exitCode = 2;
        return;
      }

      if (result.status === "dry-run") {
        console.log(`DRY-RUN: ${result.tool.name} -> ${result.tool.command} ${result.tool.args.join(" ")}`.trim());
        return;
      }

      console.log(`EXIT CODE: ${result.exitCode ?? 1}`);
      if (result.stdout.trim().length > 0) {
        console.log("--- stdout ---");
        console.log(result.stdout.trimEnd());
      }
      if (result.stderr.trim().length > 0) {
        console.log("--- stderr ---");
        console.log(result.stderr.trimEnd());
      }

      if ((result.exitCode ?? 1) !== 0) {
        process.exitCode = result.exitCode ?? 1;
      }
      return;
    }
    default:
      printUsage();
      process.exitCode = 1;
  }
}

function isCommand(value: string): value is CliCommand {
  return value === "init" || value === "ask" || value === "watch" || value === "symbol" || value === "mcp";
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
        throw new Error("Invalid language. Use --lang typescript|python|all.");
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
  return value === "typescript" || value === "python" || value === "all";
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

function printUsage(): void {
  console.log("Usage:");
  console.log("  lca init");
  console.log("  lca ask <query>");
  console.log("  lca watch");
  console.log("  lca symbol find <symbol> [--lang typescript|python|all]");
  console.log("  lca symbol refs <symbol> [--lang typescript|python|all]");
  console.log("  lca mcp init-policy");
  console.log("  lca mcp list-tools");
  console.log("  lca mcp run-tool <tool-name> [--dry-run]");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
