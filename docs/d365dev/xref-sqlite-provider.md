# feat(xref): cross-references from a SQLite export of DYNAMICSXREFDB (`D365FO_XREF_SQLITE_PATH`)

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.7`, the fallback-text fix in `.8` and the index-only totals in `.9`. PR branch `feat/xref-sqlite-provider` = one commit `ffef81ac` on upstream `main` `5122a30b`, pushed to the fork; not yet filed. The test counts below are for the PR branch (`d365dev`: 529 files, 7,710 tests).*

## The deployment this is for

A shared read-only server (Linux, `MCP_SERVER_MODE=read-only`) serves a team its symbol index. It has no C# bridge, so it has no cross-reference database either. Its `find_references` is the name-based scan of X++ method bodies:

- it can't see declarative metadata, which is where most references to a table, EDT or form are (table fields typed with an EDT, form data sources, relations, entity mappings);
- it can't scope a method to its declaring type;
- for an EDT, form, query, view or report it answers "inconclusive", because the scan structurally cannot see them.

The cross-reference database is plain SQL: three tables, `Names`, `References` and `Modules`, which the bridge queries with nothing D365-specific (`CrossReferenceService.cs`). A team that has a filled `DYNAMICSXREFDB` on any dev or build VM can copy it to a SQLite file and give it to the shared server. A full export of a heavily customised application is about 2.1 GB (5.6M names, 22.7M references) and takes a few minutes with `bcp` and `sqlite3`.

## Why this belongs in the server

- **Same answers, not a new tool.** The provider ports the bridge's four xref queries (`FindReferences`, `FindExtensionClasses`, `FindEventSubscribers`, `FindApiUsageCallers`) and returns the bridge's result shapes (`BridgeReferenceResult` and the other three). The formatters in `bridgeAdapter.ts` render them unchanged, so `find_references`, the CoC lookup, event handlers and API usage read the same whichever source answered. Only the `_Source:` line differs: it names the file and its export date.
- **No new dependency.** `node:sqlite` is already the server's SQLite.
- **Off unless configured.** Without `D365FO_XREF_SQLITE_PATH` nothing changes, not even the server's startup output. With the bridge up and its xref database available, the bridge answers as before.

## Change

### Selection (`src/xref/xrefSource.ts`)

Per call, not at startup:

1. the bridge, when it is ready and `xrefAvailable`: unchanged;
2. else the SQLite file, when `D365FO_XREF_SQLITE_PATH` is set and the file opens and validates;
3. else today's behaviour: the adapters see the (unavailable) bridge and fall back to the name-based scan.

The tools reach the source through `xrefSource(context)` instead of `context.bridge`. The `tryBridge*` adapters take any `XrefSource` (the bridge client is one). A bridge that finishes starting takes over, and a replaced file is picked up on the next call.

### The file

| Table / object | Content |
|---|---|
| `Modules(Id INTEGER PRIMARY KEY, Module TEXT)` | as in `DYNAMICSXREFDB` |
| `Names(Id INTEGER PRIMARY KEY, Path TEXT, ModuleId INTEGER)` | as in `DYNAMICSXREFDB`, same ids |
| `"References"(SourceId, TargetId, Kind, Line, "Column")` | as in `DYNAMICSXREFDB`, same ids |
| indexes | `Names(Path COLLATE NOCASE)`, `References(TargetId)`, `References(SourceId)` |
| `meta(key, value)` | `schema` = `'1'` (required), `kind` = `'full'` (if present), `exported_at`, optional counts, optional `refs_without_source_removed` (below) |

The file is refused, with the reason logged once, when it is missing or not SQLite, has no `meta` table, has another `schema` or a `kind` other than `full`, lacks a table or column, or lacks one of the three indexes. A partial export would answer "no references" for everything it lacks, and a missing index turns every lookup into a scan of millions of rows. A refused file behaves like no file.

### Opening: lazy, read-only, immutable

- Constructing the provider touches nothing; the first use opens and validates the file (a few small reads). `/health` never waits for it. In HTTP mode the server logs the source once after the bridge status, e.g. `Cross-references: SQLite export of DYNAMICSXREFDB — exported 2026-10-30T12:00:00Z, 200 modules`.
- Opened as `file:…?mode=ro&immutable=1`, `readOnly`, `allowExtension: false`, `PRAGMA query_only = 1`, `PRAGMA trusted_schema = 0`. No lock, journal, WAL or SHM file is created next to it, and nothing can be written. One connection to one file: no `ATTACH`, no second database. No mmap: a file truncated under a mapping kills the process.
- `immutable=1` tells SQLite the file never changes, so the provider checks the file's identity (device, inode, size, mtime) before every call and reopens it when it changed. Replacing the file by rename is the supported way to update it. A file rewritten in place is detected the same way. A query that fails (e.g. a corrupt page) is an error, never an empty result, as in the bridge, and drops the handle so the next call revalidates.

### The queries: ported and bounded

The path logic is a 1:1 port of `CrossReferenceService.cs` (`src/xref/xrefPaths.ts`): container expansion, metadata twins, extension-added fields and enum values, `[ExtensionOf]` element resolution, handler classification, Kind categories. What differs is SQLite, and bounds:

- **Case-insensitive like the SQL Server collation**: `Path = ? COLLATE NOCASE`. A `LIKE 'prefix%'` can't use the `NOCASE` index (the column is `BINARY`), so every pattern is an index range on the folded prefix (`Path >= lo COLLATE NOCASE AND Path < hi COLLATE NOCASE`). It gets a `LIKE … ESCAPE '\'` filter only where the bridge's pattern has more after its first wildcard (`/TableExtensions/<T>.%/Fields/<f>`). `_` and `%` in names stay literal.
- **Plans are pinned.** The id lists are `json_each(?)` (no temp tables: `query_only` forbids them). The planner has no statistics for those, and on a small file it chose a full scan of `References` over the `TargetId` index. So every big-table access carries `INDEXED BY <the file's own index>`, joins have a fixed order (`CROSS JOIN`), and `Modules` (a couple of hundred rows) is held in memory instead of joined. A test checks every statement's `EXPLAIN QUERY PLAN`.
- **No unbounded join, sort or aggregate over a busy target.** On a full export, the most referenced target has 338,376 references. Joining all of them to `Names` costs seconds on a cold cache. So:

