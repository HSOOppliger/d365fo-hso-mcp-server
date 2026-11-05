# CLAUDE.md – d365fo-hso-mcp-server (fork of dynamics365ninja/d365fo-mcp-server)

Thin fork: branch `d365dev` = upstream release tag + small, separate commits; tags `v<upstream>-d365dev.<n>`.
Every change is also meant as an upstream pull request. `main` mirrors upstream `main`; never commit to it.
The root `CLAUDE.md` is upstream's contributor guide and applies as well; the fork's rules live here so that
upstream changes to it never conflict with them.

Sync: `main` is only fast-forwarded to upstream. `d365dev` is not rebased onto unreleased upstream `main`; at each
upstream release it is rebased onto the release tag (commits upstream already contains are dropped) and the tags
start again at `v<release>-d365dev.0`.

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
WP10–WP15 (find_references in write-only mode, extension name formats, xref SQLite provider, reserved-word check,
exact label lookup) are merged upstream and released in v1.23.0.
