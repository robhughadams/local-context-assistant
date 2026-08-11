# ADR-0001: Source analysis is strictly local; toolchain downloads are allowed

Status: **Accepted**

## Context

The project's tagline has long been "no cloud APIs and no remote dependencies". That phrasing is ambiguous in two directions:

- Read strictly, it forbids dependency downloads (npm install, NuGet restore), which every practical build needs.

  The C# milestone needs a real compiler toolchain: `dotnet restore` fetches NuGet packages (Roslyn, MSBuild) from nuget.org to build the analysis worker. Blocking that makes the feature impossible.

- Read loosely, it could be stretched to allow outsourcing analysis, e.g. sending source code or index data to a remote analysis/embedding/LLM service. That must never happen implicitly.

## Decision

- **Analysis of user source code is strictly local.** No source content, snippets, index data, or session data generated from source is ever transmitted to a remote server. There is no remote analysis endpoint, no cloud indexing, no telemetry carrying code, and no implicit model/API calls that receive code.
- **Toolchain downloads are allowed and are not "analysis".** Downloading compiler/packaging artifacts (npm packages, NuGet packages, .NET SDK distribution) at install/build/restore time is permitted. The Roslyn worker runs `dotnet restore` before analyzing a workspace (see ADR-0002).
- **Generated analysis data stays on disk under `.lca/`** (index, sessions, tool policy, action log).
- Any future feature that would transmit source or analysis data (cloud embeddings, remote LSP, hosted analysis) requires explicit user opt-in and its own ADR.

## Consequences

- `dotnet restore` in the worker (ADR-0002) is consistent with policy.
- Docs should use precise wording: "analysis is local" and "toolchain downloads are allowed", not blanket "no network".
- Feature reviews must classify network use as `toolchain` (allowed) vs `analysis` (prohibited without opt-in).