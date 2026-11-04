# feat(menu): get_object_info reads menus and menu extensions

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.16` plus `.17` and `.18` (the answer on a read-only server, with the extensions the index knows) and `.19` (extensions the index knows but whose file was not read). PR branch `feat/menu-reader` = one commit `a6c6f35d` on top of the companion-lookup branch (`f6ebbdcb` → add-submenu `21cf2c45`, on upstream `main` `acd9d8e1`, after #1198 was merged); not yet filed. The test counts below are for the PR branch (`d365dev`: 535 files, 7,801 tests).*

**Depends on the add-submenu PR and the companion-lookup PR:** it uses `findAotFilesInAllPackages` from the last and moves its sibling-extension lookup into a shared util. Review the last commit only; the branch is rebased onto `main` as the others are merged.

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

**On a read-only server** (the shared server of the hybrid setup) only part can be read. It reads the files its index points to and still finds on its own disk: the source of the custom models the index was built from, but not the standard packages. The full index build indexes no menus, and the stored copies (`object_source`) leave menus out, so a base menu is never readable there; its custom extensions are.
- When nothing can be read, both readers say so and point to the local companion (`get_object_info` on `d365fo-local`). The wording avoids "not found", so `get_object_info` does not append its `search` / `update_symbol_index` guidance — which on a dev VM sent the agent looking for an object that exists. What the index does know there is which extensions a menu has (the full build indexes menu extensions by name), so the answer lists them with their model (`indexedMenuExtensions` in `menuFiles.ts`): "which extensions does Organization administration have?" is answered by the shared server itself.
- When only some extensions can be read, the readers count the rest in the heading (`# Extensions of menu … (5 of 7 read)`) and list them by name and model above the rendered ones, on a read-only server with the pointer to the companion. Without that, on a dev VM the shared server answered "Extensions of menu `OrganizationAdministration` (5)" with the custom extensions only, Microsoft's left out without a word, and the agent took it as the whole list.

**Lookup** (`src/utils/menuFiles.ts`, new): `readMenuXml` (`findBaseObjectXml`, which looks in every package folder for a menu since #1198) and `readMenuExtensions` (index, configured model, then every package folder through the companion-lookup PR's `findAotFilesInAllPackages`), so a write-only companion reads standard menus and their extensions. The menu-extension writers' `otherExtensionSubmenus` lookup moved there unchanged, and both writers and readers use it.

**`{"include": "xml"}`** for `menu` and `menu-extension` falls back to the index without a model filter and then the package folders, so the raw XML of a standard menu is readable on the companion too.

**Registration:** `OBJECT_INFO_TYPES` and `READER_DISPATCH` (`objectInfoRegistry.ts`), the objectType descriptions (`getObjectInfo.ts`, the tool schema, `index.ts`), `docs/MCP_TOOLS.md`.

**Schema budget:** the two enum values are paid for in `get_object_info`'s description, which no longer spells out the six `*-extension` types its own enum lists ("The *-extension types list all extensions of a base object"). Measured payload 45,090 → 45,038; the budget test records it.

## Out of scope / follow-ups

- Menus on a read-only server: the full build would have to index `AxMenu` (it indexes menu extensions, not menus) and `object_source` keep their XML (`STORED_SOURCE_TYPES` has no `menu`).

## Tests

`tests/tools/menuInfo.test.ts` (new, 16 tests), with Contoso fixtures shaped like the shipped `OrganizationAdministration` and `OrganizationAdministration.ApplicationSuite_Extension` (the lookup mocked):
- the tree: depth, labels, an item whose element name differs from its menu item, an Action item, a tile; counts;
- `submenusOnly`: the submenu tree with an item count each, no items;
- the extension summary: item counts and added submenus with their parent;
- not found names where it looked;
- `menu-extension` with a full name (any casing): parent, `after <sibling>`, `first`, a nested item, a menu reference, a customization, and the base menu in the extension's own spelling; with a base name: every extension; not found for both forms;
- through `get_object_info`: both types accepted, options passed through;
- `include:"xml"` finds a menu in the package folders when neither the configured model nor the index has it;
- on a read-only server, both types (and a base name for `menu-extension`) say they cannot be read there and point to the companion, with no `update_symbol_index` guidance, and list the extensions the index knows with their model; with files, "not found" stays and no index names are listed;
- extensions the index knows but whose file was not read (matched in any casing): counted in the heading and listed above the rendered ones, by both readers, with the companion pointer on a read-only server only; nothing added when every one was read, or for a single extension by name.

`tests/utils/menuFiles.test.ts` (new, 2 tests): `indexedMenuExtensions` queries `menu-extension` rows by prefix and drops a name that only matches the `LIKE` (`_` as a wildcard); empty without an index.

The writer tests (`menuExtensionXml.test.ts`) pass unchanged on the moved lookup.

Against the `src/` of the companion-lookup PR: `menuInfo.test.ts` fails to load.

**On a dev VM** (LCS, Claude Code, this change on the write-only companion and on the shared read-only server), asked in plain words without naming a server:
- the submenus of Organization administration;
- what an extension of it adds;
- the raw XML of `OrganizationAdministration`;
- an item under `EInvoice` (the agent found the submenu through the reader before writing).

In each case the agent asked the shared server first, got the "cannot be read on this server … d365fo-local" answer, and read the menu on the companion. It no longer searched the file system. Before the read-only answer, the shared server said "not found" with its search guidance, and the agent set out to grep PackagesLocalDirectory instead.

Rendered against the shipped files (outside the suite): `OrganizationAdministration` (33 submenus, 150 elements) with both of its extensions, and `OrganizationAdministration.ApplicationSuite_Extension` on its own, read as expected.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (539 test files passed, 2 skipped; 7839 tests passed, 30 skipped).

## Checklist

- [x] Read only; no C# bridge change.
- [x] CHANGELOG `[Unreleased]` → Added.
- [x] Tool schema payload lower than before.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
