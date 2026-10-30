# CLAUDE.md – d365fo-hso-mcp-server (fork of dynamics365ninja/d365fo-mcp-server)

Thin fork: branch `d365dev` = upstream release tag + small, separate commits; tags `v<upstream>-d365dev.<n>`.
Every change is also meant as an upstream pull request. `main` mirrors upstream `main`; never commit to it.

## Rules
- Public repository: no customer names, customer code, internal hostnames, keys or URLs. Examples use "Contoso".
- Ask the human before: git push, creating tags on the remote, filing issues/PRs upstream, installing packages, sudo.
- No secrets in files, commits, logs or chat. Credentials for this repo are the human's, configured outside the repo.
- No change to the C# bridge (`bridge/`) without the human's OK (bridge builds need a D365 dev VM and the attestation file).
- Upstream conventions apply: TypeScript strict, biome lint/format, vitest tests next to the existing ones, settings registered
  in `src/config/settings.ts` (they generate docs/CONFIGURATION.md: `npm run config:docs`).
- Every change: one commit, tests, updated docs, and an upstream-PR description in `docs/d365dev/<change>.md`.

## Checks (before every commit)
npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run
plus, from the hosting repo (read-only): cd /mnt/d/Dev/D365DevMCP && D365FO_UPSTREAM_DIR=<this working copy> bash scripts/dev/run-tests.sh

## Work packages (design: /mnt/d/Dev/D365DevMCP/docs/SERVER-EXTENSIONS.md)
WP10 fork set-up (tag v1.21.0-d365dev.0, no change) → WP11 find_references in write-only mode (variant D)
→ WP12 extension name formats → WP13 xref SQLite provider (variant B; measurements first). Stop for review after each.
WP14 (reserved-word check: widen validate_code KW001, `reserved-words` knowledge topic) needs only WP10 and may go right after it.
