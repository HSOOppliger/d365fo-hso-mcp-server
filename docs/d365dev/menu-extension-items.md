# feat(menu): add-menu-item-to-menu on a menu extension

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.11` plus the corrections in `v1.22.0-d365dev.12` (items nested in the extension's own submenus, parents from other extensions, shipped-shape fixtures) and `v1.22.0-d365dev.13` (what a wrong parent does, the dev-VM test). PR branch `feat/menu-extension-add-menu-item` = one commit `00f1f54d` on upstream `main` `5122a30b`; not yet pushed or filed. The test counts below are for the PR branch (`d365dev`: 531 files, 7,749 tests).*

## The gap

```
d365fo_file(action="modify", objectType="menu-extension", objectName="ContosoMain.ContosoExtension",
            operation="add-menu-item-to-menu", params={ menuItemToAdd: "ContosoRentForm" })
→ Error modifying D365FO file: Operation 'add-menu-item-to-menu' on object type 'menu-extension'
  is not supported by the bridge.
```

An agent usually gets here by trying to add an item to a standard menu. The cross-model write guard then tells it to use a `menu-extension` (`EXTENSION_TYPE_OF.menu`, `src/utils/crossModelWriteGuard.ts`). The tool can create that extension, but it can't fill it. `canBridgeModify()` refuses every modify on `menu-extension`, because the type is in neither `BRIDGE_MODIFY_TYPES` nor `XML_ONLY_MODIFY_PAIRS`. The schema still lists `menu-extension` as an object type and `add-menu-item-to-menu` as an operation, so the operation looks supported.

Adding the pair to the gate alone isn't enough:
- the switch arm would send the extension name to the C# `AddMenuItemToMenu`, which reads an `AxMenu` only;
- the fallback, `directXmlAddMenuItemToMenu`, would then write a bare `<AxMenuElement i:type="AxMenuElementMenuItem">` directly under `<Elements>`. That is the `AxMenu` shape, not the extension's.

## The shipped shape

Measured over the 224 `AxMenuExtension` files in Microsoft models of a 10.0 PackagesLocalDirectory (e.g. `ApplicationWorkspaces\AxMenuExtension\RetailMain.Workspaces.xml`, `ApplicationSuite\Foundation\AxMenuExtension\MainMenu.Tax.xml`):

```xml
<Elements>
	<AxMenuExtensionElement xmlns="">
		<Parent>TaskManagement</Parent>
		<MenuElement xmlns=""
			i:type="AxMenuElementMenuItem">
			<Name>ContosoTaskCleaner</Name>
			<MenuItemName>ContosoTaskCleaner</MenuItemName>
			<MenuItemType>Action</MenuItemType>
		</MenuElement>
	</AxMenuExtensionElement>
