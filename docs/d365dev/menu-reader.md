# feat(menu): get_object_info reads menus and menu extensions

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.16`. PR branch `feat/menu-reader` = one commit `1e931dbc` on top of the companion-lookup branch (`6e319943` → add-submenu `be1066fb` → #1198 `ba854436`, on upstream `main` `a9094731`); not yet pushed or filed. The test counts below are for the PR branch (`d365dev`: 534 files, 7,792 tests).*

**Depends on #1198, the add-submenu PR and the companion-lookup PR:** it uses `findAotFilesInAllPackages` from the last and moves its menu lookups into a shared util. Review the last commit only; the branch is rebased onto `main` as the others are merged.

## The gap

`get_object_info` has no `menu` and no `menu-extension` type: `objectType="menu"` is refused by the schema's enum, and `{"include": "xml"}` is no way around it, because it needs a valid `objectType` too. An agent that wants to place an item has no tool to find the submenu. On a dev VM it did this:

```
get_object_info has no menu reader, so I'll read the menu XML directly to find where the EInvoice submenu lives.
Glob  pattern: "*/*/AxMenuExtension/OrganizationAdministration.<ext>.xml"
Grep  "EInvoice" (in C:\AosService\PackagesLocalDirectory, glob: **/AxMenu*/OrganizationAdministration*.xml)
```

The write operations take a submenu by its plain name (`parentMenuElement`), so what the agent needs is the tree of submenu names: of the base menu, and of the submenus its extensions add.

## Change

**`objectType="menu"`** (`src/tools/readers/menuInfo.ts`, new):
- the menu as a tree: submenus with their label, items with their menu item (when it differs from the element name) and kind (Action/Output), tiles, separators, menu references (`↪ menu <MenuName>`), indented by depth;
- counts of submenus and items;
- one line per extension of the menu: how many items it adds, and which submenus under which parent — e.g. `OrganizationAdministration.ApplicationSuite_Extension: 11 items; adds submenu SATTransportation (under SATclassifications)`;
- `{"submenusOnly": true}`: the submenu tree alone, with an item count per submenu (`OrganizationAdministration`: 33 lines);
- a closing line on how to place an item or a submenu (`parentMenuElement`, the two operations).

**`objectType="menu-extension"`**: a full extension name shows that extension, a base menu name all of them (not stripped to the base name like the other extension types, since one extension of a menu is a useful answer here). Each entry under its parent (`under **EInvoice**, after EInvoiceCFDIPACTable_MX:`, `top level, first:`), with nested items, and the customizations of base elements (`ContosoSystemDate (Visible=No)`).

Output beyond 400 lines is cut with a pointer to `submenusOnly` or a single extension.

**Lookup** (`src/utils/menuFiles.ts`, new): `readMenuXml` and `readMenuExtensions` — index, configured model, then every package folder (the companion-lookup PR's `findAotFilesInAllPackages`), so a write-only companion reads standard menus. The menu-extension writers' `readBaseMenu`/`otherExtensionSubmenus` moved there unchanged and both writers and readers use them.

**`{"include": "xml"}`** for `menu` and `menu-extension` falls back to the index without a model filter and then the package folders, so the raw XML of a standard menu is readable on the companion too.

**Registration:** `OBJECT_INFO_TYPES` and `READER_DISPATCH` (`objectInfoRegistry.ts`), the objectType descriptions (`getObjectInfo.ts`, the tool schema, `index.ts`), `docs/MCP_TOOLS.md`.

**Schema budget:** the two enum values are paid for in `get_object_info`'s description, which no longer spells out the six `*-extension` types its own enum lists ("The *-extension types list all extensions of a base object"). Measured payload 45,090 → 45,038; the budget test records it.

## Tests

`tests/tools/menuInfo.test.ts` (new, 9 tests), with Contoso fixtures shaped like the shipped `OrganizationAdministration` and `OrganizationAdministration.ApplicationSuite_Extension` (the lookup mocked):
- the tree: depth, labels, an item whose element name differs from its menu item, an Action item, a tile; counts;
- `submenusOnly`: the submenu tree with an item count each, no items;
- the extension summary: item counts and added submenus with their parent;
- not found names where it looked;
- `menu-extension` with a full name (any casing): parent, `after <sibling>`, `first`, a nested item, a menu reference, a customization, and the base menu in the extension's own spelling; with a base name: every extension; not found for both forms;
- through `get_object_info`: both types accepted, options passed through;
- `include:"xml"` finds a menu in the package folders when neither the configured model nor the index has it.

The writer tests (`menuExtensionXml.test.ts`) pass unchanged on the moved lookup.

Against the `src/` of the companion-lookup PR: `menuInfo.test.ts` fails to load.

Rendered against the shipped files (outside the suite): `OrganizationAdministration` (33 submenus, 150 elements) with both of its extensions, and `OrganizationAdministration.ApplicationSuite_Extension` on its own, read as expected.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (536 test files passed, 2 skipped; 7821 tests passed, 30 skipped).

## Checklist

- [x] Read only; no C# bridge change.
- [x] CHANGELOG `[Unreleased]` → Added.
- [x] Tool schema payload lower than before.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
