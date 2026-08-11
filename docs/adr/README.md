# Architecture Decision Records

This log records significant architecture decisions for Local Context Assistant. Each record states the context, the decision, and its consequences. New records are never edited after acceptance; follow-ups are new records that supersede or amend.

## Format

- Filename: `NNNN-short-kebab-case-title.md` (zero-padded, sequential).
- Status values: `Proposed` | `Accepted` | `Superseded by ADR-NNNN` | `Deprecated`.
- A record is `Accepted` once implemented; earlier it may be `Proposed`.
- Keep records short: context, decision, consequences. Reference code paths and other ADRs where useful.

## Index

| ID | Title | Status |
|---|---|---|
| [0001](0001-analysis-is-strictly-local.md) | Source analysis is strictly local; toolchain downloads are allowed | Accepted |
| [0002](0002-csharp-roslyn-worker.md) | C# semantic navigation via MSBuildWorkspace-backed Roslyn worker | Accepted |
| [0003](0003-no-committed-lockfile.md) | No committed package lockfile | Accepted |
| [0004](0004-mcp-deny-by-default.md) | MCP tool gateway is deny-by-default | Accepted |

## Relationship to other docs

- `docs/implementation-plan.md` - long-term architecture and milestones.
- `docs/csharp-roslyn-plan.md` - detailed C# worker implementation plan.
- `AGENTS.md` - contributor guidance mirroring the decisions below.