# Java, Kotlin, and Go Semantic Navigation - Implementation Plan

## 1) Background and Rationale

`lca symbol find|refs` supports `typescript` (compiler API, in-process), `python` (local heuristics), and `csharp` (Roslyn worker, see `docs/csharp-roslyn-plan.md`). Java, Kotlin, and Go are the next targets.

The three languages share a constraint with C#: compiler-grade analysis cannot run in-process in the Node.js/TypeScript runtime. We follow the established worker pattern (ADR-0002): a native/binary worker process spawned per query, talking the same JSON stdin/stdout protocol.

Chosen implementations (per user decision):

- **Go**: a Go worker using `golang.org/x/tools/go/packages` with `LoadAllSyntax`; binding via `go/types` `TypesInfo.Defs`/`TypesInfo.Uses`. This is the vanilla compiler type-checker — no heuristics, no LSP client needed.
- **Java**: JavaParser (`javaparser-symbol-solver-core`) parses and type-resolves the workspace source set; JDK classes resolve via the running JVM (`ReflectionTypeSolver`). JavaParser's Kotlin support is unshipped (open issue since 2018), so Kotlin does NOT reuse it.
- **Kotlin**: the official `kotlin-compiler-embeddable` (the Kotlin compiler itself, same engine ktlint/detekt use) — parse + bind via the compiler's resolution APIs.
- Java and Kotlin share one JVM worker JAR (one toolchain: JDK), served by a `language` request field. Go is its own native worker binary (toolchain: Go SDK).

### Why compiler/type-based rather than heuristics

Same argument as ADR-0002 for C#: regex probing gives `medium`/`low` confidence, overloads and generics behave wrong, and language parity debt grows. TypeScript and C# already set the `high`-confidence bar; Go's type-checker, the Kotlin compiler, and JavaParser's symbol solver are the closest equivalent fidelity per toolchain cost.

## 2) Architecture

```
lca symbol find Foo --lang java|kotlin|go
   └─ SemanticNavigator (Node)
       ├─ GoNavigator        → spawns dist/go/go-symbol-worker  (native binary)
       │                        (tools/go-symbol-worker/ - Go module)
       │                        └─ go/packages LoadAllSyntax + go/types binding
       │                            ├─ find: TypesInfo.Defs matched by name
       │                            └─ refs: TypesInfo.Uses resolving to the found object
       └─ JvmNavigator        → spawns `java -jar dist/jvm/symbol-worker.jar`
                                (tools/jvm-symbol-worker/ - Gradle project)
                                └─ java: JavaParser symbol-solver over the workspace source set
                                └─ kotlin: kotlin-compiler-embeddable binding over .kt sources
   └─ ← JSON response on stdout, mapped to SymbolLocation[]
```

### Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Worker lifecycle | One-shot process per query | Same as Roslyn worker; no state leaks |
| Go binding | `go/packages` `LoadAllSyntax` | Type-checker-grade defs/uses; loads the module including cross-package workspace refs; no `go build` output needed |
| Kotlin binding | `kotlin-compiler-embeddable` | Official compiler: correct overloads, generics, delegated members |
| Java binding | JavaParser + symbol solver | No `javac` invocation; resolves within the workspace source set and JDK classes via the running JVM |
| External deps (Java/Maven) | Best-effort classpath | `mvn dependency:build-classpath` when available (toolchain download, ADR-0001); otherwise only source-set + JDK resolution |
| JVM worker serves both languages | `language` request field | One toolchain, one artifact, one protocol |
| Build outputs | Go native binary in `dist/go/`; fat JAR in `dist/jvm/` | Published by `npm run build`; skipping with a warning when the toolchain is absent |
| `--lang all` | Silent skip when a worker/toolchain is missing; explicit `--lang` fails loudly | Mirrors the C# behavior |
| Runtime requirements | Go SDK (Go), JDK (Java/Kotlin), both runtime-optional | Non-querying features never blocked |

Note (ADR-0001): toolchain downloads (Go modules, Gradle distribution, Maven artifacts, `apt`/SDK installs) are allowed; only source/index analysis must stay local.

## 3) JSON Protocol

Request (single line JSON on stdin) - protocol v1, extended:

