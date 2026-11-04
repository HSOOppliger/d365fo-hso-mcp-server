/**
 * indexedMenuExtensions — the extensions of a menu the index knows, without a file.
 *
 * On the shared read-only server (no AOT files) these names are all there is to
 * say about a menu's extensions; the menu readers list them there.
 */
import { describe, it, expect } from 'vitest';
import { indexedMenuExtensions } from '../../src/utils/menuFiles.js';

function index(rows: Array<{ name: string; model: string }>, seen: unknown[] = []) {
  return {
    getReadDb: () => ({
      prepare: (sql: string) => ({
        all: (...params: unknown[]) => {
          seen.push(sql, ...params);
          return rows;
        },
      }),
    }),
  };
}

describe('indexedMenuExtensions', () => {
  it('asks for menu-extension rows by prefix and keeps only real <Base>.<suffix> names', () => {
    const seen: unknown[] = [];
    const rows = [
      { name: 'Contoso_Main.Ext', model: 'A' },
      // LIKE reads `_` as a wildcard: this one matches the query but is another menu.
      { name: 'ContosoXMain.Other', model: 'B' },
    ];
    expect(indexedMenuExtensions('Contoso_Main', index(rows, seen))).toEqual([{ name: 'Contoso_Main.Ext', model: 'A' }]);
    expect(String(seen[0])).toContain("type = 'menu-extension'");
    expect(seen[1]).toBe('Contoso_Main.%');
  });

  it('is empty without an index', () => {
    expect(indexedMenuExtensions('ContosoMain', {})).toEqual([]);
  });
});
