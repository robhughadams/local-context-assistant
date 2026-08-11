# C# Semantic Navigation via Roslyn - Implementation Plan

## 1) Background and Rationale

`lca symbol find|refs` currently supports `typescript` (TypeScript compiler API, in-process) and `python` (local heuristics). C# is the next target. The C# compiler, Roslyn (`Microsoft.CodeAnalysis.CSharp`), is a .NET framework and cannot run in-process in this Node.js/TypeScript codebase, so the semantic analysis must live in a small C# worker process spawned by the Node runtime.

### Why Roslyn rather than heuristics

- Roslyn is the C# compiler: symbol resolution, overloads, generics, and partial classes behave correctly.
- It matches the existing TypeScript navigator's `source: "typescript-compiler-api"` fidelity model with `source: "roslyn-compiler-api"`.
- A syntax-only regex/heuristic C# navigator (like the Python one) would have `medium`/`low` confidence and add a third tier of parity debt.

## 2) Architecture

```
lca symbol find Foo --lang csharp
   └─ SemanticNavigator (Node)
       └─ CSharpNavigator (src/semantic/csharp-navigator.ts)
           ├─ locates dist/roslyn/roslyn-worker.dll
           ├─ spawns `dotnet dist/roslyn/roslyn-worker.dll` (one-shot per query)
           │    └─ (tools/csharp-roslyn-worker/ - C# console app, net10.0)
           │        ├─ discovers .sln (preferred) or .csproj under the workspace
           │        ├─ runs `dotnet restore` (toolchain download - allowed, see ADR-0001)
           │        ├─ loads projects via MSBuildWorkspace
           │        ├─ resolves symbols with SymbolFinder (definitions/references)
           │        └─ drops results in bin/obj or outside the workspace root
           └─ ← JSON response on stdout, mapped to SymbolLocation[]
```

### Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Worker lifecycle | One-shot process per query | Simple, no state leaks, no stream protocol complexity |
| Project model | Full MSBuildWorkspace: `.sln` first, else `.csproj`, after `dotnet restore` | Real project boundaries, NuGet/package references, define constants (`#if DEBUG`) bind correctly; cross-project references resolve |
| Restore | Runs inside the worker before loading | Toolchain download is allowed by the locality policy (ADR-0001); restore failure returns a structured error |
| Missing `dotnet` | Clear, actionable error; `--json` errors still structured | Graceful degradation like other CLI errors |
| Worker artifacts | Built into `dist/roslyn/` by `npm run build` | Self-contained for harness installs (`make install`) |
| .NET version | net10.0 (LTS) | Long-term support; present in CI via setup-dotnet |

## 3) JSON Protocol

Request (single line JSON on stdin):

```json
{
  "version": 1,
  "mode": "find" | "refs",
  "symbol": "Foo",
  "workspaceRoot": "/absolute/path"
}
```

Response (single line JSON on stdout):

```json
{
  "ok": true,
  "results": [
    {
      "language": "csharp",
      "symbol": "Foo",
      "kind": "definition" | "reference",
      "role": "class" | "method" | "property" | ...,
      "relativePath": "src/Program.cs",
      "line": 12,
      "column": 9,
      "confidence": "high" | "medium",
      "source": "roslyn-compiler-api"
    }
  ]
}
```

Errors: `{"ok": false, "error": "..."}` on stdout plus non-zero exit code. Node side applies a timeout and kills hung workers.

## 4) Confidence and Coverage Model

- **Definitions** (find): symbols resolved via `SymbolFinder.FindDeclarationsAsync` (exact, case-sensitive match) across the loaded solution - `high` confidence, `source: "roslyn-compiler-api"`.
- **References** (refs): `SymbolFinder.FindReferencesAsync` per matched declaration. Declaration sites are emitted as `role: "definition-reference"` at `high` confidence; genuine usage sites (including cross-project and package-resolved ones) are `role: "reference"` at `medium` (mirrors the TS navigator).
- Roles derive from `SymbolKind`/`TypeKind`/`MethodKind`: `class`, `record`, `struct`, `interface`, `enum`, `delegate`, `namespace`, `method`, `constructor`, `property`, `field`, `event`, `parameter`, `local`, `type-parameter`, and friends.
- Partial declarations and source-generated symbols: all declaration locations of a matched symbol are returned; results inside `bin/`/`obj/` segments or outside the workspace root are filtered out.

## 5) Implementation Phases

### Phase 1 - Roslyn worker (C#, `tools/csharp-roslyn-worker/`)

