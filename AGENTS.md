# AGENTS.md

Guidance for human and AI contributors working in this repository.

## Project

Local-first, open-source coding assistant (`lca`) with:

- Lexical retrieval over workspaces (`lca init`, `lca sync`, `lca ask`)
- Baseline semantic symbol navigation (`lca symbol find|refs`) for TypeScript (compiler API), Python (heuristics); C# via a Roslyn/MSBuildWorkspace worker (see `docs/adr/0002-csharp-roslyn-worker.md`)
- MCP-style tool gateway with deny-by-default policy and audit log (`lca mcp`)
- Local-only data under `.lca/` (index, sessions, policy, action log)

Locality policy: analysis of source is strictly local (no remote analysis of code ever); toolchain downloads (npm install, NuGet restore) are allowed. See `docs/adr/`. Never introduce code paths that transmit source or index data to a remote server.

## Commands

```bash
npm install        # install JS dev dependencies
npm run build      # tsc -> dist/; also builds the Roslyn worker into dist/roslyn/ (skipped with warning if dotnet is missing)
npm test           # vitest run
npm run lint       # eslint . (typescript-eslint recommended config)
npm run clean      # rm -rf dist .lca
make install       # registers the lca command into OpenCode/Claude/Kiro harnesses
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs lint, test, and build on Node 22.

## Repository layout

- `src/cli.ts`, `src/cli-runner.ts` - entry point and argument parsing/rendering
- `src/workspace-manager.ts` - root discovery, file candidates, watcher hook
- `src/lexical-index.ts`, `src/tokenizer.ts` - deterministic TF-IDF-style retrieval
- `src/semantic/` - navigators: `typescript-navigator.ts` (compiler API), `python-navigator.ts` (heuristics), `csharp-navigator.ts` (spawns the Roslyn worker), `semantic-navigator.ts` (dispatch)
- `src/mcp/` - policy store, gateway, audit logger
- `src/session-store.ts`, `src/config.ts`, `src/fs-utils.ts`, `src/runtime.ts`, `src/types.ts`
- `tests/` - vitest suites (cli-json, lexical-index, mcp-gateway, semantic-navigator)
- `tools/csharp-roslyn-worker/` - C# Roslyn worker console app (MSBuildWorkspace + SymbolFinder)
- `scripts/install-harnesses.js` - harness registration used by `make install`
- `docs/` - implementation plan, ADR log (`docs/adr/`), and language-adapter plans

## Conventions

- TypeScript, CommonJS (`"type": "commonjs"`), Node 18+ runtime; Node 22+ for dev tooling.
- Use `import`/`export`, keep files focused on one responsibility; follow the style of neighboring files.
- Deterministic ordering everywhere (localeCompare on paths, then line/column), because output feeds tests and CLI consumers.
- Do not add code comments unless the surrounding code calls for them.
- No lockfile: `package-lock.json` is intentionally exhausted. Do not commit one. Never regenerate it. Use plain `npm install` (CI uses `npm install` for the same reason).
- The previous lockfile historically pinned a private registry; do not reintroduce private-registry URLs anywhere.
- Use `/tmp/opencode` (or `tmp/`) for scratch work, not the repo root.

## Testing

- Vitest suites live in `tests/`; name files `*.test.ts`.
- Per-language semantic tests use small fixture workspaces (e.g. `tests/fixtures/`); C# tests are skipped when `dotnet` or the built worker DLL is unavailable.
- Always run `npm run lint` and `npm test` after changes; run `npm run build` before verifying CLI behavior manually.

## Verification loop

```bash
npx lca init && npx lca ask "where is workspace root discovery"  # from a scratch workspace
npx lca symbol find discoverProjectRoot --lang typescript
npx lca mcp run-tool print-ok --dry-run
```

## Git workflow

- Commit after every logical change, small commits, pushed to `origin/main` immediately.
- Commit messages: concise imperative sentences matching history style (e.g. "Add incremental sync and JSON CLI output modes").
- Never force-push unless explicitly requested. Rewriting history (e.g. with `git-filter-repo`) requires the user's explicit approval; pushes touching `.github/workflows/*` need `workflow` scope on the gh token.