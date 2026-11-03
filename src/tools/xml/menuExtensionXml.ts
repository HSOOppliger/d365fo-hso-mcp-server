/**
 * Menu items into an AxMenuExtension — the write half `menu-extension` never had.
 *
 * The cross-model write guard sends an agent that wants an item in a standard
 * menu to a `menu-extension` (EXTENSION_TYPE_OF.menu), and create wrote one —
 * but every modify on it was refused at the bridge gate, so the extension could
 * not be filled. The C# AddMenuItemToMenu reads an AxMenu only, and the AxMenu
 * XML fallback writes the wrong shape for an extension (a bare <AxMenuElement>
 * directly under <Elements>).
 *
 * Shape pinned against the shipped AOT — 224 AxMenuExtension files in Microsoft
 * models (e.g. ApplicationWorkspaces\AxMenuExtension\RetailMain.Workspaces.xml,
 * ApplicationSuite\Foundation\AxMenuExtension\MainMenu.Tax.xml):
 *   - each entry of the root <Elements> is an <AxMenuExtensionElement xmlns="">,
 *     its children in the order Parent?, PositionType?, PreviousSibling?,
 *     MenuElement — all four shapes occur;
 *   - the element itself is <MenuElement xmlns="" i:type="AxMenuElementMenuItem">,
 *     the attribute on its own line, holding Name, MenuItemName, MenuItemType;
 *   - MenuItemType is written for Action and Output only — the shipped Display
 *     items omit it (Display is the model default);
 *   - <Parent> is a plain submenu name: 112 distinct values, none with a path
 *     separator. Without it the item lands on the top level of the base menu,
 *     which 107 of the 279 entry shapes do, menu items among them;
 *   - root order Name, Customizations, Elements, MenuElementModifications,
 *     PropertyModifications in 192 files, the first three only in 32.
 *
 * Appends at the end only: PositionType / PreviousSibling stay out until there
 * is a shipped sample of PreviousSibling to pin them against.
 */
import { escapeXml } from '../../utils/xmlEscape.js';

export type MenuExtensionItemType = 'display' | 'action' | 'output';

export interface MenuExtensionItemSpec {
  menuItemName: string;
  menuItemType?: string;
  /** Submenu of the base menu (or of this extension) the item goes under; empty = top level. */
  parent?: string;
}

export type AddMenuExtensionItemResult =
  | { kind: 'added'; xml: string; menuItemType: MenuExtensionItemType }
  /** The same menu item is already under the same parent — idempotent no-op. */
  | { kind: 'already-present' }
  /** No root <Elements> collection to insert into. */
  | { kind: 'no-collection' }
  /** Not an AxMenuExtension; the caller declines. */
  | { kind: 'unsupported' };

const MENU_ITEM_TYPE_VALUE: Record<MenuExtensionItemType, string | null> = {
  display: null,
  action: 'Action',
  output: 'Output',
};

/**
 * Span of the ROOT <Elements> — the first one in the file, matched to its own
 * close. Not the first `</Elements>`: an entry that adds a submenu nests its own
 * <Elements>, and closing on that one would put the new item inside the submenu.
 */
function rootElementsSpan(xml: string): { open: number; openEnd: number; close: number; selfClosed: boolean } | null {
  const re = /<Elements\b[^>]*?(\/?)>|<\/Elements>/g;
  let depth = 0;
  let open = -1;
  let openEnd = -1;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0].startsWith('</')) {
      if (--depth === 0) return { open, openEnd, close: m.index, selfClosed: false };
    } else if (open < 0) {
      open = m.index;
      openEnd = m.index + m[0].length;
      if (m[1] === '/') return { open, openEnd, close: openEnd, selfClosed: true };
      depth = 1;
    } else if (m[1] !== '/') {
      depth++;
    }
  }
  return null;
}

/** Text of the first `<tag>` that is a DIRECT child of the element whose open tag ends at `from`. */
function directChildText(xml: string, from: number, tag: string): string | null {
  const re = /<(\/?)([A-Za-z_][\w.:-]*)\b[^>]*?(\/?)>/g;
  re.lastIndex = from;
  let depth = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] === '/') {
      if (--depth < 0) return null;
    } else if (m[3] !== '/') {
      if (depth === 0 && m[2] === tag) {
        const end = xml.indexOf(`</${tag}>`, re.lastIndex);
        return end < 0 ? null : xml.slice(re.lastIndex, end).trim();
      }
      depth++;
    }
  }
  return null;
}

