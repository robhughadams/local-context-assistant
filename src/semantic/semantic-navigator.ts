import { CSharpNavigator } from "./csharp-navigator";
import { PythonNavigator } from "./python-navigator";
import { TypeScriptNavigator } from "./typescript-navigator";
import type { SupportedSymbolLanguage, SymbolLocation, SymbolQueryResult } from "../types";

export type SymbolQueryMode = "find" | "refs";
export type SymbolQueryLanguage = SupportedSymbolLanguage | "all";

export interface SymbolQueryOptions {
  mode: SymbolQueryMode;
  language?: SymbolQueryLanguage;
}

export class SemanticNavigator {
  private readonly workspaceRoot: string;
  private readonly typeScriptNavigator: TypeScriptNavigator;
  private readonly pythonNavigator: PythonNavigator;
  private readonly csharpNavigator: CSharpNavigator;

  constructor(workspaceRoot: string, csharpNavigator?: CSharpNavigator) {
    this.workspaceRoot = workspaceRoot;
    this.typeScriptNavigator = new TypeScriptNavigator();
    this.pythonNavigator = new PythonNavigator();
    this.csharpNavigator = csharpNavigator ?? new CSharpNavigator();
  }

  async querySymbol(symbol: string, options: SymbolQueryOptions): Promise<SymbolQueryResult> {
    const mode = options.mode;
    const language = options.language ?? "all";
    const trimmedSymbol = symbol.trim();
    if (!trimmedSymbol) {
      throw new Error("Symbol text is required.");
    }

    const tasks: Array<Promise<SymbolLocation[]>> = [];

    if (language === "all" || language === "typescript") {
      tasks.push(
        mode === "find"
          ? this.typeScriptNavigator.findDefinitions(this.workspaceRoot, trimmedSymbol)
          : this.typeScriptNavigator.findReferences(this.workspaceRoot, trimmedSymbol)
      );
    }

    if (language === "all" || language === "python") {
      tasks.push(
        mode === "find"
          ? this.pythonNavigator.findDefinitions(this.workspaceRoot, trimmedSymbol)
          : this.pythonNavigator.findReferences(this.workspaceRoot, trimmedSymbol)
      );
    }

    if (language === "all" || language === "csharp") {
      if (!this.csharpNavigator.isAvailable()) {
        if (language === "csharp") {
          throw new Error("C# analysis is unavailable: the Roslyn worker was not found. Run `npm run build` to compile it.");
        }
      } else {
        tasks.push(
          mode === "find"
            ? this.csharpNavigator.findDefinitions(this.workspaceRoot, trimmedSymbol)
            : this.csharpNavigator.findReferences(this.workspaceRoot, trimmedSymbol)
        );
      }
    }

    const groups = await Promise.all(tasks);
    const merged = groups.flat();

    merged.sort((a, b) => {
      if (a.language !== b.language) {
        return a.language.localeCompare(b.language);
      }
      if (a.relativePath !== b.relativePath) {
        return a.relativePath.localeCompare(b.relativePath);
      }
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      if (a.column !== b.column) {
        return a.column - b.column;
      }
      return a.role.localeCompare(b.role);
    });

    return {
      symbol: trimmedSymbol,
      mode,
      results: merged
    };
  }
}
