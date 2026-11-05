# fix(menu): menu checks read the other extensions of the base menu on a write-only companion

*Upstream pull request [#1203](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1203) for dynamics365ninja/d365fo-mcp-server, the follow-up announced in #1199. On `d365dev` this is `v1.23.0-d365dev.1` (in the v1.22.0 cycle `v1.22.0-d365dev.15`). PR branch `feat/menu-companion-lookup` = one commit, filed as `d68ab681` on upstream `main` `ba012837`, rebased after #1199 was merged with the maintainer's commit `9054dc8d` (element names unique in the whole menu): that commit split the lookup into `otherExtensionXmls`, which this change now extends, so its element-name checks read the package folders on a companion too. After v1.23.0 was released the branch was rebased onto the release (`6ce3f7dc` on `2bc52137`), with the CHANGELOG entry moved under `[Unreleased]`; the code is unchanged. After #1198 was merged with the maintainer's commit `d52c63ca` (a standard base menu read from every package folder), this change was narrowed to the other extensions of the base menu, and it shares that commit's package scan instead of adding a second one. The text below is the PR description as filed. The test counts below are for the PR branch.*

**Follows #1199** (add-submenu) and its follow-up `9054dc8d`: it changes `otherExtensionXmls`, which `checkExtensionParent`, `directXmlAddSubmenu` and `directXmlAddMenuItemToMenuExtension` call.

## The defect

In the hybrid setup (shared read-only server plus a local write-only companion) every write runs on the companion. A menu extension's `<Parent>` may name a submenu that another extension of the same base menu adds, and a new submenu must not take a name one of them already uses. A duplicate fails the build under any parent; a dev VM showed it for a name of the base menu:

```
Path: [AxMenuExtension/<extension>/Periodic/EInvoice/Name]: The name 'EInvoice' is not unique. Multiple elements have the same name.
Compilation failed.
```

Since #1198 the base menu is read from the package folders. The other extensions of it are still read from the index only (`otherExtensionXmls`), and the companion has no index (an empty stub). So on the companion:
- `add-menu-item-to-menu` / `add-submenu` refuse a parent that another extension adds, although the build accepts it;
- `add-submenu` writes a submenu named like an element another extension adds (a submenu, or since `9054dc8d` a menu item), and the next build fails;
- `add-menu-item-to-menu` writes an item under a name another extension already gives an element, instead of `<item>N`, and the next build fails.

## Change

**`otherExtensionXmls`** (`directXmlWriters.ts`): the index as before. When it yields no extension of the base menu, the package folders are read instead: `AxMenuExtension/<BaseMenu>.*.xml` in every `<Package>/<Model>`, the extension itself excluded. The `.xml` at the end matters: a modify outside git leaves `<file>.xml.backup-<time>` next to the file, which would otherwise be read as one more extension. The parent refusal no longer says "another extension of it in the index".

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

`tests/tools/menuExtensionXml.test.ts` (+7, no index; the helper stands in for a packages tree with the base menu, another extension, a backup copy of it, and the extension being edited):
- a submenu another extension adds is accepted as a parent; one only the backup copy has is not;
- a submenu name another extension adds is refused by `add-submenu`;
- an element name another extension uses: an item of that name is written as `<item>N`, a submenu of that name is refused (`name-in-use`);
- the base menu's submenus: an unknown parent refused with the list, a known one written without the "NOT checked" warning, a name of the base menu refused with the file unchanged;
- the extension itself is not counted as another one (its own submenu is a skip the second time, not a refusal).

`tests/utils/baseObjectXmlUnindexed.test.ts` (from #1198's follow-up) now runs on the shared scan: its `objectFileLookup` mock keeps the real module and stubs only `findD365FileOnDisk`.

Against the `src/` of `main`: the 3 helper tests and the 3 sibling-extension tests fail.

**On a dev VM** (LCS, the write-only companion on the earlier form of this change, which also read the base menu from the package folders), against an extension of `OrganizationAdministration`, each sent as an explicit tool call:
- `add-submenu` `EInvoice` under `Periodic`: refused ("already exists in menu 'OrganizationAdministration'"), nothing written — before, it was written and the build failed;
- `add-menu-item-to-menu` under `Reportzz`: refused with the base menu's submenus;
- the same under `EInvoice`: written, without the "NOT checked" warning;
- no noticeable delay from reading the package folders.

The element-name checks from `9054dc8d` came after that test; on the companion they read the same `otherExtensionXmls`, covered by the unit test above.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (538 test files passed, 2 skipped; 7835 tests passed, 30 skipped).

## Checklist

- [x] No C# bridge change; no change for a server with an index.
- [x] CHANGELOG `[Unreleased]` → Fixed.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
