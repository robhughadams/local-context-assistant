# Local-Only Context Assistant - Architecture and Implementation Plan

## 1) Purpose and Goals

This project defines a local-only, free and open-source coding assistant with a hybrid context engine:

- Fast lexical/structural indexing for recall across large repositories.
- Compiler-backed semantics for precise symbol and type understanding.
- Model Context Protocol (MCP) integration so external tools can be attached in a controlled way.

Primary goals:

- Keep all code and indexing data local by default.
- Offer fast navigation and high-quality code answers across polyglot repos.
- Support extensibility through a plugin-like MCP boundary.

## 2) Non-Goals (Initial Scope)

- No cloud sync, telemetry pipeline, or hosted control plane.
- No full IDE replacement.
- No advanced team collaboration features in v0.

## 3) High-Level Architecture

The assistant is composed of six core subsystems:

1. **Workspace Manager**
   - Detects project roots, watches file changes, manages include/exclude rules.

2. **Hybrid Indexer**
   - **Lexical index**: token, file path, and snippet retrieval.
   - **Structure index**: syntax tree outlines (functions, classes, imports, references).
   - **Embedding index (optional in v0.2)**: semantic nearest-neighbor search for natural-language queries.

3. **Semantic Engine**
   - Integrates language-specific compilers/LSPs for symbol graph, type info, and go-to-definition quality.
   - Produces a normalized intermediate representation used by retrieval and prompt assembly.

4. **Context Assembler**
   - Selects and ranks files/snippets/symbols under token budget constraints.
   - Applies heuristics: recency, file importance, dependency proximity, and semantic relevance.

5. **MCP Gateway**
   - Provides a secure local boundary for tools (git, tests, build commands, docs retrieval).
   - Enforces capability policies per workspace.

6. **Assistant Runtime + UI**
   - CLI-first interface in v0.
   - Streams responses, tracks sessions, and records reproducible action logs.

## 4) Data Flow

1. User opens workspace and issues a query.
2. Workspace Manager updates file graph and incremental index.
3. Query hits lexical/structural retrieval first.
4. Semantic Engine enriches candidates (symbol/type-level ranking).
5. Context Assembler builds compact model input.
6. Runtime optionally calls MCP tools under policy.
7. Response is returned with traceable references.

## 5) Storage and Locality Guarantees

- All indexes and session metadata are stored under a local data directory.
- Source files and analysis output are never sent to a remote server. Analysis is strictly local (see `docs/adr/0001-analysis-is-strictly-local.md`).
- Toolchain downloads (npm packages, NuGet restore, SDK installs) are allowed; they are build tooling, not analysis.
- Optional remote model providers are explicit opt-in.
- A strict offline mode disables network access entirely.

## 6) Technology Direction (Initial)

- **Core runtime:** Rust or Go (final choice after prototyping based on startup latency and memory profile).
- **CLI:** native command with streaming output.
- **Parsing/semantics:** tree-sitter + language-server/compiler integrations.
- **Local DB:** SQLite (metadata + session log) and a disk-backed vector index when embeddings are enabled.

## 7) Minimal v0 Feature Set

- Initialize workspace and build baseline index.
- Ask code questions from CLI with cited file references.
- Follow symbols (definition/references) for at least TypeScript and Python.
- Run approved local commands through MCP gateway.
- Persist conversation/session state locally.

## 8) Milestones

### Milestone A - Foundation

- Repository scaffolding and build tooling.
- Workspace detection and filesystem watcher.
- Basic lexical index and snippet retrieval.

### Milestone B - Semantic Navigation

- Symbol graph for TypeScript and Python.
- Definition/reference APIs.
- Context ranking that mixes lexical and semantic signals.

### Milestone C - MCP and Runtime

- MCP gateway with local capability policy.
- CLI assistant loop with streaming responses.
- Action audit log and replay basics.

### Milestone D - Quality and Packaging

- Benchmarks (index build time, query latency, memory budget).
- End-to-end tests on sample polyglot repos.
- Release packaging and installation docs.

## 9) Risks and Mitigations

- **Index staleness in large repos** -> incremental updates plus periodic reconciliation.
- **Language parity gaps** -> prioritize two languages first, then expand via adapters.
- **Token budget pressure** -> deterministic context pruning and citation-first output.
- **Tool safety** -> deny-by-default MCP permissions.

## 10) Success Criteria for v0

- Median query-to-first-token under 2 seconds on warm index.
- >85% precision for top-5 retrieved snippets on benchmark tasks.
- Accurate symbol resolution for TypeScript/Python baseline projects.
- Reproducible local runs with no mandatory external services.

## 11) Future Extensions (Post-v0)

- Additional languages (Java/Kotlin settled as a JVM worker - see `docs/adr/0005-jvm-go-symbol-workers.md`; Go settled as a native worker; Rust under evaluation as beyond-scope).
- Optional local reranker and embedding model packs.
- IDE plugins (JetBrains/VS Code) sharing the same local engine.
- Team-safe shareable context bundles with explicit redaction rules.
