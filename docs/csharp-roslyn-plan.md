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
           ├─ spawns `dotnet dist/roslyn/roslyn-worker.dll`
           │    └─ (tools/csharp-roslyn-worker/ - C# console app)
           │        ├─ walks workspace for *.cs (same exclusions as TS navigator)
           │        ├─ parses syntax trees, builds CSharpCompilation
           │        │    (workspace sources only - no NuGet/package refs)
           │        └─ finds definitions/references via SemanticModel
           └─ ← JSON response on stdout, mapped to SymbolLocation[]
```

### Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Worker lifecycle | One-shot process per query | Simple, no state leaks, no stream protocol complexity; query latency is dominated by compile time anyway |
| Project model | `CSharpCompilation` of workspace `*.cs` files, no `.csproj` loading | Mirrors the TS navigator's baseline (no cross-package resolution); zero network/restore; deterministic |
| Missing `dotnet` | Clear, actionable error; `--json` errors still structured | Graceful degradation like other CLI errors |
| Worker artifacts | Built into `dist/roslyn/` by `npm run build` | Self-contained for harness installs (`make install`) |
| .NET version | Current LTS (net8.0 or later LTS available) | LTS security + hosted runner support |

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

- **Definitions** (find): declarations found by symbol-name match on declaration identifiers, resolved through `SemanticModel` - `high` confidence.
- **References** (refs): `IdentifierName`/`GenericName` nodes bound via `SemanticModel` to the same `ISymbol` (handles overloads, generics, member accesses). Entries whose bound symbol is a declaration site are `high`; plain usage sites are `medium` (mirrors the TS navigator).
- Declaration kinds covered: `class`, `record`, `struct`, `interface`, `enum`, `namespace`, `method`, `constructor`, `property`, `field`, `event`, `parameter`, `local`.

## 5) Implementation Phases

### Phase 1 - Roslyn worker (C#, `tools/csharp-roslyn-worker/`)

- `Worker.csproj` referencing `Microsoft.CodeAnalysis.CSharp` (no `Microsoft.CodeAnalysis.Workspaces` for MVP).
- Workspace file discovery: recursive walk for `*.cs`, excluding `.git`, `node_modules`, `dist`, `.lca`, `coverage`, `build` (same set as `typescript-navigator.ts`).
- `CSharpCompilation` built from syntax trees; permissive options (`optimization` off, all warnings as info) so incomplete projects still analyze.
- Definition/reference resolution per the protocol above.
- C# unit tests (xunit) for: discovery, definition kinds, reference binding, JSON serialization, empty workspace.

### Phase 2 - Node integration

- `src/semantic/csharp-navigator.ts`:
  - Resolves worker DLL at `dist/roslyn/roslyn-worker.dll` relative to the package root.
  - Spawns `dotnet <dll>`, writes the JSON request, parses the response, maps to `SymbolLocation[]`.
  - Missing `dotnet`/missing DLL/worker crash/timeout -> thrown error with actionable message; `--json` mode preserves structured errors and non-zero exit.
- `src/types.ts`: add `"csharp"` to `SupportedSymbolLanguage`.
- `src/semantic/semantic-navigator.ts`: dispatch to `CSharpNavigator` for `csharp` and `all`.
- `src/cli-runner.ts`: accept `--lang csharp`, update `isLanguage` validation and help text.

### Phase 3 - Build, CI, and tests

- `npm run build` also builds the worker: `dotnet build tools/csharp-roslyn-worker -c Release -o dist/roslyn`.
  - When `dotnet` is unavailable locally, skip with a warning (does not fail the JS build).
  - CI always installs the .NET SDK, so CI build is strict.
- CI workflow: add `actions/setup-dotnet` step; add `dotnet build` + `dotnet test` steps for the worker.
- Vitest suite: fixture C# workspace under `tests/fixtures/csharp/`; tests skipped when `dotnet` or the built worker DLL is unavailable.
- Optional: `Makefile` `worker` target for rebuilding the worker without a full `npm run build`.

### Phase 4 - Docs

- README: document `.NET SDK` as a runtime-optional requirement (only needed for `--lang csharp`), usage example, and the local-only scope of the analysis.
- Update `Limitations` section: C# is syntax+compilation level; no `.csproj`/NuGet reference resolution yet.
- This plan file's `Status` section updated as phases land.

## 6) Acceptance Criteria

- `lca symbol find MyClass --lang csharp` returns `high`-confidence definitions with correct file/line/column in a fixture project.
- `lca symbol refs MyMethod --lang csharp` returns usage sites with `medium`/`high` confidence; `--json` output shape matches the other languages.
- `--lang all` includes C# alongside TypeScript/Python, sorted deterministically.
- CI green: JS lint/test/build + worker build/test on Ubuntu with .NET SDK.
- `lca symbol find Foo --lang csharp` without `dotnet` installed fails with a clear message (and structured JSON in `--json` mode).

## 7) Risks and Mitigations

- **Compilation errors in real-world workspaces** -> permissive compilation settings; unresolved references degrade to name-matched `medium` results instead of failure.
- **Roslyn compile latency on large repos** -> same order as the TS language-service startup today; one-shot processes avoid accumulation. Revisit with a persistent worker only if benchmarks demand it.
- **Worker/build drift** -> `dist/roslyn/` rebuilt on every `npm run build`; CI verifies worker builds.
- **dotnet missing on user machines** -> runtime-optional dependency with explicit error, never blocks non-C# queries.

## 8) Out of Scope (later milestone)

- `MSBuildWorkspace` project loading: real `.csproj`/`.sln`/NuGet reference resolution. Requires `dotnet restore` (network), so it is deferred to keep the no-remote-dependencies goal intact.
- Persistent worker daemon and incremental compilation across queries.
- Find-all-implementations / call-hierarchy depth.
- C# lexical indexing improvements (beyond what the generic tokenizer already provides).

## 9) Status

- [ ] Phase 1: Roslyn worker
- [ ] Phase 2: Node integration
- [ ] Phase 3: Build, CI, tests
- [ ] Phase 4: Docs
