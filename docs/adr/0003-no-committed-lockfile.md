# ADR-0003: No committed package lockfile

Status: **Accepted**

## Context

The original `package-lock.json` was generated through a private npm registry proxy (`artifacts.takeaway.com`). Every `resolved` URL in the lockfile pointed at that proxy. Effects:

- CI (`npm ci`) hung and failed on GitHub runners that could not reach the private registry.
- The committed file leaked an internal registry hostname into a public repository.
- The lockfile pinned `vite@7` (transitive via vitest), whose engine range excludes the Node 18 used by CI at the time.

The file and all history containing it were purged via `git filter-repo`, and the workflow was changed to run on Node 22 with `npm install`.

## Decision

- `package-lock.json` is gitignored and is never committed.
- The lockfile is never regenerated, and private-registry URLs are never reintroduced anywhere in the repo.
- Dependency installation is unlocked `npm install` (local and CI), resolving from `package.json` ranges at install time.
- CI pins the Node major (22) and uses `npm install`; no `cache: npm` (which requires a lockfile).

## Consequences

- Installation is not reproducible to exact transitive versions; drift is bounded by the declared semver ranges.
- CI is slower (no npm cache key) and slightly flakier across new releases within ranges.
- If exact pinning is needed later, prefer explicit `package.json` ranges or an allowlisted registry — never a committed lockfile. A future ADR may revisit with a public-registry lockfile.