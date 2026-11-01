/**
 * labels(action="search", exact=true) — exact label text lookup.
 *
 * The full-text search matches words and, from the third call of a session, opens
 * every answer with a STOP notice. A caller that checks one text per label and
 * language before creating it (to avoid duplicates) needs neither: it needs the
 * labels whose text IS the given text, and it is not in a rephrasing loop. These
 * tests pin the equality rules, the result shape, and that the exact path stays
 * entirely outside the search budget while normal searches keep theirs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { XppSymbolIndex } from '../../src/metadata/symbolIndex';
import { labelsTool } from '../../src/tools/labels';
import { labelSearchCallCount, resetLabelSearchHistory } from '../../src/tools/analysis/labelSearchHistory';
import { normalizeLabelText } from '../../src/utils/labelText';
import { lookupOpSpec } from '../../src/tools/specs/opSpecs';
import { toolSchemas } from '../../src/server/toolSchemas/index';
import type { XppServerContext } from '../../src/types/context';

let index: XppSymbolIndex;
let context: XppServerContext;

const row = (labelFileId: string, model: string, labelId: string, language: string, text: string) => ({
  labelId, labelFileId, model, language, text,
  filePath: `K:/pkg/${model}/${labelFileId}.${language}.label.txt`,
});

beforeEach(() => {
  resetLabelSearchHistory();
  index = new XppSymbolIndex(':memory:', ':memory:');
  index.bulkAddLabels([
    // The same text in a standard and a custom label file, with translations.
    row('SYS', 'ApplicationPlatform', 'SYS1001', 'en-US', 'Posting'),
    row('SYS', 'ApplicationPlatform', 'SYS1001', 'de', 'Buchung'),
    row('SYS', 'ApplicationPlatform', 'SYS1001', 'fr', 'Validation'),
    row('ContosoExt', 'ContosoExt', 'Posting', 'en-US', 'Posting'),
    row('ContosoExt', 'ContosoExt', 'Posting', 'de', 'Buchungen'),
    // Longer texts and a shorter one that share words with "Posting".
    row('SYS', 'ApplicationPlatform', 'SYS1002', 'en-US', 'Posting date'),
    row('SYS', 'ApplicationPlatform', 'SYS1003', 'en-US', 'Post'),
    row('SYS', 'ApplicationPlatform', 'SYS1004', 'en-US', '  Customer   account  '),
    // Non-ASCII case, and a decomposed ü (u + U+0308) in the stored text.
    row('SYS', 'ApplicationPlatform', 'SYS1005', 'de', 'PRÜFUNG'),
    row('SYS', 'ApplicationPlatform', 'SYS1006', 'de', 'Pru\u0308fung abgeschlossen'),
    // Only in German.
    row('SYS', 'ApplicationPlatform', 'SYS1007', 'de', 'Nur auf Deutsch'),
    // Punctuation only, and FTS5 operator words.
    row('SYS', 'ApplicationPlatform', 'SYS1008', 'en-US', '-'),
    row('SYS', 'ApplicationPlatform', 'SYS1009', 'en-US', 'Not posted'),
  ]);
  context = { symbolIndex: index } as unknown as XppServerContext;
});

afterEach(() => index.close());

async function call(args: Record<string, unknown>) {
  const result = await labelsTool({ method: 'tools/call', params: { name: 'labels', arguments: args } } as any, context);
  return { result, text: (result.content as any[]).map(c => c.text).join('\n') as string };
}

const exact = (args: Record<string, unknown>) => call({ action: 'search', exact: true, ...args });

describe('normalizeLabelText', () => {
  it('folds NFC, case (incl. umlauts) and whitespace — nothing else', () => {
    expect(normalizeLabelText('  PRU\u0308FUNG \t  abgeschlossen ')).toBe('prüfung abgeschlossen');
    expect(normalizeLabelText('Prüfung')).not.toBe(normalizeLabelText('Prufung'));
    expect(normalizeLabelText('Posting.')).not.toBe(normalizeLabelText('Posting'));
  });
});

describe('labels(action="search", exact=true)', () => {
  it('returns the exact hit with its other indexed translations', async () => {
    const { text, result } = await exact({ query: 'Posting', model: 'ApplicationPlatform' });
    expect(result.isError).toBeUndefined();
    expect(text).toContain('"Posting" (en-US) — 1 exact match(es):');
    expect(text).toContain('  @SYS1001  [ApplicationPlatform]  en-US: "Posting"');
    expect(text).toContain('      de: "Buchung"');
    expect(text).toContain('      fr: "Validation"');
    expect(text).toContain('narrowed to model ApplicationPlatform');
  });

  it('returns the same text from every label file and model', async () => {
    const { text } = await exact({ query: 'Posting' });
    expect(text).toContain('2 exact match(es)');
    expect(text).toContain('@SYS1001  [ApplicationPlatform]  en-US: "Posting"');
    expect(text).toContain('@ContosoExt:Posting  [ContosoExt]  en-US: "Posting"');
    expect(text).toContain('      de: "Buchungen"');
    expect(text).toContain('every label file and model');
  });

  it('ignores case and surrounding whitespace', async () => {
    const { text } = await exact({ query: '   pOSTING   ' });
    expect(text).toContain('2 exact match(es)');
  });

  it('collapses inner whitespace on both sides', async () => {
    const { text } = await exact({ query: 'customer account' });
    expect(text).toContain('@SYS1004  [ApplicationPlatform]  en-US: "  Customer   account  "');
  });

  it('compares non-ASCII case and decomposed umlauts', async () => {
    const { text } = await exact({ texts: [
      { language: 'de', text: 'prüfung' },
      { language: 'de', text: 'PRÜFUNG ABGESCHLOSSEN' },
    ] });
    expect(text).toContain('@SYS1005  [ApplicationPlatform]  de: "PRÜFUNG"');
    expect(text).toContain('@SYS1006');
    expect(text).not.toContain('no exact match');
  });

  it('does not match a substring, a longer text or a shorter one', async () => {
    const { text } = await exact({ query: ['Posting date', 'Post', 'Postin', 'Posting date extra'] });
    expect(text).toContain('@SYS1002  [ApplicationPlatform]  en-US: "Posting date"');
    expect(text).toContain('@SYS1003  [ApplicationPlatform]  en-US: "Post"');
    expect(text).toContain('no exact match for "Postin" (en-US)');
    expect(text).toContain('no exact match for "Posting date extra" (en-US)');
    // "Post" must not list "Posting", nor "Posting date" list "Posting".
    expect(text.match(/en-US: "Posting"/g)).toBeNull();
  });

  it('looks up several languages in one call, each on its own', async () => {
    const { text } = await call({ action: 'search', params: { exact: true, texts: [
      { language: 'en-US', text: 'Posting' },
      { language: 'de', text: 'Buchungen' },
    ] } });
    expect(text).toContain('2 text(s)');
    expect(text).toContain('"Posting" (en-US) — 2 exact match(es):');
    expect(text).toContain('"Buchungen" (de) — 1 exact match(es):');
    expect(text).toContain('  @ContosoExt:Posting  [ContosoExt]  de: "Buchungen"');
    expect(text).toContain('      en-US: "Posting"');
  });

  it('reports no match when the text exists only in another language', async () => {
    const { text } = await exact({ query: 'Nur auf Deutsch' });
    expect(text).toContain('no exact match for "Nur auf Deutsch" (en-US)');
    expect(text).not.toContain('not indexed');
    const de = await exact({ query: 'Nur auf Deutsch', language: 'de' });
    expect(de.text).toContain('@SYS1007');
  });

  it('says when the language is not indexed at all', async () => {
    const { text } = await exact({ query: 'Posting', language: 'ja' });
    expect(text).toContain('no exact match for "Posting" (ja) — language ja is not indexed');
  });

  it('handles punctuation-only text and FTS5 operator words', async () => {
    const { text } = await exact({ query: [' - ', 'NOT POSTED', '%'] });
    expect(text).toContain('@SYS1008  [ApplicationPlatform]  en-US: "-"');
    expect(text).toContain('@SYS1009  [ApplicationPlatform]  en-US: "Not posted"');
    expect(text).toContain('no exact match for "%" (en-US)');
  });

  it('accepts the flat `text` synonym and a stringified exact', async () => {
    const { text } = await call({ action: 'search', exact: 'true', text: 'Posting' });
    expect(text).toContain('2 exact match(es)');
  });

  it('rejects more than 12 texts and an empty call', async () => {
    const many = await exact({ query: Array.from({ length: 13 }, (_, i) => `Text ${i}`) });
    expect(many.result.isError).toBe(true);
    expect(many.text).toContain('at most 12');
    const none = await exact({});
    expect(none.result.isError).toBe(true);
  });

  it('lists at most 20 matches per text and counts the rest', async () => {
    index.bulkAddLabels(Array.from({ length: 23 }, (_, i) =>
      row(`File${i}`, `Model${i}`, 'Dup', 'en-US', 'Duplicated text')));
    const { text } = await exact({ query: 'Duplicated text' });
    expect(text).toContain('23 exact match(es)');
    expect(text).toContain('… and 3 more exact match(es)');
    expect(text.match(/en-US: "Duplicated text"/g)).toHaveLength(20);
  });
});

describe('a cut-off candidate set', () => {
  it('is reported by the index, shortest candidates compared first', () => {
    const found = index.findLabelsByExactText('Posting', { candidateCap: 2 });
    expect(found.truncated).toBe(true);
    expect(found.candidates).toBe(2);
    expect(found.matches.map(m => m.labelId).sort()).toEqual(['Posting', 'SYS1001']);
    expect(index.findLabelsByExactText('Posting').truncated).toBe(false);
  });

  it('is never reported as "no exact match" without the warning', async () => {
    const stub = {
      symbolIndex: {
        findLabelsByExactText: () => ({
          matches: [], candidates: 50000, truncated: true, comparedUpToLength: 41, languageIndexed: true,
        }),
      },
    } as unknown as XppServerContext;
    const result = await labelsTool(
      { method: 'tools/call', params: { name: 'labels', arguments: { action: 'search', exact: true, query: 'Posting' } } } as any,
      stub,
    );
    const text = (result.content as any[])[0].text as string;
    expect(text).toContain('the candidate set was cut off');
    expect(text).toContain('does NOT show that none exists');
    expect(text).toContain('up to 41 characters');
  });
});

describe('exact lookups stay outside the search budget', () => {
  const normal = (query: string) => call({ action: 'search', query });

  it('ten exact calls, then a normal search: no STOP notice, call count unchanged', async () => {
    for (let i = 0; i < 10; i++) {
      const { text } = await exact({ query: i % 2 === 0 ? 'Posting' : 'Nothing like this' });
      expect(text).not.toContain('STOP');
    }
    expect(labelSearchCallCount()).toBe(0);

    const { text } = await normal('Posting');
    expect(text).not.toContain('STOP');
    expect(labelSearchCallCount()).toBe(1);
  });

  it('the budget still stops normal searches (control)', async () => {
    await normal('Posting');
    await normal('Post');
    await exact({ query: 'Posting' });
    expect(labelSearchCallCount()).toBe(2);
    const third = await normal('Posting date');
    expect(third.text).toContain('STOP — that was label search call 3');
  });

  it('a no-match exact answer carries no "create your own" advice and leaves no history', async () => {
    const miss = await exact({ query: 'Zebra crossing' });
    expect(miss.text).toContain('no exact match for "Zebra crossing" (en-US)');
    expect(miss.text).not.toMatch(/create your own/i);
    expect(miss.text).not.toContain('labels(action="create"');

    // A later fruitless normal search must not count the exact miss as a prior attempt.
    const later = await normal('Giraffe');
    expect(later.text).not.toContain('Zebra');
    expect(later.text).not.toContain('This is not new information');
  });

  it('a normal search answers byte-identically with and without exact calls before it', async () => {
    const fresh = (await normal('Posting')).text;
    resetLabelSearchHistory();
    for (let i = 0; i < 5; i++) await exact({ query: 'Posting' });
    expect((await normal('Posting')).text).toBe(fresh);
  });
});

describe('contract', () => {
  it('keeps exact and texts out of the published schema', () => {
    const props = (toolSchemas.find(t => t.name === 'labels')!.inputSchema as any).properties;
    expect(props.exact).toBeUndefined();
    expect(props.texts).toBeUndefined();
  });

  it('documents the exact lookup in the labels op-spec', () => {
    const spec = lookupOpSpec('labels');
    expect(spec).toContain('exact=true');
    expect(spec).toContain('texts');
    expect(spec).toContain('no exact match for "<text>" (<language>)');
    expect(spec).toContain('Not counted toward the search-call budget');
    expect(lookupOpSpec('labels.exact')).toBe(spec);
  });
});
