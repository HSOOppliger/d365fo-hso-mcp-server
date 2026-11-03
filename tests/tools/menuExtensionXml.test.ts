/**
 * add-menu-item-to-menu on a menu-extension: the AxMenuExtension writer.
 *
 * The fixtures are shipped AxMenuExtension files from Microsoft models with the
 * objects renamed to Contoso — the shape, indentation and `xmlns=""` resets are
 * theirs:
 *   EXISTING_EXT  ← ApplicationWorkspaces RetailMain.Workspaces (Customizations,
 *                   Parent + PositionType, a Tile and an Action item)
 *   SHORT_ROOT    ← ApplicationSuite MainMenu.Tax (root without the two
 *                   modification collections, a top-level entry)
 * EMPTY_EXT is what create writes (generateAxMenuExtensionXml). The submenu
 * fixtures (SUBMENU_EXT, BASE_MENU) are constructed: no shipped sample of a
 * nested <Elements> was at hand, and they exist to prove the root collection
 * is found by depth, not by the first `</Elements>`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';

vi.mock('../../src/utils/baseObjectXml.js', () => ({
  findBaseObjectXml: vi.fn(async () => null),
  findBaseFormXml: vi.fn(async () => null),
}));

import { findBaseObjectXml } from '../../src/utils/baseObjectXml.js';
import { addMenuExtensionItem, menuSubmenuNames } from '../../src/tools/xml/menuExtensionXml';
import { directXmlAddMenuItemToMenu, directXmlAddMenuItemToMenuExtension } from '../../src/tools/write/directXmlWriters';
import { XmlTemplateGenerator } from '../../src/tools/xml/xmlTemplateGenerator';

const EMPTY_EXT = XmlTemplateGenerator.generateAxMenuExtensionXml('ContosoMain.ContosoExtension');

const EXISTING_EXT = `<?xml version="1.0" encoding="utf-8"?>
<AxMenuExtension xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="Microsoft.Dynamics.AX.Metadata.V1">
	<Name>ContosoMain.ContosoExtension</Name>
	<Customizations>
		<AxMenuCustomizationElement xmlns="">
			<Name>ContosoTemplateListPage</Name>
			<Visible>No</Visible>
		</AxMenuCustomizationElement>
	</Customizations>
	<Elements>
		<AxMenuExtensionElement xmlns="">
			<Parent>Channels</Parent>
			<PositionType>Begin</PositionType>
			<MenuElement xmlns=""
				i:type="AxMenuElementTile">
				<Name>ContosoChannelWorkspace</Name>
				<Tile>ContosoChannelWorkspace</Tile>
			</MenuElement>
		</AxMenuExtensionElement>
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
	<MenuElementModifications />
	<PropertyModifications />
</AxMenuExtension>`;

const SHORT_ROOT = `<?xml version="1.0" encoding="utf-8"?>
<AxMenuExtension xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="Microsoft.Dynamics.AX.Metadata.V1">
	<Name>MainMenu.ContosoTax</Name>
	<Customizations />
	<Elements>
		<AxMenuExtensionElement xmlns="">
			<MenuElement xmlns=""
				i:type="AxMenuElementMenuReference">
				<Name>ContosoTax</Name>
				<MenuName>ContosoTax</MenuName>
			</MenuElement>
		</AxMenuExtensionElement>
	</Elements>
</AxMenuExtension>`;

const SUBMENU_EXT = `<?xml version="1.0" encoding="utf-8"?>
<AxMenuExtension xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="Microsoft.Dynamics.AX.Metadata.V1">
	<Name>ContosoMain.ContosoSubmenus</Name>
	<Customizations />
	<Elements>
		<AxMenuExtensionElement xmlns="">
			<Parent>Setup</Parent>
			<MenuElement xmlns=""
				i:type="AxMenuElementSubMenu">
				<Name>ContosoCleanUp</Name>
				<Elements>
					<AxMenuElement i:type="AxMenuElementMenuItem">
						<Name>ContosoNested</Name>
						<MenuItemName>ContosoNested</MenuItemName>
					</AxMenuElement>
				</Elements>
				<Label>@Contoso:CleanUp</Label>
			</MenuElement>
		</AxMenuExtensionElement>
	</Elements>
	<MenuElementModifications />
	<PropertyModifications />
</AxMenuExtension>`;

const BASE_MENU = `<?xml version="1.0" encoding="utf-8"?>
<AxMenu xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="Microsoft.Dynamics.AX.Metadata.V1">
	<Name>ContosoMain</Name>
	<Elements>
		<AxMenuElement xmlns="" i:type="AxMenuElementSubMenu">
			<Name>Inquiries</Name>
			<Elements>
				<AxMenuElement i:type="AxMenuElementSubMenu">
					<Name>Reports</Name>
					<Elements />
				</AxMenuElement>
			</Elements>
		</AxMenuElement>
		<AxMenuElement xmlns="" i:type="AxMenuElementMenuItem">
			<Name>Inquiries2</Name>
			<MenuItemName>Inquiries2</MenuItemName>
		</AxMenuElement>
		<AxMenuElement xmlns="" i:type="AxMenuElementSubMenu">
			<Name>Setup</Name>
			<Elements />
		</AxMenuElement>
	</Elements>
</AxMenu>`;

function added(xml: string, spec: Parameters<typeof addMenuExtensionItem>[1]): string {
  const r = addMenuExtensionItem(xml, spec);
  if (r.kind !== 'added') throw new Error(`expected added, got ${r.kind}`);
  return r.xml;
}

describe('addMenuExtensionItem', () => {
  it('fills an empty <Elements /> with the shipped entry shape (Display carries no MenuItemType)', () => {
    const xml = added(EMPTY_EXT, { menuItemName: 'ContosoRentForm', parent: 'Inquiries' });
    expect(xml).toContain(
      '\t<Customizations />\n' +
      '\t<Elements>\n' +
      '\t\t<AxMenuExtensionElement xmlns="">\n' +
      '\t\t\t<Parent>Inquiries</Parent>\n' +
      '\t\t\t<MenuElement xmlns=""\n' +
      '\t\t\t\ti:type="AxMenuElementMenuItem">\n' +
      '\t\t\t\t<Name>ContosoRentForm</Name>\n' +
      '\t\t\t\t<MenuItemName>ContosoRentForm</MenuItemName>\n' +
      '\t\t\t</MenuElement>\n' +
      '\t\t</AxMenuExtensionElement>\n' +
      '\t</Elements>\n' +
      '\t<MenuElementModifications />\n',
    );
    expect(xml).not.toContain('MenuItemType');
  });

  it('writes no <Parent> for the top level', () => {
    const xml = added(EMPTY_EXT, { menuItemName: 'ContosoRentForm' });
    expect(xml).not.toContain('<Parent>');
    expect(xml).toContain('\t\t<AxMenuExtensionElement xmlns="">\n\t\t\t<MenuElement xmlns=""\n');
  });

  it.each([['action', 'Action'], ['output', 'Output'], ['OUTPUT', 'Output']])(
    'writes MenuItemType for %s',
    (type, value) => {
      const xml = added(EMPTY_EXT, { menuItemName: 'ContosoRentJob', menuItemType: type });
      expect(xml).toContain(
        `\t\t\t\t<MenuItemName>ContosoRentJob</MenuItemName>\n\t\t\t\t<MenuItemType>${value}</MenuItemType>\n\t\t\t</MenuElement>`,
      );
    },
  );

  it('appends after the existing entries and leaves them byte-identical', () => {
    const xml = added(EXISTING_EXT, { menuItemName: 'ContosoRentForm', parent: 'Channels' });
    const lastOld = EXISTING_EXT.indexOf('\n\t</Elements>');
    expect(xml.slice(0, lastOld)).toBe(EXISTING_EXT.slice(0, lastOld));
    expect(xml.slice(xml.indexOf('\n\t</Elements>'))).toBe(EXISTING_EXT.slice(lastOld));
    expect(xml.slice(lastOld)).toMatch(/^\n\t\t<AxMenuExtensionElement xmlns="">\n\t\t\t<Parent>Channels<\/Parent>/);
  });

  it('works on a root without the two modification collections', () => {
    const xml = added(SHORT_ROOT, { menuItemName: 'ContosoTaxSetup' });
    expect(xml.endsWith('\t\t</AxMenuExtensionElement>\n\t</Elements>\n</AxMenuExtension>')).toBe(true);
  });

  it('appends to the ROOT <Elements>, not into a submenu the extension adds', () => {
    const xml = added(SUBMENU_EXT, { menuItemName: 'ContosoRentForm', parent: 'ContosoCleanUp' });
    const nestedClose = xml.indexOf('\t\t\t\t</Elements>');
    expect(xml.indexOf('<MenuItemName>ContosoRentForm')).toBeGreaterThan(nestedClose);
    expect(xml).toMatch(/<\/AxMenuExtensionElement>\n\t\t<AxMenuExtensionElement xmlns="">\n\t\t\t<Parent>ContosoCleanUp/);
  });

  it('skips the same menu item under the same parent, case-insensitively', () => {
    expect(addMenuExtensionItem(EXISTING_EXT, { menuItemName: 'contosotaskcleaner', parent: 'TASKMANAGEMENT' }).kind)
      .toBe('already-present');
    // Same item, other parent (or the top level) is a different placement.
    expect(addMenuExtensionItem(EXISTING_EXT, { menuItemName: 'ContosoTaskCleaner', parent: 'Channels' }).kind)
      .toBe('added');
    expect(addMenuExtensionItem(EXISTING_EXT, { menuItemName: 'ContosoTaskCleaner' }).kind).toBe('added');
    // A tile of that name is not a menu item.
    expect(addMenuExtensionItem(EXISTING_EXT, { menuItemName: 'ContosoChannelWorkspace', parent: 'Channels' }).kind)
      .toBe('added');
  });

  it('escapes the values, and still recognises the escaped item afterwards', () => {
    const xml = added(EMPTY_EXT, { menuItemName: 'Contoso&Co', parent: 'A<B' });
    expect(xml).toContain('<MenuItemName>Contoso&amp;Co</MenuItemName>');
    expect(xml).toContain('<Parent>A&lt;B</Parent>');
    expect(addMenuExtensionItem(xml, { menuItemName: 'Contoso&Co', parent: 'A<B' }).kind).toBe('already-present');
  });

  it('declines a file that is not a menu extension, or has no <Elements>', () => {
    expect(addMenuExtensionItem(BASE_MENU, { menuItemName: 'X' }).kind).toBe('unsupported');
    expect(addMenuExtensionItem(EMPTY_EXT.replace('\t<Elements />\n', ''), { menuItemName: 'X' }).kind)
      .toBe('no-collection');
  });
});

describe('menuSubmenuNames', () => {
  it('finds submenus at any depth by their own <Name>, not a nested one', () => {
    expect(menuSubmenuNames(BASE_MENU)).toEqual(['Inquiries', 'Reports', 'Setup']);
    expect(menuSubmenuNames(SUBMENU_EXT)).toEqual(['ContosoCleanUp']);
    expect(menuSubmenuNames(EXISTING_EXT)).toEqual([]);
  });
});

describe('directXmlAddMenuItemToMenuExtension', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
    vi.mocked(findBaseObjectXml).mockReset();
    vi.mocked(findBaseObjectXml).mockResolvedValue(null);
  });

  async function extFile(xml: string, name = 'ContosoMain.ContosoExtension'): Promise<string> {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-ext-'));
    const file = path.join(dir, `${name}.xml`);
    await fs.writeFile(file, xml.replace(/\n/g, '\r\n'), 'utf-8');
    return file;
  }

  it('writes CRLF without a trailing newline, and names where the item went', async () => {
    vi.mocked(findBaseObjectXml).mockResolvedValue(BASE_MENU);
    const file = await extFile(EMPTY_EXT);
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoRentForm', parentMenuElement: 'reports' }, {});
    expect(r.success).toBe(true);
    expect(r.skipped).toBeUndefined();
    expect(r.message).toContain("under submenu 'Reports' of menu 'ContosoMain'");
    expect(findBaseObjectXml).toHaveBeenCalledWith('menu', 'ContosoMain', {});
    const written = await fs.readFile(file, 'utf-8');
    // The base menu's spelling is written, not the caller's.
    expect(written).toContain('<Parent>Reports</Parent>\r\n');
    expect(written).not.toMatch(/(^|[^\r])\n/);
    expect(written.endsWith('</AxMenuExtension>')).toBe(true);
  });

  it('refuses a parent that is in neither the base menu nor the extension, and lists the submenus', async () => {
    vi.mocked(findBaseObjectXml).mockResolvedValue(BASE_MENU);
    const file = await extFile(SUBMENU_EXT, 'ContosoMain.ContosoSubmenus');
    const before = await fs.readFile(file, 'utf-8');
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoRentForm', parentMenuElement: 'Periodic' }, {});
    expect(r.success).toBe(false);
    expect(r.message).toContain("Submenu 'Periodic' is not in menu 'ContosoMain'");
    expect(r.message).toContain('Inquiries, Reports, Setup, ContosoCleanUp');
    expect(await fs.readFile(file, 'utf-8')).toBe(before);
  });

  it('accepts a submenu the extension adds itself', async () => {
    vi.mocked(findBaseObjectXml).mockResolvedValue(BASE_MENU);
    const file = await extFile(SUBMENU_EXT, 'ContosoMain.ContosoSubmenus');
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoRentForm', parentMenuElement: 'ContosoCleanUp' }, {});
    expect(r.success).toBe(true);
    expect(r.message).not.toContain('⚠️');
  });

  it('writes with a warning when the base menu cannot be read', async () => {
    const file = await extFile(EMPTY_EXT);
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoRentForm', parentMenuElement: 'Inquiries' }, {});
    expect(r.success).toBe(true);
    expect(r.message).toContain("Base menu 'ContosoMain' could not be read, so submenu 'Inquiries' was NOT checked");
    expect(await fs.readFile(file, 'utf-8')).toContain('<Parent>Inquiries</Parent>');
  });

  it('does not look up the base menu for a top-level item', async () => {
    const file = await extFile(EMPTY_EXT);
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoRentForm' }, {});
    expect(r.message).toContain('on the top level');
    expect(findBaseObjectXml).not.toHaveBeenCalled();
  });

  it('reports a second identical call as a skip and leaves the file as it was', async () => {
    const file = await extFile(EXISTING_EXT);
    const before = await fs.readFile(file, 'utf-8');
    vi.mocked(findBaseObjectXml).mockResolvedValue(null);
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoTaskCleaner', parentMenuElement: 'TaskManagement' }, {});
    expect(r.success).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.message).toContain('skipped (idempotent)');
    expect(r.message).not.toContain('✅');
    expect(await fs.readFile(file, 'utf-8')).toBe(before);
  });

  it('the AxMenu writer escapes the item name too', async () => {
    const file = await extFile(BASE_MENU.replace(/<Elements>[\s\S]*<\/Elements>/, '<Elements />'), 'ContosoMain');
    await directXmlAddMenuItemToMenu(file, 'Contoso&Co', 'display');
    expect(await fs.readFile(file, 'utf-8')).toContain('<MenuItemName>Contoso&amp;Co</MenuItemName>');
  });

  it('gives a specific refusal for a file without <Elements>', async () => {
    const file = await extFile(EMPTY_EXT.replace('\t<Elements />\n', ''));
    const r = await directXmlAddMenuItemToMenuExtension(file, { menuItemToAdd: 'ContosoRentForm' }, {});
    expect(r.success).toBe(false);
    expect(r.message).toContain('has no <Elements> collection');
  });
});