```json
{
  "version": 1,
  "language": "java" | "kotlin",   // optional; only the JVM worker reads it
  "mode": "find" | "refs",
  "symbol": "Foo",
  "workspaceRoot": "/absolute/path"
}
```

The Go worker ignores `language` (its binary is per-language already); the Roslyn worker is unchanged and ignores unknown fields.

Response (single line JSON on stdout) - identical to v1:

```json
{
  "ok": true,
  "results": [
    {
      "language": "java" | "kotlin" | "go",
      "symbol": "Foo",
      "kind": "definition" | "reference",
      "role": "class" | "interface" | "fun" | "func" | ...,
      "relativePath": "src/Main.java",
      "line": 12,
      "column": 9,
      "confidence": "high" | "medium",
      "source": "javaparser-symbol-solver" | "kotlin-compiler" | "go-type-checker"
    }
  ]
}
```

Errors: `{"ok": false, "error": "..."}` on stdout plus non-zero exit. Node side applies a timeout and kills hung workers.

## 4) Confidence and Coverage Model

- **Definitions** (find): exact, case-sensitive name match against compiler-bound declarations - `high`, `source` per worker above.
- **References** (refs): declaration sites emitted as `role: "definition-reference"` at `high`; usage sites bound to the same symbol at `medium` (mirrors TypeScript/C#).
  - Go: `TypesInfo.Uses` — usage sites are only emitted when they resolve to the found object (identifier-only matches are not emitted).
  - Kotlin: `bindingContext`/resolution of `KtReferenceExpression` targets.
  - Java: JavaParser expression resolution; expressions that fail the type solver are **not** emitted (no identifier-only fallback).
- Roles derive from the bound kind: Java `class`/`interface`/`enum`/`record`/`annotation`/`method`/`constructor`/`field`/`parameter`/`local`/`type-parameter`; Kotlin `class`/`data-class`/`object`/`companion-object`/`interface`/`enum`/`sealed`/`annotation`/`function`/`property`/`constructor`/`field`/`parameter`/`local`/`type-parameter`/`type-alias`; Go `func`/`method`/`type`/`struct`/`interface`/`var`/`const`/`field`/`pkg`/`alias`/`type-parameter`.
- Filtering: `bin`/`obj`/`build`/`node_modules`/`.git`/`.lca`/`coverage` segments and files outside the workspace root dropped; results sorted deterministically (language, path, line, column, role).

## 5) Implementation Phases

### Phase 1 - Go worker (`tools/go-symbol-worker/`)

- Go module; deps: `golang.org/x/tools/go/packages` (and its transitive `go/types` use).
- `packages.Load` with `LoadAllSyntax` on the module rooted at `workspaceRoot` (module discovery falls back to `go list ./...`-style walking).
- Find: walk `TypesInfo.Defs` (package-scope objects + methods/fields from declaration AST) matching the symbol name; map GOTypes roles.
- Refs: walk `TypesInfo.Uses`; emit uses resolving to a found definition (`definition-reference` at declaration sites).
- Unit tests (Go `testing`) for discovery, roles, references, protocol validation, error paths.
- Output: `go build -o dist/go/go-symbol-worker` (platform-specific binary; current CI target Linux).

### Phase 2 - JVM worker (`tools/jvm-symbol-worker/`)

- Gradle project; shadow jar `dist/jvm/symbol-worker.jar`; deps: `javaparser-symbol-solver-core` (Java), `kotlin-compiler-embeddable` (Kotlin).
- CLI: `java -jar <jar>`, read stdin JSON, `language` request field routes to the Java or Kotlin resolver.
- Java resolver: collect `*.java` under the workspace root (exclusions per §4); `JavaParserFacade` with `CombinedTypeSolver(JavaParserTypeSolver(roots) + ReflectionTypeSolver)`; optional Maven classpath via `mvn dependency:build-classpath` when a `pom.xml` exists and `mvn` is present.
- Kotlin resolver: `KotlinCoreEnvironment` (JVM config files) over `.kt` source roots, resolution via the compiler API; roles from declaration kinds.
- Unit tests (kotlin.test / JUnit) for both resolvers + protocol validation, run by Gradle in CI.

### Phase 3 - Node integration

- `src/semantic/go-navigator.ts`: spawn `dist/go/go-symbol-worker`, protocol guard, timeout.
- `src/semantic/jvm-navigator.ts`: spawn `java -jar dist/jvm/symbol-worker.jar` with `language` set; availability = both `java` on PATH and the JAR present.
- `src/types.ts`: `SupportedSymbolLanguage` += `"java"`, `"kotlin"`, `"go"`.
- `src/semantic/semantic-navigator.ts`: dispatch for `all`/per-language, silent skip vs loud error like C#.
- `src/cli-runner.ts`: `--lang java|kotlin|go`, `isLanguage` validation, help text.

### Phase 4 - Build wiring, CI, tests

- `npm run build`: publish Go worker (`go build`) and JVM worker (`gradle shadowJar`), each skipped with a warning if the toolchain is missing; `Makefile` `worker` target extends to both.
- CI: `setup-go` (stable), `setup-java` (temurin 21) steps; `go test` + `go vet` for the Go worker; Gradle build + tests for the JVM worker; worker publish before vitest.
- Vitest fixtures: `tests/fixtures/java/` (small Maven-layout project), `tests/fixtures/kotlin/`, `tests/fixtures/go/` (single module, cross-package reference); navigator tests skipped when the toolchain/artifact is unavailable.
- `.gitignore` additions: `**/target/` (Maven), `**/build/` already covered, Gradle caches outside repo.

### Phase 5 - Docs

- README: requirements section gains Go SDK and JDK (both runtime-optional); `--lang` examples for `java`/`kotlin`/`go`; locality note (analysis local; module/Gradle/Maven downloads are toolchain, ADR-0001).
- `docs/implementation-plan.md` §11: Java/Kotlin/Go moved from future to supported.
- This plan's `Status` section and a new ADR (`0005`) as the approach lands.

## 6) Acceptance Criteria

- `lca symbol find|refs --lang go|java|kotlin` return correct `high` definitions / `medium` usage sites with file/line/column in fixture workspaces.
- `--lang all` includes all six languages, deterministically sorted; missing worker/toolchain in `all` skips quietly, in explicit mode errors clearly (`--json` stays structured).
- CI green: JS lint/test/build; Go worker `go vet`+`go test`; JVM worker Gradle test+build; all worker artifacts published before vitest.
- `build` skips (with warning) when a toolchain is absent, never fails the JS build.

## 7) Risks and Mitigations

- **Gradle daemon / JVM heap in CI** -> `--no-daemon`, bounded workers; shadow JAR download can be ~100MB (kotlin-compiler-embeddable) - mitigated by CI caching.
- **Java externally-typed references unresolvable** -> refs limited to source-set + JDK resolution; Maven classpath best-effort. Documented limitation (like C# package restore).
- **Go module load latency / compile deps** -> `LoadAllSyntax` can be slow on huge modules; one-shot processes avoid accumulation; revisit with a persistent worker only if benchmarks demand.
- **Native Go binary portability** -> built per-platform by `npm run build`/CI on the target OS; Linux-first (CI Ubuntu).
- **Toolchain absence on user machines** -> runtime-optional with explicit errors, never blocking non-Go/JVM queries (same contract as dotnet for C#).
- **Android/UserLAnd sandbox limits** -> JVM/Go installs are allowed as toolchain downloads (ADR-0001); local verification mirrors the C# approach (protocol smoke tests against published artifacts; full suites in CI).

## 8) Out of Scope (later milestone)

- LSP-based or `gopls`-protocol integration; IDE-style find-implementations / call-hierarchy.
- Gradle/Maven build-model parsing for classpath & source-set discovery (workspace-wide `*.java`/`*.kt` scanning now; dependency classpath best-effort).
- Cross-language references (Java↔Kotlin in one workspace) - Java and Kotlin resolvers stay independent.
- Windows/macOS worker binaries in `npm run build` (release packaging milestone).

## 9) Status

- [ ] Phase 1: Go worker
- [ ] Phase 2: JVM worker (Java + Kotlin)
- [ ] Phase 3: Node integration
- [ ] Phase 4: Build, CI, tests
- [ ] Phase 5: Docs