| Query | Bridge | Provider |
|---|---|---|
| reference rows | `TOP 500` per target shape, `ORDER BY` source path | `LIMIT 500` per shape without `ORDER BY` (index order), sorted afterwards; `limit`/`offset` paging in the provider API |
| totals | exact `COUNT(*)` over all references (joined to `Names` on the source) | joined to `Names`, exact up to 20,000 per shape; beyond, `totalCapped` and the answer shows `20000+`. With `meta.refs_without_source_removed`: from the `TargetId` index alone, exact up to 500,000 per shape |
| event subscribers | all references to the target and its members | the object's own references first, then its members', 20,000 at most; `scanCapped`/`scanned`, "more handlers may exist" |
| API callers | `TOP 200 … ORDER BY` module, path | the first `limit` callers among at most 20,000 references, sorted afterwards; `more` when there are more, shown as `200+` |
| CoC classes | all `[ExtensionOf]` lines, then candidates | from the candidates' references when they have at most 5,000, else from the `[ExtensionOf]` lines (one per extension class in the file); same result either way |

For a target below the caps (the usual case) rows and totals are the bridge's. Above them, the 500 rows are a different sample from the bridge's alphabetical first 500, and the total is a lower bound marked `+`.

### References without a source name

On a full `DYNAMICSXREFDB` about a third of the `References` rows have a `SourceId` with no `Names` row: on the database this was measured on, 7.1M of 22.7M, from 0.5M distinct ids spread through the `Names` id range. Their targets show what they were: test code (21K of them extend `SysTestCase`; the most common attributes are `SysTestCheckInTestAttribute`, `SysTestMethodAttribute` and the ATL ones). No tool can show them, because every bridge query joins `Names` on the source, and so does the provider. But a file that holds them makes every count and scan skip them: on the busiest target 19,892 of its first 20,000 references had no source, and the joined count had to walk past 136K of them (1.5 s on a cold cache).

