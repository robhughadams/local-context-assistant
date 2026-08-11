# ADR-0002: C# semantic navigation via MSBuildWorkspace-backed Roslyn worker

Status: **Accepted**

## Context

`lca symbol find|refs` supports TypeScript (compiler API, in-process) and Python (heuristics). C# was requested. Roslyn is a .NET framework and cannot run in-process in the Node.js/TypeScript runtime.

Candidate approaches:

1. **Heuristic navigator** (like Python): regex/syntax probing, `medium`/`low` confidence, perpetual parity debt.
2. **Syntax-only compilation**: walk `*.cs`, build a loose `CSharpCompilation`, bind via `SemanticModel`. Fast and zero-restore, but ignores project boundaries, NuGet references, define constants (`#if DEBUG`), and skips stray/loose files vs. real build membership.
3. **Full MSBuildWorkspace**: load `.sln`/`.csproj` via MSBuild, run `dotnet restore`, resolve symbol graphs with `SymbolFinder`.

The project intentionally rejects heuristic C# (approach 1) on parity grounds. Between 2 and 3, the user chose full MSBuildWorkspace: real projects, real references, real define symbols — `dotnet restore` is a toolchain download, explicitly in scope per ADR-0001.

## Decision

- Ship a C# console worker (`tools/csharp-roslyn-worker/`, net10.0, `roslyn-worker.dll`) using `Microsoft.CodeAnalysis.Workspaces.MSBuild` + `Microsoft.Build.Locator`.
- Communication: one-shot subprocess per query, JSON request line on stdin, single JSON response line on stdout, non-zero exit code on failure (protocol version 1, see `docs/csharp-roslyn-plan.md` §3).
- Project discovery: prefer `.sln` files under the workspace root (opened via `OpenSolutionAsync`); fall back to all `.csproj` files (`OpenProjectAsync`). Excluded dirs: `.git`, `node_modules`, `dist`, `.lca`, `coverage`, `build`; results inside `bin/`/`obj/` are dropped.
- Restore runs before loading the workspace; restore or load failure returns a structured `{"ok": false, "error": ...}` response.
- Definitions via `SymbolFinder.FindDeclarationsAsync` (case-sensitive, exact match): `high` confidence, `source: "roslyn-compiler-api"`, role derived from `SymbolKind`/`TypeKind`/`MethodKind`.
- References via `SymbolFinder.FindReferencesAsync`: declaration sites emitted as `role: "definition-reference"` at `high` confidence; usage sites `role: "reference"` at `medium` (mirrors the TypeScript navigator's confidence model).
- Results are filtered to files inside the workspace root and sorted deterministically (path, line, column, kind, role).
- Node side (`src/semantic/csharp-navigator.ts`) spawns `dotnet dist/roslyn/roslyn-worker.dll`, enforces a timeout, and surfaces missing-`dotnet`/missing-build/malformed-output as clear errors. `--lang all` includes C#.

## Consequences

- Cross-project and package-reference symbol resolution are correct — the main quality win over syntax-only.
- Query latency includes restore + MSBuild load (seconds; first run can exceed a minute on large solutions).
- Requires `dotnet` SDK (10.0) on the machine for C# queries; non-C# queries are unaffected when dotnet is absent.
- Worker is published by `npm run build` into `dist/roslyn/`; CI builds and tests it under `actions/setup-dotnet` + `dotnet test`.
- Offline workspaces without restored packages will fail restore; the error message names `dotnet restore` as the cause (acceptable per ADR-0001 — not analysis traffic).
- Deferred (own ADR when pursued): persistent worker daemon, incremental compilation, call-hierarchy depth.