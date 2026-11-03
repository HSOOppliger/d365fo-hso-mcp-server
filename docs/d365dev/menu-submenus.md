# feat(menu): add-submenu, and items into a submenu of a menu

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is `v1.22.0-d365dev.14`. PR branch `feat/menu-submenus` = one commit `be1066fb` on top of #1198's branch (`ba854436` on upstream `main` `a9094731`); not yet pushed or filed. The test counts below are for the PR branch (`d365dev`: 532 files, 7,775 tests).*

**Depends on #1198** (`add-menu-item-to-menu` on a menu extension): this branch builds on its `src/tools/xml/menuExtensionXml.ts` and carries its commit until #1198 is merged. Review the second commit only; after #1198 is merged the branch is rebased onto `main` and holds just this change.

## The gap

No operation writes a submenu, neither into a menu of one's own model nor into a standard menu through a menu extension. The `menu-navigation` knowledge topic said so ("a genuine, current tool gap") and told the agent to hand-write the element with `d365fo_file` create/modify and `overwrite`:

```xml
<AxMenuElement xmlns="" i:type="AxMenuElementSubMenu">
  <Name>MySetup</Name>
  <SubMenu>MySetup</SubMenu>   <!-- points at a separate AxMenu "MySetup" -->
</AxMenuElement>
```

That shape is not what the shipped AOT has. And once a submenu existed in a menu of one's own model, `add-menu-item-to-menu` could not put an item into it: the C# `AddMenuItemToMenu` has no parent, and its XML fallback inserted before the *first* `</Elements>` in the file. In a menu whose first element is a submenu (as in `OrganizationAdministration`, where it is `Workspaces`), that is the close of that submenu, so a top-level item landed inside it.

## The shipped shape

From the `AxMenu` `OrganizationAdministration` (33 submenus, 149 items) and 43 `AxMenuExtension` files from Microsoft models (68 submenus they add):

- A submenu is an **inline folder**: `<AxMenuElement xmlns="" i:type="AxMenuElementSubMenu">` with `Name`, optional properties and its own `<Elements>`, nested up to three deep in `OrganizationAdministration`. None of the 101 submenus has a `<SubMenu>` field.
- Child order: `Name`, then optional properties (`ConfigurationKey`, `CountryRegionCodes`, `FeatureClass`, `ImageLocation`, `Label`, `NormalImage` in that order), then `Elements`. `Label` is set on 49 of the 68 added submenus. An empty collection is written `<Elements />`.
- In an extension, an added submenu is a root `<AxMenuExtensionElement>` (with `<Parent>` for a submenu of the base menu, or without for the top level) holding `<MenuElement xmlns="" i:type="AxMenuElementSubMenu">`. A submenu inside a submenu the extension adds is nested there as `<AxMenuElement xmlns="">`, and so are its items.
- Another menu **object** inside a menu is `AxMenuElementMenuReference` with `<MenuName>`: that is how every `MainMenu.*` extension hooks a module menu in. The old topic called it "legacy".

## Change

**New operation `add-submenu`** on `objectType="menu"` and `"menu-extension"`, XML only (`MetadataWriteService` has no submenu op):
- `submenuName` (required), `submenuLabel` (label id, written as given; a value that does not start with `@` is written with a ⚠️ that BP expects a label), `parentMenuElement` (plain name of the submenu it goes under, omitted = top level).
- **menu-extension** (`addMenuExtensionSubmenu`): a root entry with `<Parent>`, or nested in a submenu the extension adds. The parent is checked like the item op's (#1198): the base menu, this extension and the other indexed extensions of the base menu; an unknown one is refused with the list; when the base menu cannot be read the submenu is written with a ⚠️.
- **menu** (`addMenuSubmenu`, new `src/tools/xml/menuXml.ts`): inline in the root `<Elements>` or in the named submenu of that menu; a parent the menu does not have is refused with its submenus.
- **Names are unique in the whole menu**, because a `<Parent>` names a submenu by its plain name. A name used by the base menu or another extension is refused, pointing to `add-menu-item-to-menu` with `parentMenuElement=<name>` instead; a name in this file under another parent is refused; the same name under the same parent again is a skip ("⏭️ … SKIPPED"). A duplicate fails the build, under the same parent and under another one alike — on a dev VM, a second `EInvoice` under `Setup`, and one under `Periodic`, each gave `The name 'EInvoice' is not unique. Multiple elements have the same name.` — so the check catches it at the call, with the way to use the existing submenu instead.
- The success message says how to fill the new submenu: `add-menu-item-to-menu` with `parentMenuElement=<submenuName>`.

**`add-menu-item-to-menu` on a `menu` takes `parentMenuElement`.** With a parent, the switch arm skips the bridge (its op has no parent) and calls `directXmlAddMenuItemToMenu` with it. That writer now goes through `addMenuItem` in `menuXml.ts`:
- collections are matched by depth, so a top-level item goes to the end of the **root** `<Elements>`, and an item for a submenu to the end of that submenu's;
- an item already in the target collection is a skip (it used to be written twice);
- the item shape is unchanged (one-line tag, explicit `MenuItemType` including Display), so menus written before and after read the same.
Without a parent the bridge still goes first and the writer is its fallback, as before.

