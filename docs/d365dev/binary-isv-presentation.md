# Binary ISV models: notice on tables and EDTs, CoC marks, integer EDT sizes; clear message for methodOffset past the end

*Upstream pull request [#1274](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1274) for dynamics365ninja/d365fo-mcp-server, filed 2026-11-16 from branch `fix/binary-isv-presentation` (commits `a48b40ce`..`9a7e5c13` on upstream `main` `2308d282`, v1.24.0). On `d365dev` since 2026-11-16 as cherry-picks `91eb61cb`..`202644a0` (CHANGELOG merged with #1273's entry); the picks are dropped when `d365dev` is rebased onto the upstream release that contains the merged PR. Independent of [#1273](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1273); both add an `isBinaryIsvPath`, and the second to merge keeps one. The text below is the PR description as filed; its test counts are for the PR branch.*

Four fixes to how binary ISV models (imported with `npm run extract-binary-models`) and method paging look in reader output. Seen on a v1.24.0 host with no bridge, with an xref SQLite file (`D365FO_XREF_SQLITE_PATH`). One commit per point.

### 1. Tables and EDTs of a binary model now show the binary notice
`get_object_info` on a class of a binary model prints "🔒 Binary ISV, signatures only". On a table or an EDT of the same model it printed nothing, so a table's missing method bodies looked like a gap in the index. The table and EDT readers now print the same notice when the object's symbol row has a `binary-isv://` path. `edt_metadata` has no file path, so the EDT reader looks up the EDT's `symbols` row. The path check moves into `binaryModelImport.ts`, next to `sourcePathFor`, which defines the format.

### 2. `extension_info(mode="coc")` marks binary wrappers
The wrappers of a binary model were listed with their wrapped methods but nothing marked them as binary. Both output paths now list such a class as `(<model>, binary ISV, signatures only)` and add one line under the list:
- the cross-reference path (bridge or xref SQLite file): `tryBridgeCocExtensions` takes an optional lookup that `findCocExtensions` answers from the symbol index. `prepare` doesn't pass the lookup, so its output is unchanged.
- the index path.

### 3. EDT string sizes print as integers, not `15.0`
Cause: the importer wrote the dump's `StringSize` as a JSON number. `node:sqlite` binds a JS number as REAL, and the TEXT column `edt_metadata.string_size` stores REAL 15 as `'15.0'`. The dump value itself is an integer. Fixed in three places:
- the importer writes text, as `extract-metadata` does from XML;
- the index build stores string size, database string size and display length as integer text, so a database rebuild fixes JSON that was imported earlier (no re-import needed);
- the EDT reader shows a `15.0` that an existing index still holds as `15`. This covers the EDT read, the hierarchy view and the field sizes in the table read.

### 4. `methodOffset` past the last method
`methodOffset: 999` on 14 methods printed "Methods (14 total, showing 1000–14)". The same arithmetic was in five places: the class reader's index, XML and bridge paths, and the table reader's index and bridge paths. All five now print "Methods (14 total)" plus a line saying the offset is past the end, how many methods there are, and the offsets of the first and last page. A valid offset pages as before.

### Tests
- New `tests/tools/binaryIsvReaders.test.ts`, end to end: a synthetic Contoso dump goes through `convertBinaryModel`, then the JSON, then `XppSymbolIndex`, then the tools, with a source model next to it. It covers:
  - the notice on a binary table and EDT, and none on source ones;
  - CoC marks on both paths, with and without a method filter;
  - integer string sizes in the EDT, hierarchy and table reads;
  - an offset past the end and a valid offset in the class and table reads.
- Extended:
  - `binaryModelImport.test.ts`: the converter writes integer text;
  - `edtInfo-bridge-fallback.test.ts`: a `'15.0'` row in an existing index prints as 15;
  - `classInfoCompactHint.test.ts`: the bridge path with an offset past the end and with a valid offset.

Each new test fails without its fix.

### Checks
`npm run build`, `npm run typecheck` and `npm run lint` pass. `npm run test:run`: 8969 passed, 41 skipped. `tests/packaging/publishedFiles.test.ts` fails to load on the test machine with npm 12.2.2, whose `npm pack --json` returns an object keyed by package name instead of an array. That failure is unrelated to this change.

### Overlap with #1273
#1273 (`include:"xml"` on a binary ISV object) adds the same `binary-isv://` check, `isBinaryIsvPath`, to `src/utils/objectFileLookup.ts`. This PR adds it to `src/metadata/binaryModelImport.ts`, next to `sourcePathFor`, which defines the path format, so that neither PR depends on the other. The two PRs share no source file. Both add a `### Fixed` section under `[Unreleased]` in `CHANGELOG.md`, so the second to merge needs a small conflict resolution. Whichever merges second should keep only one `isBinaryIsvPath`. If #1273 goes in first, I'll rebase this branch and do that here.

### Not in this PR
- Indexes and relations of binary tables without a bridge.
- The `ExtensionOf` argument the extractor drops.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
