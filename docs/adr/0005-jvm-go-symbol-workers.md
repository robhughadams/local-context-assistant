# ADR-0005: Java, Kotlin, and Go semantic navigation via Go and JVM workers

Status: **Accepted**

## Context

`lca symbol find|refs` supports TypeScript (compiler API, in-process), Python (heuristics), and C# (Roslyn worker, ADR-0002). Java, Kotlin, and Go were requested. None can run compiler-grade analysis in-process in the Node.js/TypeScript runtime.

Candidate approaches:

1. **Heuristic navigators** (Python-style): regex/syntax probing, `medium`/`low` confidence, perpetual parity debt. Rejected on parity grounds (same argument as ADR-0002).
2. **LSP-client integration** (gopls, Eclipse JDT LS, kotlin-language-server): external daemon protocol, extra moving parts, client-server state, no precedent in this codebase.
3. **Compiler/binary workers** (this codebase's established pattern): Go type-checker worker (`golang.org/x/tools/go/packages` + `go/types`); a JVM worker JAR serving Java via JavaParser symbol-solver and Kotlin via `kotlin-compiler-embeddable`.

JavaParser was considered for Kotlin too, but its Kotlin support is unshipped (open issue since 2018); the official Kotlin compiler is the available compiler-grade option. The Go type-checker is the vanilla binding for Go references — no LSP needed.

## Decision

- **Go worker**: `tools/go-symbol-worker/` (Go module) producing a native binary in `dist/go/`. Binding via `packages.Load(LoadAllSyntax)`; definitions from `TypesInfo.Defs` matched exactly (case-sensitive) by name; references from `TypesInfo.Uses` only when the use resolves to a found object. `source: "go-type-checker"`.
- **JVM worker**: `tools/jvm-symbol-worker/` (Gradle shadow jar) producing `dist/jvm/symbol-worker.jar`, spawned with `java -jar`. Request protocol extended with an optional `language` field (`"java" | "kotlin"`); Java routes to JavaParser symbol-solver over the workspace source set plus the running JVM (`ReflectionTypeSolver`), Kotlin to `kotlin-compiler-embeddable`. `source: "javaparser-symbol-solver"` / `"kotlin-compiler"`.
- Protocol is v1 (see `docs/java-kotlin-go-plan.md` §3); responses identical to the Roslyn worker shape; deterministic sorting (language, path, line, column, role); `bin`/`obj`/`build`/`node_modules`/`.git`/`.lca`/`coverage` segments and out-of-workspace results dropped.
- Confidence model matches TypeScript/C#: definitions `high`; definition sites in refs `role: "definition-reference"` `high`; usage sites `role: "reference"` at `medium`. Java/Kotlin/Go never emit identifier-only matches.
- Node side: `src/semantic/go-navigator.ts` and `src/semantic/jvm-navigator.ts` spawn one-shot processes with a timeout; missing toolchain/artifact → silent skip in `--lang all`, explicit error in targeted mode (same contract as C#).
- Build: `npm run build` publishes both workers (`go build`; Gradle `shadowJar`), skipping with a warning when the toolchain is absent; CI installs Go and JDK (temurin 21) and runs `go vet`+`go test` and the Gradle test suite.
- External dependency resolution (Java/Maven): best-effort classpath via `mvn dependency:build-classpath` when a `pom.xml` and `mvn` exist; otherwise source-set + JDK resolution only.

## Consequences

- Compiler-grade definitions and references for Java, Kotlin, and Go, matching the C# fidelity bar; `--lang all` spans six languages.
- Two new runtime-optional requirements: Go SDK (Go queries) and JDK 17+ (Java/Kotlin queries); non-Go/JVM features never blocked.
- Kotlin queries pay `kotlin-compiler-embeddable` memory/startup cost (~100MB JAR first download, JVM warmup per query); one-shot processes avoid state leaks but do not amortize warmup (persistent-worker improvement deferred).
- Java references are limited to the workspace source set and JDK unless a Maven classpath is present — a documented limitation comparable to C# package restore.
- Go queries may be slow on very large modules (`LoadAllSyntax` type-checks everything); mitigated by filtering and one-shot lifecycle; benchmarks may later justify a persistent worker.
- CI gains `setup-go` and `setup-java`; Gradle and Go module downloads are toolchain downloads, allowed per ADR-0001.

## Deferred (own ADR when pursued)

- LSP/client-server navigation, call-hierarchy, find-implementations.
- Gradle/Maven build-model parsing for precise source sets and classpaths.
- Cross-language (Java↔Kotlin) symbol binding.
- Persistent worker daemons and incremental compilation for all three languages.