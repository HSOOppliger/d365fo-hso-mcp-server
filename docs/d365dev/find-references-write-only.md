# feat(find-references): answer from DYNAMICSXREFDB in write-only mode

*Draft upstream pull request for dynamics365ninja/d365fo-mcp-server, not filed yet. Branch `feat/find-references-write-only`, commit a105e64d on upstream `main` 5122a30b. On `d365dev` the same change is tag `v1.22.0-d365dev.2`. The text below is the PR description to file.*

## The deployment this is for

The hybrid setup in [MCP_CONFIG.md § Hybrid mode summary](../MCP_CONFIG.md#hybrid-mode-summary) splits the server in two:

| | Shared server (`read-only`) | Local companion (`write-only`) |
|---|---|---|
| Runs on | App Service / a Linux host, one per team | each developer's D365FO VM (stdio) |
| Symbol index | yes: the team's reference (standard + the team's models), built by the pipeline | no: an empty in-memory stub (`src/index.ts:249`) |
| C# bridge | no | yes |
| `DYNAMICSXREFDB` | no | yes, the developer's own, filled by Visual Studio builds with cross-references |
| `find_references` before this PR | name-based scan of the index | not published |

So in the recommended developer setup, `find_references` always runs where there is no cross-reference database.

## Why

**The shared server can only guess.** Without the bridge, `find_references` scans the indexed X++ code by name. The tool already says what that misses:
- calls past the first ten lines of a method;
- every declarative reference: table fields typed with an EDT, form data sources, relations, entity mappings and labels, which come back "inconclusive".

**The exact answer is already on the developer's VM, one step away.**
- The companion starts the C# bridge (`src/index.ts:764`).
- The bridge opens `DYNAMICSXREFDB` when it is configured (`D365FO_XREF_DB_NAME`, or the XPP config on UDE).
- `find_references` is already a bridge-backed tool (`BRIDGE_BACKED_TOOLS`).
- But the tool is in neither `LOCAL_TOOLS` nor `ALWAYS_TOOLS`, so `write-only` mode refuses it.

**Publishing it as it is would be wrong.** The companion's index is empty. Wherever the bridge has no answer, the tool would fall through to the name-based scan, scan nothing and report "0 references". That reads as an answer but means "never searched".

## Change

- **`find_references` joins `ALWAYS_TOOLS`** (`serverMode.ts`). `full` and `read-only` already published it, so only `write-only` mode changes.
- **In `write-only` mode it answers from the bridge only.** No index is needed for most calls:

  | Call | Write-only behaviour |
  |---|---|
  | `targetType` = table, class, enum, edt, form, … | scoped to the container (`/Tables/<name>`, …) from `TARGET_TYPE_TO_XREF_CONTAINER`, as in full mode |
  | Untyped bare name (`ContosoTable`) | sent as given; the bridge tries every type container itself |
  | `Owner.member` / `ownerName` | sent as `Owner.member`; the bridge tries Methods and Fields in every member container itself (the path full mode already takes when the index does not know the owner) |
  | AOT path, label id | as given, unchanged |
  | Bare method name with `targetType: "method"` | not sent; points to the shared server or asks for `Owner.method`. Only the index knows the declaring types, and the bridge would read the name as a type and match nothing |

- **Where full mode would run the name-based scan, the companion points to the shared server instead.** This covers no bridge, no cross-reference database, a failed query, and no rows for a lookup that isn't scoped to a member. The answer says it is not a count of zero, reuses the existing reason and setup advice (`bridgeFallbackReason`, `xrefSetupAdvice`), and names `find_references` on the shared server. A failed query is `isError: true`, as for labels.
- **A zero for `Owner.method` warns about `[ExtensionOf]` methods.** A method an extension class adds is recorded under that class (`/Classes/<Ext>/Methods/<m>`). In full mode the index finds those classes (`extension_metadata`); the bridge's own expansion covers fields and enum values added by extensions, but not methods. Without the index, a zero can miss these callers, so the answer says so and names the explicit path.
- **Unchanged:**
  - labels, and the five types the scan cannot search (edt, form, query, view, report), never used the scan, and the shared server can't answer them either;
  - `full` and `read-only` behaviour;
  - no new setting, no DB schema, parser or C# bridge change.

## Using both servers

A client connected to both servers now sees `find_references` twice:
- the companion's answer is exact, but only as current as the developer's last Visual Studio build with cross-references;
- the shared server's answer is the team's reference, by name.

To keep one, hide the other: uncheck it in the VS Code / Visual Studio tool picker, or in Claude Code add `mcp__<server>__find_references` to `permissions.deny`. This is documented in `MCP_CONFIG.md`.

## Tests

- `tests/tools/findReferencesWriteOnly.test.ts` (new), with a stubbed bridge and the empty write-only index:
  - **answered by the bridge:** typed name → `/Tables/<name>`; untyped bare name and `Owner.member` passed through; AOT path as given; a zero for `Owner.method` carries the `[ExtensionOf]` warning;
  - **pointer:** a bare method name is not sent to the bridge; no rows, no bridge, no xref database (names `D365FO_XREF_DB_NAME`) and a failed query (`isError`) each name the shared server and never the name-based scan;
  - **kept:** the label answer and the "inconclusive" answer for an EDT;
  - **unchanged in `full` and `read-only`:** the name-based fallback, a bare method name still sent to the bridge, no `[ExtensionOf]` warning.
- `tests/server/serverMode.test.ts`: `find_references` is allowed in every mode.
- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run`: green (522 test files passed, 2 skipped; 7481 tests passed, 30 skipped).
- **On a D365FO VM:** not yet run; result to be added here before filing.

## Checklist

- [x] Only `write-only` behaviour changes; existing tests unchanged and green.
- [x] CHANGELOG `[Unreleased]`, `docs/ARCHITECTURE.md`, `docs/MCP_TOOLS.md`, `docs/MCP_CONFIG.md`.
- [x] No settings, DB schema, parser or bridge change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
