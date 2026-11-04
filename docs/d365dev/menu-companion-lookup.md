# fix(menu): menu checks read the other extensions of the base menu on a write-only companion

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.15`. PR branch `feat/menu-companion-lookup` = one commit `f6ebbdcb` on top of the add-submenu branch (`21cf2c45`, on upstream `main` `acd9d8e1`). After #1198 was merged with the maintainer's commit `d52c63ca` (a standard base menu read from every package folder), this change was narrowed to the other extensions of the base menu, and it now shares that commit's package scan instead of adding a second one. Not yet filed. The test counts below are for the PR branch (`d365dev`: 533 files, 7,783 tests).*

**Depends on the add-submenu PR:** it changes `otherExtensionSubmenus`, which `checkExtensionParent` and `directXmlAddSubmenu` from that PR call. Review the last commit only; the branch is rebased onto `main` once it is merged.

## The defect

In the hybrid setup (shared read-only server plus a local write-only companion) every write runs on the companion. A menu extension's `<Parent>` may name a submenu that another extension of the same base menu adds, and a new submenu must not take a name one of them already uses. A duplicate fails the build under any parent; a dev VM showed it for a name of the base menu:

```
Path: [AxMenuExtension/<extension>/Periodic/EInvoice/Name]: The name 'EInvoice' is not unique. Multiple elements have the same name.
Compilation failed.
```

Since #1198 the base menu is read from the package folders. The other extensions of it are still read from the index only (`otherExtensionSubmenus`), and the companion has no index (an empty stub). So on the companion:
- `add-menu-item-to-menu` / `add-submenu` refuse a parent that another extension adds, although the build accepts it;
- `add-submenu` writes a submenu named like one another extension adds, and the next build fails.

## Change

**`otherExtensionSubmenus`** (`directXmlWriters.ts`): the index as before. When it yields no extension of the base menu, the package folders are read instead: `AxMenuExtension/<BaseMenu>.*.xml` in every `<Package>/<Model>`, the extension itself excluded. The `.xml` at the end matters: a modify outside git leaves `<file>.xml.backup-<time>` next to the file, which would otherwise be read as one more extension. The parent refusal no longer says "another extension of it in the index".

**One package scan.** #1198's follow-up added a private `findInAnyPackage` to `baseObjectXml.ts` for the types the index never extracts (`AxMenu`). It becomes `findAotFilesInAllPackages(aotFolder, match)` in `src/utils/objectFileLookup.ts`, used by `findBaseObjectXml` and by the extension lookup above. What changes:
- **Root order:** kept — custom packages, Microsoft packages on UDE, then the packages path (or the fallback); hits come back in that order and `findBaseObjectXml` takes the first.
- **File names:** matched by a predicate instead of an exact `fs.access`, which matters on a case-sensitive file system. `findBaseObjectXml` compares in any casing.
- **Folder list:** the package/model folders are listed once per process (about 3,000 on a full PackagesLocalDirectory). The Ax* folders are read on every call, so a file written in the session is found.

A server with an index behaves as before for the extensions; the package folders are only read when the index has none of them.

## Tests

`tests/utils/aotFilesInAllPackages.test.ts` (new, 3 tests, temp packages tree, config mocked):
- the folder in every `<Package>/<Model>` of every root, a package whose model has another name included, nothing from `Descriptor` or other Ax* folders; the Microsoft packages path only on UDE;
- the file-name filter, and a file written after the first call is found by the next;
- roots that do not exist give nothing.

`tests/tools/menuExtensionXml.test.ts` (+6, no index; the helper stands in for a packages tree with the base menu, another extension, a backup copy of it, and the extension being edited):
- a submenu another extension adds is accepted as a parent; one only the backup copy has is not;
- a submenu name another extension adds is refused by `add-submenu`;
- the base menu's submenus: an unknown parent refused with the list, a known one written without the "NOT checked" warning, a name of the base menu refused with the file unchanged;
- the extension itself is not counted as another one (its own submenu is a skip the second time, not a refusal).

`tests/utils/baseObjectXmlUnindexed.test.ts` (from #1198's follow-up) now runs on the shared scan: its `objectFileLookup` mock keeps the real module and stubs only `findD365FileOnDisk`.

Against the `src/` of the add-submenu PR: the 3 helper tests and the 2 sibling-extension tests fail.

**On a dev VM** (LCS, the write-only companion on the earlier form of this change, which also read the base menu from the package folders), against an extension of `OrganizationAdministration`, each sent as an explicit tool call:
- `add-submenu` `EInvoice` under `Periodic`: refused ("already exists in menu 'OrganizationAdministration'"), nothing written — before, it was written and the build failed;
- `add-menu-item-to-menu` under `Reportzz`: refused with the base menu's submenus;
- the same under `EInvoice`: written, without the "NOT checked" warning;
- no noticeable delay from reading the package folders.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (537 test files passed, 2 skipped; 7821 tests passed, 30 skipped). `buildBpSummary.test.ts` ("stays bounded…") failed once under full-suite load and passed alone and on the rerun; it is unrelated.

## Checklist

- [x] No C# bridge change; no change for a server with an index.
- [x] CHANGELOG `[Unreleased]` → Fixed.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
