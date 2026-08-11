# ADR-0004: MCP tool gateway is deny-by-default

Status: **Accepted**

## Context

The assistant can invoke local commands on behalf of queries (git, builds, tests). Unrestricted execution is a local-RCE surface: a crafted prompt or buggy retrieval should never run arbitrary commands. Earlier milestones established the policy shape in `src/mcp/` (policy store, gateway, audit logger).

## Decision

- A tool runs only when explicitly listed in `.lca/tool-policy.json`.
- Each policy entry pins `name`, `command`, and exact `args`; anything else is rejected with a structured denial reason and a non-zero exit code (MCP deny => exit code `2`).
- Unknown tools are blocked. `--dry-run` never executes the command but still records an audit event.
- Every execution decision (execute, deny, dry-run) is appended to `.lca/actions.log.jsonl` with workspace, tool, status, reason, and exit code.

## Consequences

- Safe default: new tools silently fail until explicitly approved.
- The allowlist is part of the local data bundle under `.lca/` (no cloud sync).
- Users must manage policy files by hand; a future `lca mcp init-policy` sample scaffold exists to make this easy.
- Audit log enables replay/debugging of what ran and why.