So an export should copy only the references whose source has a name (`WHERE EXISTS (SELECT 1 FROM Names n WHERE n.Id = r.SourceId)`), and record that in `meta.refs_without_source_removed` (how many it left out). For such a file a reference counts exactly when the bridge's join would count it, so the provider reads totals from the `TargetId` index alone: entries in sequence, no `Names` row touched, cheap enough for a cap of 500,000, which is exact for any target of a full export (the busiest has 338K references). The key is trusted as written; checking it would mean looking up every reference's source. A file without the key keeps the joined count and its 20,000 cap. Both work; the second is slower and its scans see fewer usable references.

### Where the source is shown

- the `_Source:` line of every answer: `xref SQLite file (DYNAMICSXREFDB export, exported <exported_at>)`;
- `get_workspace_info`: one `Xref` line when the file is configured, and a `## Cross-references` section with `diagnostics=true` (source, and for the file its path and counts). It is a local tool, so a `read-only` server doesn't offer it; there the `_Source:` line carries the date;
- `doctor`: opens the file the same way and reports its export date and how its totals are counted, or why it is not usable;
- when the file is configured but unusable, `find_references`' fallback text says so and why (`meta.kind is 'delta'; …`), and that the server's operator can fix it. It leaves out the file's path: every client reads this text, and the path is the server's layout, which the log and `doctor` show;
- when a query on the file fails, the answer says it was the file and that the error is in the server log (not "check the bridge log", which a server without a bridge has none of). The error itself goes only to the log.

### Setting

`index.xrefSqlitePath` / `D365FO_XREF_SQLITE_PATH` (advanced, path, no default), registered in `settings.ts`; `docs/CONFIGURATION.md` regenerated.

### Benchmark

`npm run xref:bench -- <file> [--runs N] [--cold] [--target ID] [--name PATH]` opens a real export through the provider. For each query it prints the open time, the first call and the warm median, plus the process RSS before and after and the page-cache growth. The queries: refs of the busiest and of an ordinary target, an exact name, the names under a prefix, callers of both targets, a per-module count (bounded), the extension classes and event subscriptions of the most extended object. The inputs are picked from the file before timing, and no path, name or module from the file is printed. `--cold` drops the page cache after picking (root, passwordless sudo, or a prompt).

### Unchanged

- With the bridge up and `xrefAvailable`: all tool output as before, except the new `## Cross-references` section of `get_workspace_info(diagnostics=true)`.
- Without `D365FO_XREF_SQLITE_PATH`: no change at all.
- No C# bridge change, no DB schema or parser change, no tool schema change.

## Tests