</Elements>
```

- The children of an entry come in the order `Parent?`, `PositionType?`, `PreviousSibling?`, `MenuElement`. Entry shapes: `[Parent, MenuElement]` 99, `[MenuElement]` 77, `[Parent, PositionType, PreviousSibling, MenuElement]` 59, `[PositionType, PreviousSibling, MenuElement]` 23, `[Parent, PositionType, MenuElement]` 14, `[PositionType, MenuElement]` 7.
- `<Parent>` is a plain submenu name. None of the 112 distinct values contains a path separator, and nested submenus are named the same way: `OrganizationAdministration.ApplicationSuite_Extension` parents items on `SATclassifications`, which sits at depth 3 of `OrganizationAdministration` (Setup › EInvoice › SATclassifications). Without `<Parent>`, the item goes on the top level of the base menu.
- A submenu that an extension adds itself is a `<MenuElement i:type="AxMenuElementSubMenu">` with its own `<Elements>`, and its items are **nested** there as `<AxMenuElement xmlns="">`. A sample of 43 extensions has 197 such nested items, and none written as a separate entry with `<Parent>` naming the extension's own submenu.
- A `<Parent>` may also name a submenu that **another** extension of the same base menu adds: `GeneralLedger.AppSuite_TR_Extension` uses `PeriodEndReports` from `GeneralLedger.ApplicationSuite`, and `navpanemenu.EngChg` uses `ProductManagement` from `NavPaneMenu.ApplicationSuite`.
- A base `AxMenu` holds its submenus inline: `<AxMenuElement xmlns="" i:type="AxMenuElementSubMenu">` with `Name`, `Label` and nested `Elements` (33 of them in `OrganizationAdministration`). There is no `<SubMenu>` field in any of the 44 files.
- `MenuItemType` appears for Action and Output only. Display items omit it, since Display is the model default.
- Root order: `Name, Customizations, Elements, MenuElementModifications, PropertyModifications` in 192 files, and only the first three in 32. `generateAxMenuExtensionXml` writes the first form, so the create template needs no change.

## Change

**Gate** (`src/bridge/bridgeAdapter.ts`): `'add-menu-item-to-menu': new Set(['menu-extension'])` in `XML_ONLY_MODIFY_PAIRS`. The op was already in `BRIDGE_MODIFY_OPS`. Only this pair is opened: other ops on a `menu-extension` are still refused.

**Dispatch** (`src/tools/write/modifyD365File.ts`): on a `menu-extension`, the switch arm skips the bridge and the `AxMenu` fallback and calls `directXmlAddMenuItemToMenuExtension`, wrapped in `viaXmlFallback`. The `menu` path is unchanged.

**Writer**: `src/tools/xml/menuExtensionXml.ts` (pure, new) and the wrapper in `src/tools/write/directXmlWriters.ts` (`serializedOnFile`, `writeFileAtomic`, `normalizeD365Xml`, like its neighbours).
- It appends the entry above at the end of the **root** `<Elements>`, whether written `<Elements />` or as an open/close pair. Collections are matched by depth, not by the first `</Elements>`, because an entry that adds a submenu nests an `<Elements>` of its own. Existing entries stay byte-identical.
- When `parentMenuElement` names a submenu that this extension adds (at any depth), the item is nested at the end of that submenu's `<Elements>` instead, with no `<Parent>`, as the shipped files do.
- `menuItemToAddType` display, action or output. Display writes no `MenuItemType`.
- Every value is XML-escaped.
- The same menu item under the same parent (case-insensitive) is a skip: `{ success: true, skipped: true }`, rendered as "⏭️ … SKIPPED, nothing was written". The file isn't touched.
- A file that isn't an `AxMenuExtension`, or has no `<Elements>`, gets a specific refusal instead of the generic "object not resolved" retry.

**New optional parameter `parentMenuElement`**: the submenu of the base menu the item goes under. Leave it out for the top level. It is checked before anything is written. A `<Parent>` that names no submenu fails the next build; the check catches it at the call instead, with the list of the submenus that do exist, so the agent can correct the call.
- The base menu is the part of the extension name before the first dot. It is read with `findBaseObjectXml('menu', …)`.
- Accepted: a submenu of the base menu at any depth, one this extension adds, or one another extension of the base menu adds. Shipped extensions do all three (see above). The other extensions are found in the symbol index (`symbols`, type `menu-extension`, name `<BaseMenu>.%`) and read only when the base menu and this extension don't have the name.
- Matching is case-insensitive, and the base menu's spelling is written.
- An unknown name is refused with the list of the submenus that do exist. If the base menu can't be read, the item is written with a ⚠️ saying that the parent wasn't checked.

**Op spec / schema / knowledge**:
- `parentMenuElement` is in the zod args, the op spec (optional) and the param descriptions.
- The op spec has a `note` saying that the op works on `menu` and `menu-extension`, and what the parent means.
- There is no alias: `parent` is already the alias of `parentControl`.
- The `menu-navigation` knowledge topic has one new rule: an item for a standard menu goes into a menu-extension through this op. The rule that no operation adds a submenu stays, because that is still true.

**Small fix on the way:** `directXmlAddMenuItemToMenu` (the `AxMenu` fallback) now escapes `menuItemToAdd`.

`docs/ARCHITECTURE.md` names the new path. The `modifyD365File.ts` line budget in `tests/utils/layering.test.ts` goes from 4,780 to 4,790 (4,779 → 4,787 lines): the writer and the check live outside the dispatcher.

## Out of scope / follow-ups

- **Parent check on a write-only companion:** it has no index, and `findD365FileOnDisk` looks only in the configured model, so a standard base menu is not found there and the check falls back to the warning. A lookup across the package folders would close that; together with a `menu`/`menu-extension` reader in `get_object_info`, which today has neither type (agents read the XML from disk to find a submenu).
- **Position:** append only. The shipped values are `Begin` (27) and `AfterItem` + `PreviousSibling` (54) and nothing else; left out by choice for now.
- **The `AxMenu` fallback** still inserts before the *first* `</Elements>`. In a menu with inline submenus (in `OrganizationAdministration` the first one closes `Workspaces`), the item lands inside the first submenu. The depth-aware matcher from this change can serve it too.
- **Adding a submenu** (menus and menu extensions alike), together with a fix of the `menu-navigation` knowledge topic: it teaches a `<SubMenu>` field that no shipped file has, and calls `AxMenuElementMenuReference` "legacy", although every `MainMenu.*` extension uses it to hook in a module menu. Planned as a separate PR.
- `MenuElementModifications`, and modify on menu-item extensions.

## Tests

`tests/tools/menuExtensionXml.test.ts` (new, 25 tests). The fixtures are shipped files with the objects renamed to Contoso: the extensions `RetailMain.Workspaces` and `MainMenu.Tax`, two entries of `AccountsPayable.Extension` and `navpanemenu.ReqDefinePlanningPolicies` (submenus the extension adds), an excerpt of the `AxMenu` `OrganizationAdministration`, plus what create writes.
- An empty `<Elements />` gets the exact shipped entry text: tabs, `xmlns=""` resets, the attribute on its own line, no `MenuItemType` for Display.
- The top level gets no `<Parent>`.
- Action and Output write `MenuItemType` (also for `OUTPUT`).
- Existing entries: the new one is appended and everything before and after it is byte-identical.
- A root without the two modification collections.
- An extension with a submenu that nests `<Elements>`: an item for a base-menu parent goes into the root collection.
- An item for a submenu the extension adds is nested inside it (exact shipped text, no `<Parent>`, no new root entry), an empty `<Elements />` there is opened, and an item already nested there is skipped.
- Skip: the same item under the same parent case-insensitively is skipped. The same item under another parent or on the top level, and a tile of that name, are not.
- `&` and `<` are escaped, and an escaped item is recognised again.
- Not an extension or no `<Elements>`: declined.
- `menuSubmenuNames` finds submenus at any depth by their own `<Name>`.
- Wrapper on temp files, with `findBaseObjectXml` mocked:
  - CRLF without a trailing newline, and the base menu's spelling of a parent at depth 3;
  - an unknown parent is refused with the list and the file is unchanged;
  - a submenu the extension adds itself takes the item nested, and the message says so;
  - a submenu that another indexed extension adds is accepted; the extension itself and a name that only matches the `LIKE` aren't read;
  - other extensions aren't read when the base menu has the parent;
  - an unreadable base menu gives the warning;
  - no lookup for the top level;
  - the second identical call is a skip with the file unchanged;
  - a specific refusal for a file without `<Elements>`;
  - the `AxMenu` writer escapes.

Also:
- `tests/bridge/canBridgeModify.test.ts`: the pair is accepted; `add-method` and `modify-property` on `menu-extension` are still refused.
- `tests/tools/file-ops.test.ts`: through `modifyD365FileTool` with a mock bridge, `menu-extension` never calls `addMenuItemToMenu`, writes the extension shape and reports the XML writer. The existing `menu` test, where the bridge is tried first, still passes.
- `tests/utils/toolInventory.test.ts`: `parentMenuElement` is surfaced in the op-spec registry.

Against `src/` before the change: the new file fails to import, and the three new cases in the other files fail.

**On a dev VM** (LCS, Claude Code, this change on the write-only companion and on the shared server), against `OrganizationAdministration`:
- a display item on the top level of a new extension;
- an action item under the nested base submenu `EInvoice` (Setup › Electronic invoice);
- the same call again: reported as skipped, file unchanged;
- an item for a submenu added to the extension in the Visual Studio designer: nested inside it;
- an output item under `Setup`;
- build and BP check clean, and the items show up in the browser where they should;
- a deliberately wrong parent: on the companion written with the "NOT checked" warning (see the follow-ups), and the build then fails.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (522 test files passed, 2 skipped; 7489 tests passed, 30 skipped).

## Checklist

- [x] XML only; no C# bridge change.
- [x] `menu` unchanged apart from escaping the item name.
- [x] CHANGELOG `[Unreleased]` → Added.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
