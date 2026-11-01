# fix(coc): with a method filter, count only the classes that wrap the method

*Upstream pull request [#1188](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1188) for dynamics365ninja/d365fo-mcp-server, filed from branch `fix/coc-method-filter-wrappers` (commit d3021c54 on upstream `main` 5122a30b). On `d365dev` the same change is tag `v1.22.0-d365dev.10`. The text below is the PR description as filed; its test counts are for the PR branch (`d365dev`: 530 files, 7,721 tests).*

## The defect

On a real system, `extension_info(mode="coc", target="SalesTable", method="validateWrite")` answered:

> Found 12 extension class(es) wrapping "validateWrite"

Two of the twelve wrap it. The other ten have an empty wrap list and were counted anyway. The cause is the method filter in `formatCocExtensions` (`src/bridge/bridgeAdapter.ts`):

```ts
filtered = r.extensions.filter(ext =>
  ext.wrappedMethods?.some(m => m.toLowerCase() === methodNameFilter.toLowerCase())
  || !ext.wrappedMethods || ext.wrappedMethods.length === 0
);
```

The "Found N … wrapping m" header then counted everything that passed. An agent checking "is `validateWrite` already wrapped?" before writing a CoC was told twelve classes do it.

Wrap detection is not the problem. `next validateWrite()` is recorded in DYNAMICSXREFDB as a call reference (Kind 1) from `/Classes/<Ext>/Methods/validateWrite` to `<extended element>/Methods/validateWrite`. This was checked by hand in SQL Server for one extension class, and the tool found that wrap.

## Where the clause comes from

The `|| … length === 0` clause dates from the first xref version of this lookup (3498ba3a, "P1-P5: Cross-ref DB enrichment"). Back then the wrap list held every base method a class called, so an empty list could plausibly mean "nothing detected". Two things have changed since:
- the bridge now matches the same-named base-method call exactly, which is what the `next` call is;
- it always sends a list: `public List<string> WrappedMethods { get; set; } = new List<string>();` (`bridge/D365MetadataBridge/Models/Models.cs:721`).

So an empty list means "wraps nothing", not "unknown". The clause is a leftover.

## Change

**Bridge/xref formatter** (`formatCocExtensions`). With a method filter, the classes, deduped by name as before, now fall into three sections. Each section keeps the grouping by extended element (table / form / data source / control).

1. `Found N extension class(es) wrapping "<m>":`: only classes whose wrap list contains `<m>`, case-insensitive.
2. `Other extension classes of <object> (no wrap of "<m>" recorded): N`: the rest. They stay in the output because an agent about to add a wrapper should still see what else extends the object.
3. `Extension classes of <object>, wraps unknown (the source sent no wrap list): N`: a class whose `wrappedMethods` is missing (an older bridge or another source). It is never counted as a wrapper.

Sections 2 and 3 appear only when they have entries. When no class wraps the method, the header says `Found 0 …` and the others still follow. Without a method filter, the output is byte-identical to before. The grouping loop moved unchanged into a helper, `formatCocGroups`, so that each section can use it.

Example (synthetic data):

```
Found 2 extension class(es) wrapping "validateWrite":

### Table SalesTable — 1

- **ContosoSalesTableValidate_Extension** (ContosoSales)
    Wraps methods: insert, validateWrite

### Form SalesTable › DataSource SalesTable — 1

- **ContosoSalesTableForm_SalesTableDS_Extension** (ContosoSales)
    Wraps methods: validateWrite

Other extension classes of SalesTable (no wrap of "validateWrite" recorded): 2

### Table SalesTable — 2

- **ContosoSalesTableUpdate_Extension** (ContosoSales)
    Wraps methods: update, insert
- **ContosoSalesTableFields_Extension** (ContosoSales)

Extension classes of SalesTable, wraps unknown (the source sent no wrap list): 1

### Table SalesTable — 1

- **ContosoSalesTableLegacy_Extension** (ContosoLegacy)
```

**Index path, filesystem fallback** (`findCocExtensions.ts`, the Windows-only scan when the index has no class extension). This path had the same clause, `|| e.cocMethods.length === 0`. Here the list comes from `fsExtensionScanner`, which tests every method body of the file against `/\bnext\s+\w/i` (`src/utils/fsExtensionScanner.ts:253-254`). An empty list therefore means that no `next` was found, and the class gets the same split:
- `Found N class extension(s) on disk (not yet in index) wrapping "<m>":` for the wrappers;
- `Other class extensions of <object> on disk (no wrap of "<m>" found): N` for the rest.

"Wrapping" keeps its existing meaning on this path: a `next` call in a method named `<m>`, or a method named `<m>` (the `addedMethods` clause, which covers a `[Replaceable]` override without `next`). The other classes show their full `Wraps methods:` list. Numbering runs on across both sections. Without a method filter, the output is byte-identical to before.

**Index path, database rows: unchanged on purpose.** The clause at `src/tools/knowledge/findCocExtensions.ts:120` (`e.cocMethods.length === 0 // include unknown ones too`) stays, because there an empty list can genuinely mean "unknown":
- a class extension found only in `symbols` (no `extension_metadata` row) has no method data, and gets a hard-coded `cocMethods: []` (`findCocExtensions.ts:111`);
- a NULL `coc_methods` is read as `[]` (`findCocExtensions.ts:101`). NULL is written both when the extracted JSON has no `cocMethods` field (`src/metadata/symbolIndex.ts:3640`) and when an incremental reindex found an empty list (`symbolIndex.ts:3666`, `:3682`). The reader cannot tell the two apart.

Splitting those rows would need the index to store "no CoC" distinctly from "not known", which is a schema or extraction change and out of scope here.

## Tests

`tests/tools/coc-method-filter.test.ts` (new). It uses a synthetic `BridgeExtensionClassResult` for `SalesTable` with five classes:
- a table extension wrapping `validateWrite`;
- a table extension wrapping `update`, `insert`;
- a table extension with an empty list;
- a table extension with `wrappedMethods` undefined;
- a form data-source extension wrapping `validateWrite`.

Bridge path:
- the header counts 2, and only the two wrappers sit under it, grouped by element;
- the "other" heading with count 2, its classes, and their wrap lists;
- the class with no list is under "wraps unknown" (count 1), and the sections come in the order wrappers, others, unknown;
- every class is listed exactly once;
- case-insensitive matching (`VALIDATEWRITE`);
- `Found 0` when nothing wraps the method, with the others still listed;
- no "other"/"unknown" heading when every class wraps the method;
- output without a method filter matches an inline snapshot taken from the formatter **before** this change.

Filesystem fallback (`process.platform` set to `win32`, empty in-memory index, `scanFsExtensions` mocked):
- the wrapper count, the "other" heading and count, and the other classes' wrap lists;
- case-insensitive matching;
- output without a method filter matches an inline snapshot taken **before** this change.

Before the fix, 8 of the 11 tests fail. The two snapshots and the "every class wraps" case pass both before and after. The existing `coc-extension-grouping.test.ts`, `find-coc-extensions-realindex.test.ts` and `cocNextUnconditional.test.ts` pass unchanged.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (522 test files passed, 2 skipped; 7473 tests passed, 30 skipped).

## Overlap with #1187

#1187 (cross-references from a SQLite export of DYNAMICSXREFDB) uses the same formatter for its SQLite source, so the fix covers that path too once both are merged. #1187 also adds a `source` parameter to `formatCocExtensions` and changes its `_Source:` line. This PR leaves the signature and the `_Source:` line alone and changes only the filter, count and render part below them. A trial merge of this branch with #1187's branch (`git merge-tree`, `ffef81ac`) auto-merges `bridgeAdapter.ts` and `findCocExtensions.ts`. The only conflict is the CHANGELOG `[Unreleased]` block, where both add an entry.

## Checklist

- [x] Without a method filter the output is unchanged (snapshots taken before the change).
- [x] Wrap detection, bridge and xref queries unchanged; no C# change.
- [x] CHANGELOG `[Unreleased]` → Fixed.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