- `tests/xref/sqliteXrefProvider.test.ts` (new, synthetic fixture built in the test with the export's schema, indexes, `ANALYZE` and `meta`; `tests/xref/xrefFixture.ts`):
  - **ported queries:** bare name across both shapes (code first, categories, caller class/method, module), dangling `SourceId` never a row nor counted, `Owner.member` with metadata twin and an extension-added field, `_`/`%` literal, unknown target = exact empty result; CoC class with wrapped methods and not the decoy that names the base on another line, the same answer from the declaration-driven form on a busy base, a form data source element; event handlers with type and event, both filters; API callers grouped by class;
  - **case-insensitivity:** lower-case and upper-case names and paths;
  - **bounds:** 500 rows with the exact total below the cap; paging returns every row exactly once; total stops at 20,000 with `totalCapped`; event scan stops at 20,000 with the object's own handler still found; callers `limit` + `more` + offset; per-module count bounded;
  - **counting from the index** (`meta.refs_without_source_removed`): exact total past 20,000; the same result as the joined count when every source has a name; a missing key or one that is not a count keeps the joined count; a file with the key that still holds references without a source counts them (the documented cost of trusting the key);
  - **plans:** every statement's `EXPLAIN QUERY PLAN` uses the indexes, never scans `References`/`Names`, never sorts for `ORDER BY`; the index-only count reads the `TargetId` index and no `Names` row; prefix bounds folded (`Z…` finds `z…`);
  - **opening:** lazy (nothing touched until first use, missing file is a status logged once), `meta.schema` `'2'` refused, no `meta` table refused, `kind` `delta` refused, missing indexes refused, a non-SQLite file refused, export date and module count;
  - **read-only:** SHA-256 and mtime of the file unchanged after every query type, no file created next to it, writes and temp tables refused on the connection, no `ATTACH` in any statement;
  - **file replaced while running:** atomic rename → the new data; rewrite in place → the new data; replaced by garbage or removed → not ready, no crash, then a valid file again → answers; a failed query is an error ("NOT an empty result") and the next call recovers.
- `tests/xref/xrefSource.test.ts` (new): selection order (bridge with xref → bridge; bridge without xref, not ready, or absent → file; unusable file → as before); provider from the environment created without opening; the `get_workspace_info` description; `find_references` on the file (source line, metadata rows, an authoritative zero for an EDT, the reason when the file is unusable, `20000+`, label where-used); **the same result rendered via a stub bridge and via the file is identical apart from the source line**; CoC, event handler and API usage formatting; `doctor` from the config file (relative path) and the environment; how totals are counted (joined, or from the index with the number the export left out); an exact total past 20,000 for a file with `meta.refs_without_source_removed`; the unusable-file text without the file's path, and a failed query on the file pointing to the server log (EDT, name-based fallback and label answers).
- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (523 test files passed, 2 skipped; 7521 tests passed, 30 skipped).
- Smoke run of the built server (`read-only`, HTTP) with a synthetic file: `/health` ready in 0.6 s, the startup line names the export, `find_references(ContosoTable, table)` answered from the file with code and metadata rows.
- On a real export (197 modules, 5.6M names; Linux VM with Premium SSD v2, 16 GB RAM, node 24), `npm run xref:bench -- <file> --runs 5`, page cache dropped before the first call. Once as exported before the filter above (22.7M references, joined totals), once with it (15.6M references, `meta.refs_without_source_removed`, totals from the index). The bench picks its inputs from the file, so the busiest target differs between the two (338K references, 136K of them without a source, against 219K). Cold / warm median:

  | query | without the filter | with the filter |
  |---|---|---|
  | file size | 2,106 MB | 1,784 MB |
  | open + validate | 4.2 ms | 4.5 ms |
  | name, exact (`NOCASE`) | 2.3 / 0.0 ms | 1.8 / 0.0 ms |
  | names under a prefix (range) | 1.2 / 0.1 ms | 2.1 / 0.1 ms |
  | refs of the busiest target | 1,471 / 76 ms, total `20000+` | 430 / 17 ms, total 219,123 (exact) |
  | callers of the busiest target (`LIMIT 200`) | 11 / 10 ms, `108+` callers in 4 classes | 2.4 / 1.0 ms, `200+` callers in 58 classes |
  | CoC classes of the most extended object (126 classes) | 1,162 / 10 ms | 1,111 / 10 ms |
  | its event subscriptions (286 handlers) | 323 / 9 ms | 263 / 10 ms |
  | 20,000 references of the busiest target joined to `Names` (bench diagnostic) | 9 / 9 ms (108 had a source) | 1,769 / 22 ms |
  | page cache taken by the whole mix | +194 MB | +98 MB |

  Process RSS grew by 8–12 MB. The last query row is the cold price of joining 20,000 references to `Names` (random reads, about 90 µs each on that disk). Without the filter it looked cheap only because almost none of the rows it joined had a source. That is the bound of the event-subscriber scan on a busy object, the one tool path that joins that many rows: up to about 1.8 s on a cold cache, about 20 ms warm. The CoC form reads every `[ExtensionOf]` line of the file once, which a warm cache then serves for any base. The CoC result (wrapped methods included) was checked by hand against SQL Server for one extension class. For reference, plain `sqlite3` on the unfiltered file: the unbounded per-module aggregate over the busiest target took 3.8 s cold, 171 ms warm, which is the shape the bounds remove.

## Checklist

- [x] Off unless `D365FO_XREF_SQLITE_PATH` is set; bridge path and output unchanged.
- [x] CHANGELOG `[Unreleased]`, `docs/ARCHITECTURE.md`, `docs/MCP_TOOLS.md`, `docs/CONFIGURATION.md` (generated).
- [x] One new setting; no DB schema, parser, tool schema or bridge change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
