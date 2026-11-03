# fix(menu): menu checks find the base menu on a write-only companion

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.15`. PR branch `feat/menu-companion-lookup` = one commit `12e55922` on top of the add-submenu branch (`be1066fb`, itself on #1198's `ba854436`, on upstream `main` `a9094731`); not yet pushed or filed. The test counts below are for the PR branch (`d365dev`: 533 files, 7,783 tests).*

**Depends on #1198 and the add-submenu PR:** it changes `checkExtensionParent` and `directXmlAddSubmenu` from the latter. Review the last commit only; the branch is rebased onto `main` once both are merged.

## The defect

In the hybrid setup (shared read-only server plus a local write-only companion) every write runs on the companion. On a menu extension, its checks came out like this on a dev VM:

```
✅ Submenu 'EInvoice' added under submenu 'Periodic' of menu 'OrganizationAdministration'. …
⚠️ Base menu 'OrganizationAdministration' could not be read, so 'EInvoice' and submenu 'Periodic' were NOT checked against it.
```

and the next build:

```
Path: [AxMenuExtension/<extension>/Periodic/EInvoice/Name]: The name 'EInvoice' is not unique. Multiple elements have the same name.
Compilation failed.
```

The parent check (`add-menu-item-to-menu` and `add-submenu`) and the name check (`add-submenu`) read the base menu with `findBaseObjectXml('menu', …)`, and the other extensions of that menu from the index:
- `findBaseObjectXml` asks the index first, then `findD365FileOnDisk`, which looks in the **configured model only**;
- the companion has no index (an empty stub), and a standard menu lies outside its model;
- menus have no bridge read either.

So on the companion both checks never saw the base menu: every parent went through unchecked, and the name check could not catch the duplicate the build then refused.

## Change

**`findAotFilesInAllPackages(aotFolder, match)`** (`src/utils/objectFileLookup.ts`, new): the files in one Ax* folder of every `<Package>/<Model>` under the configured roots whose name passes `match`. Roots: the packages path (or the fallback), and on UDE the custom and Microsoft packages paths, as `findD365FileViaIndex` uses. The package/model folder list is taken once per process; the Ax* folders are read on every call, so a file written in the session is found.

**`directXmlWriters.ts`:**
- `readBaseMenu`: `findBaseObjectXml` as before, then `<root>/*/*/AxMenu/<BaseMenu>.xml`. Both wrappers use it.
- `otherExtensionSubmenus`: the index as before; when it yields no extension of the base menu, the package folders (`AxMenuExtension/<BaseMenu>.*.xml`, the extension itself excluded). The `.xml` at the end matters: a modify outside git leaves `<file>.xml.backup-<time>` next to the file, which would otherwise be read as one more extension.

A server with an index behaves as before; the package folders are only read when the index has nothing. The "NOT checked" warning stays for a base menu that is found nowhere.

## Tests

`tests/utils/aotFilesInAllPackages.test.ts` (new, 3 tests, temp packages tree, config mocked):
- the folder in every `<Package>/<Model>` of every root, a package whose model has another name included, and nothing from `Descriptor` or other Ax* folders;
- the file-name filter, and a file written after the first call is found by the next;
- roots that do not exist give nothing.

`tests/tools/menuExtensionXml.test.ts` (+5, no index, the helper standing in for a packages tree with the base menu, another extension, a backup copy of it and the extension being edited):
- an unknown parent is refused with the base menu's submenus;
- a known parent is written without the "NOT checked" warning;
- a submenu another extension adds is accepted; one only the backup copy has is not;
- a submenu named like one of the base menu is refused, file unchanged;
- the extension itself is not counted as another one (its own submenu is a skip the second time, not a refusal).

The writer tests mock the helper by default, so they do not depend on what the test machine has under its packages path.

Against the `src/` of the add-submenu PR: the 3 helper tests and the 5 writer tests fail.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (535 test files passed, 2 skipped; 7812 tests passed, 30 skipped).

## Checklist

- [x] No C# bridge change; no change for a server with an index.
- [x] CHANGELOG `[Unreleased]` → Fixed.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
