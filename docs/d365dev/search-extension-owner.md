# fix(search): name an extension once on the exact-match line

*Upstream pull request [#1200](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1200) for dynamics365ninja/d365fo-mcp-server, filed from branch `fix/search-extension-owner` (commit 0e67489e on upstream `main` acd9d8e1); independent of the menu PRs. **Merged** 2026-11-05 as `0ddfdfe1`, with the maintainer's commit `4b6859d3`: the workspace-aware listing (`includeWorkspace` with `workspacePath`) had the same prefix and now shares `ownerPrefix()` with the exact-match line. On `d365dev` the same change is tag `v1.22.0-d365dev.20`. The text below is the PR description as filed. The test counts below are for the PR branch (`d365dev`: 536 files, 7,804 tests).*

## The defect

`search` for a menu extension on a dev VM answered:

```
⭐ **Exact name match:** OrganizationAdministration.OrganizationAdministration.ContosoExtension (menu-extension) in Contoso

## MENU-EXTENSION (1)

📦 **OrganizationAdministration.ContosoExtension**
   └─ Parent: OrganizationAdministration
```

The exact-match line puts each hit's owner in front of its name, to tell same-named members apart: three fields called `SalesLine` on three tables would otherwise print as one row three times (`search.ts`). For a member, the owner is the table or class that holds it. An extension, though, is an object, and its index row carries its base object as `parentName` (`indexExtensions` in `symbolIndex.ts`). So every extension got its base object in front:
- a table, form or menu extension, whose name already starts with the base object, has it twice: `OrganizationAdministration.OrganizationAdministration.ContosoExtension`;
- a class extension, named `…_Extension` without a dot, reads like a member of its base class: `SalesTable.SalesTableContoso_Extension`.

An agent reading the line could take either for an object that does not exist, or the class extension for a method.

## Change

`search.ts`: the owner is prefixed only for rows whose type is not a `*-extension`. Extensions are the only top-level rows with a `parentName`, so members (methods, fields, …) keep their owner as before. The per-type listing below the line already shows the base object as `Parent:`, and the type in brackets says that the row is an extension.

## Tests

`tests/tools/searchExactMatchOwner.test.ts` (new, 3 tests, index-only answer):
- a menu extension is named once, without its base object in front;
- a class extension does not read as a member of its base class;
- two same-named fields on two tables keep their owners.

Against the `src/` of `main`: the first two fail.

**On a dev VM** (LCS, Claude Code, this change on the shared server), `search` for:
- a menu extension of `OrganizationAdministration`, a table extension, and a class extension: each named once on the exact-match line, with its type;
- a field name several tables have: each hit still shows its table in front.

A class extension shows up twice on that line, as `(class)` and as `(class-extension)`. The index holds it in both roles on purpose (`extract-metadata.ts`, #693). Before this change the second entry read like a member of the base class.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (536 test files passed, 2 skipped; 7789 tests passed, 30 skipped).

## Checklist

- [x] One-line change in the output; no change to which rows `search` returns or how it ranks them.
- [x] CHANGELOG `[Unreleased]` → Fixed.
- [x] No C# bridge, settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