- `Worker.csproj` (net10.0) referencing `Microsoft.CodeAnalysis.Workspaces.MSBuild` and `Microsoft.Build.Locator`.
- Project discovery: recursive walk for `.sln` (preferred) or `.csproj`, excluding `.git`, `node_modules`, `dist`, `.lca`, `coverage`, `build`.
- `dotnet restore` on each discovered project before workspace load; failures produce structured errors.
- `MSBuildWorkspace` load (`OpenSolutionAsync`/`OpenProjectAsync`) with `MSBuildLocator.RegisterDefaults()`.
- Definition/reference resolution via `SymbolFinder` per the protocol above.
- Results filtered to workspace files, `bin`/`obj` segments dropped, deterministically sorted.
- C# unit tests (xunit) for: discovery, definition roles, reference confidence, cross-project binding, protocol validation, restore/load failures.

### Phase 2 - Node integration

- `src/semantic/csharp-navigator.ts`:
  - Resolves worker DLL at `dist/roslyn/roslyn-worker.dll` relative to the package root.
  - Spawns `dotnet <dll>`, writes the JSON request, parses the response, maps to `SymbolLocation[]`.
  - Missing `dotnet`/missing DLL/worker crash/timeout -> thrown error with actionable message; `--json` mode preserves structured errors and non-zero exit.
- `src/types.ts`: add `"csharp"` to `SupportedSymbolLanguage`.
- `src/semantic/semantic-navigator.ts`: dispatch to `CSharpNavigator` for `csharp` and `all`.
- `src/cli-runner.ts`: accept `--lang csharp`, update `isLanguage` validation and help text.

### Phase 3 - Build, CI, and tests

- `npm run build` also publishes the worker: `dotnet publish tools/csharp-roslyn-worker -c Release -o dist/roslyn`.
  - When `dotnet` is unavailable locally, skip with a warning (does not fail the JS build).
  - CI always installs the .NET SDK, so CI build is strict.
- CI workflow: add `actions/setup-dotnet` step; add `dotnet test` (xunit) + `dotnet publish` steps for the worker.
- Vitest suite: fixture C# solution under `tests/fixtures/csharp/` (two projects, one cross-project reference); tests skipped when `dotnet` or the built worker DLL is unavailable.
- Optional: `Makefile` `worker` target for rebuilding the worker without a full `npm run build`.

### Phase 4 - Docs

- README: document `.NET SDK` as a runtime-optional requirement (only needed for `--lang csharp`), usage example, and the locality policy (analysis local; toolchain downloads including NuGet restore allowed - ADR-0001).
- Update `Limitations` section: C# queries require restore + network for packages; `.sln`-less workspaces fall back to `.csproj`; generated-code results are filtered.
- This plan file's `Status` section updated as phases land.

## 6) Acceptance Criteria

- `lca symbol find MyClass --lang csharp` returns `high`-confidence definitions with correct file/line/column in a fixture project.
- `lca symbol refs MyMethod --lang csharp` returns usage sites with `medium`/`high` confidence; `--json` output shape matches the other languages.
- `--lang all` includes C# alongside TypeScript/Python, sorted deterministically.
- CI green: JS lint/test/build + worker build/test on Ubuntu with .NET SDK.
- `lca symbol find Foo --lang csharp` without `dotnet` installed fails with a clear message (and structured JSON in `--json` mode).

## 7) Risks and Mitigations

- **Restore/network failures** -> restore errors are surfaced as structured errors naming `dotnet restore`; packages are cached locally after first restore, so repeat queries are offline-friendly once restored.
- **Workspace load latency on large solutions** -> seconds to a minute on first load; one-shot processes avoid accumulation. Revisit with a persistent worker only if benchmarks demand it.
- **Broken projects in a solution** -> MSBuildWorkspace reports failures without aborting; only query-relevant projects need to load.
- **Worker/build drift** -> `dist/roslyn/` rebuilt on every `npm run build`; CI verifies worker builds.
- **dotnet missing on user machines** -> runtime-optional dependency with explicit error, never blocks non-C# queries.

## 8) Out of Scope (later milestone)

- Persistent worker daemon and incremental compilation across queries.
- Find-all-implementations / call-hierarchy depth.
- `#if`-branch enumeration and multi-targeting matrix analysis (workspace loads with its default configuration).
- C# lexical indexing improvements (beyond what the generic tokenizer already provides).

## 9) Status

- [ ] Phase 1: Roslyn worker
- [ ] Phase 2: Node integration
- [ ] Phase 3: Build, CI, tests
- [ ] Phase 4: Docs