**Shared code:** the depth-aware helpers of `menuExtensionXml.ts` (#1198) are exported for `menuXml.ts`, and its `ownSubmenuElements` became `findSubmenuElements`, which serves both file types. The parent check moved out of the item wrapper into `checkExtensionParent`, used by both wrappers.

**Gate / schema / specs:** `add-submenu` in `BRIDGE_MODIFY_OPS` and, for `menu-extension`, in `XML_ONLY_MODIFY_PAIRS` (`menu` is already in `BRIDGE_MODIFY_TYPES`); in the published operation enum and the zod enum; op spec with a note; param specs for `submenuName`, `submenuLabel`; `parentMenuElement`'s description and the `add-menu-item-to-menu` note no longer say "menu-extension only".

**Knowledge topic `menu-navigation`** rewritten: the inline shape, no `<SubMenu>` field, `AxMenuElementMenuReference` for menu objects, unique names, and the two operations first ("use the operations, never hand-written or overwritten XML"). The "tool gap" rule and the advice to build a submenu as a separate `AxMenu` are gone; the GenerateMetadata rule stays.

`docs/MCP_TOOLS.md` (42 operations), `docs/ARCHITECTURE.md`. The `modifyD365File.ts` line budget goes from 4,790 to 4,800 (4,787 → 4,798 lines): two argument lines, the import, the `add-submenu` arm and the branch for an item with a parent on a menu.

## Out of scope / follow-ups

- Submenu properties other than `Label` (`ConfigurationKey`, `CountryRegionCodes`, `FeatureClass`, images), and position (`PositionType`/`PreviousSibling`).
- The parent and name checks on a write-only companion, which has no index and so does not find a standard base menu (#1198's follow-up): a lookup across the package folders. A `menu`/`menu-extension` reader in `get_object_info` would also spare agents reading the XML from disk to find a submenu.
- `AxMenuElementMenuReference` (hooking a menu object into another menu) has no operation.

## Tests

`tests/tools/menuXml.test.ts` (new, 11 tests), on an excerpt of the shipped `OrganizationAdministration` (Contoso-renamed; its first element is a submenu) and on what create writes:
- a top-level item goes to the end of the root `<Elements>` with everything before it byte-identical, not into `Workspaces`;
- an item into `SATclassifications` (depth 3), by plain name, case-insensitive;
- a parent the menu does not have: `no-parent` with the submenu list;
- skip for an item already in the target collection, but not for the same item in another submenu;
- an empty `<Elements />` is opened, and `&` is escaped; a menu extension is declined;
- `addMenuSubmenu`: top level with label (exact text), nested without label, skip / `exists` for a taken name, `no-parent`, and a new submenu taking its first item.

`tests/tools/menuExtensionXml.test.ts` (+11):
- `addMenuExtensionSubmenu`: a root entry with `<Parent>` and `<Label>` (exact shipped text), the top level without `<Parent>`/`<Label>`, nested in a submenu the extension adds (split tag, no new root entry), skip / `exists`;
- `submenuLocations` gives root entries their `<Parent>` and nested submenus their enclosing one;
- `directXmlAddSubmenu` on temp files: under a base-menu submenu and then an item nested into the new submenu; a name the base menu or another indexed extension has is refused, file unchanged; an unknown parent is refused; an unreadable base menu and a literal label give their warnings; on an `AxMenu` nested under a submenu, refused for a missing parent, skipped the second time;
- `directXmlAddMenuItemToMenu` with a parent, and its refusal naming the submenus.

Also:
- `tests/tools/file-ops.test.ts`: through `modifyD365FileTool`, `add-submenu` on a menu extension and an item with a parent on a menu never call the bridge, and write the expected shapes.
- `tests/bridge/canBridgeModify.test.ts`: `add-submenu` passes on `menu` and `menu-extension`.
- `tests/tools/xpp-knowledge.test.ts`: the `submenu` topic names `add-submenu` and `parentMenuElement`, has no `<SubMenu>X` field and no "tool gap".
- `tests/tools/d365foFileOpSpecs.test.ts` (42 operations), `tests/utils/toolInventory.test.ts`, `tests/utils/layering.test.ts`.

Against the `src/` of #1198: `menuXml.test.ts` fails to load and 16 tests in the other files fail.

**On a dev VM** (LCS, Claude Code, this change on the write-only companion and on the shared server):
- a submenu with a label under `Setup` in an extension of `OrganizationAdministration`, then an item into it: the item is nested in the new submenu;
- the same `add-submenu` call again: reported as skipped, file unchanged;
- in a menu of the model itself: a submenu, then an item into it; an item for a submenu the menu does not have is refused with the list of its submenus;
- build and BP check clean, and the new submenus and items show up in the browser where they should;
- a submenu named like one of the base menu (`EInvoice`, once under `Setup` where the base menu has it, once under `Periodic`): on the companion written with the "NOT checked" warning (no index there, see the follow-ups), and the build then fails both times with the error quoted above.

Asked in plain words to add a submenu whose name the base menu already has, or the same submenu again, the agent read the menu XML itself and asked back instead of calling the tool; the two cases above were therefore sent as explicit tool calls.

Also run, outside the suite, against the shipped files: a submenu at the top level and under each of the 74 submenus the 43 extensions add, and a submenu and an item under each of the 33 submenus of `OrganizationAdministration` and at its top level — 185 results, each parsed and checked to sit as the last child of the right collection.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (534 test files passed, 2 skipped; 7804 tests passed, 30 skipped).

## Checklist

- [x] XML only; no C# bridge change.
- [x] `menu` without a parent unchanged (bridge first, XML fallback), apart from the insertion point and the skip.
- [x] CHANGELOG `[Unreleased]` → Added.
- [x] No settings, DB schema or parser change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
