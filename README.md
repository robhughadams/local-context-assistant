# Local Context Assistant

Local-first, open-source coding assistant with a practical MVP focused on lexical retrieval.

## MVP scope (Milestones A-C subset)

- Node + TypeScript scaffold with build/test/lint scripts.
- Workspace manager for root discovery, file inclusion/exclusion, and a basic file-watch hook.
- Local lexical indexer with deterministic scoring.
- CLI commands to initialize an index and query with cited file/line references.
- Baseline semantic symbol navigation for TypeScript and Python.
- Local session persistence under workspace data.
- MCP gateway with deny-by-default command policy and local audit logging.

No cloud APIs and no remote dependencies are required at runtime.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
npm run build
npm test
```

## CLI usage

From your target workspace root:

```bash
# build index
npx lca init

# ask a question
npx lca ask "where is workspace root discovery"

# optional basic watcher hook
npx lca watch

# semantic definition lookup
npx lca symbol find discoverProjectRoot --lang typescript

# semantic references lookup
npx lca symbol refs discoverProjectRoot --lang all

# initialize MCP tool policy file (deny-by-default)
npx lca mcp init-policy

# list approved MCP tools
npx lca mcp list-tools

# run approved tool
npx lca mcp run-tool print-ok

# preview run without executing
npx lca mcp run-tool print-ok --dry-run
```

## Data storage

The assistant stores local metadata in:

- `.lca/index.json` - persisted lexical index metadata and snippets
- `.lca/sessions.json` - local query session history
- `.lca/tool-policy.json` - explicit MCP tool allowlist (deny-by-default)
- `.lca/actions.log.jsonl` - tool execution audit trail (includes dry-run/deny/execute events)

Both files are local-only by default.

## Deterministic lexical retrieval

Retrieval uses:

- text tokenization (lowercase alphanumeric terms, stopword filtering)
- snippet chunking by fixed line windows
- TF-IDF style scoring + query-term coverage boost
- deterministic tie-breaking by file path and line range

## Semantic symbol navigation (baseline)

`lca symbol` adds milestone-B style semantic navigation:

- `lca symbol find <symbol>` returns definition candidates.
- `lca symbol refs <symbol>` returns reference candidates.
- `--lang` accepts `typescript`, `python`, or `all` (default).

Output includes file/line/column plus confidence metadata:

- TypeScript uses the local TypeScript compiler API (`source=typescript-compiler-api`) and returns high-confidence definitions/references in local workspace files.
- Python uses pragmatic local heuristics (`source=python-heuristic`) with confidence levels (`high` / `medium` / `low`) to indicate certainty.

## MCP gateway policy model (milestone C)

MCP tool execution is local-only and deny-by-default.

- A tool can run only if it is explicitly present in `.lca/tool-policy.json`.
- Each tool is pinned by `name`, `command`, and exact `args`.
- Any unknown tool is blocked with a clear denial reason.
- `--dry-run` never executes the command but still records an audit event.

Example policy file:

```json
{
  "version": 1,
  "tools": [
    {
      "name": "print-ok",
      "command": "node",
      "args": ["-e", "process.stdout.write('ok')"]
    }
  ]
}
```

## Limitations (current MVP)

- Semantic navigation is baseline only (no full project-wide type graph or cross-package resolution yet).
- Python navigation is heuristic and intentionally conservative.
- Watcher is intentionally basic and non-recursive in this version.
- Index persistence is JSON-based metadata (SQLite can be added in a later milestone).

## Development scripts

- `npm run build`
- `npm test`
- `npm run lint`