/**
 * Names of every submenu in an AxMenu or AxMenuExtension, at any depth, as written
 * in the file (still XML-escaped). A <Parent> may name a nested submenu by its
 * plain name, and an extension may add a submenu and items under it in one file.
 */
export function menuSubmenuNames(xml: string): string[] {
  const names: string[] = [];
  const re = /<[A-Za-z_][\w.:-]*\b[^>]*\bi:type="AxMenuElementSubMenu"[^>]*>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0].endsWith('/>')) continue;
    const name = directChildText(xml, m.index + m[0].length, 'Name');
    if (name) names.push(name);
  }
  return names;
}

/** Add one menu item to an AxMenuExtension, at the end of its root <Elements>. */
export function addMenuExtensionItem(xml: string, spec: MenuExtensionItemSpec): AddMenuExtensionItemResult {
  if (!/<AxMenuExtension\b/.test(xml)) return { kind: 'unsupported' };
  const span = rootElementsSpan(xml);
  if (!span) return { kind: 'no-collection' };

  const raw = String(spec.menuItemType ?? '').trim().toLowerCase();
  const menuItemType: MenuExtensionItemType = raw === 'action' || raw === 'output' ? raw : 'display';
  const name = escapeXml(String(spec.menuItemName).trim());
  const parent = spec.parent?.trim() ? escapeXml(spec.parent.trim()) : '';

  // Compared escaped against escaped, case-insensitively as X++ names are.
  const same = (a: string | null | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();
  const body = xml.slice(span.openEnd, span.close);
  const entryRe = /<AxMenuExtensionElement\b[^>]*>([\s\S]*?)<\/AxMenuExtensionElement>/g;
  for (let m = entryRe.exec(body); m; m = entryRe.exec(body)) {
    const head = m[1].split(/<MenuElement\b/)[0];
    const entryParent = /<Parent>([\s\S]*?)<\/Parent>/.exec(head)?.[1].trim() ?? '';
    const isMenuItem = /<MenuElement\b[^>]*\bi:type="AxMenuElementMenuItem"/.test(m[1]);
    const itemName = /<MenuItemName>([\s\S]*?)<\/MenuItemName>/.exec(m[1])?.[1].trim();
    if (isMenuItem && same(itemName, name) && same(entryParent, parent)) return { kind: 'already-present' };
  }

  const typeValue = MENU_ITEM_TYPE_VALUE[menuItemType];
  const block =
    `\t\t<AxMenuExtensionElement xmlns="">\n` +
    (parent ? `\t\t\t<Parent>${parent}</Parent>\n` : '') +
    `\t\t\t<MenuElement xmlns=""\n` +
    `\t\t\t\ti:type="AxMenuElementMenuItem">\n` +
    `\t\t\t\t<Name>${name}</Name>\n` +
    `\t\t\t\t<MenuItemName>${name}</MenuItemName>\n` +
    (typeValue ? `\t\t\t\t<MenuItemType>${typeValue}</MenuItemType>\n` : '') +
    `\t\t\t</MenuElement>\n` +
    `\t\t</AxMenuExtensionElement>\n`;

  // An empty collection in either spelling becomes an open/close pair; otherwise
  // insert before the root close, consuming the whitespace run that is that tag's
  // own indent so the block is not indented on top of it.
  if (span.selfClosed || !body.trim()) {
    const end = span.selfClosed ? span.openEnd : span.close + '</Elements>'.length;
    return {
      kind: 'added',
      xml: `${xml.slice(0, span.open)}<Elements>\n${block}\t</Elements>${xml.slice(end)}`,
      menuItemType,
    };
  }
  let from = span.close;
  while (from > 0 && /\s/.test(xml[from - 1])) from--;
  return { kind: 'added', xml: `${xml.slice(0, from)}\n${block}\t${xml.slice(span.close)}`, menuItemType };
}
