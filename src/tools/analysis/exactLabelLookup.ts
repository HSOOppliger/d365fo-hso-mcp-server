/**
 * labels(action="search", exact=true) — "which label's text is exactly X?"
 *
 * The full-text search answers a different question: it matches words in the
 * label id, text and comment, ranked by relevance, so a caller that needs the
 * one label whose text IS a given string got dozens of candidates to compare by
 * hand. This answers with the labels whose text is equal after normalisation
 * (NFC, case, surrounding and inner whitespace; see normalizeLabelText), and
 * nothing else — no stemming, no substring, no partial match.
 *
 * Outside the search budget on purpose. The budget (labelSearchHistory) ends a
 * rephrasing loop: guessing wordings against a word index whose answer does not
 * change. An exact lookup is deterministic and bounded — one text, one answer —
 * and a caller that checks one text per label and language before creating it
 * is doing its job, not looping. So this path records nothing in that history,
 * reads nothing from it, and never closes with the "create your own label"
 * advice: whether to create is the caller's decision, made on a definite answer.
 */

import type { XppServerContext } from '../../types/context.js';
import { formatLabelReference } from '../../utils/labelReference.js';
import { normalizeLabelText } from '../../utils/labelText.js';

/** Texts one exact call may check — the same cap as a batched search. */
export const MAX_EXACT_TEXTS = 12;

/** Matches listed per text; the rest are counted. */
export const MAX_EXACT_MATCHES = 20;

/** `exact` as sent by a client — some stringify booleans. */
export function isExactLookup(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

interface WantedText {
  language: string;
  text: string;
}

function error(text: string) {
  return { content: [{ type: 'text', text: `❌ labels(action="search", exact=true): ${text}` }], isError: true };
}

/** `query` (string or string[]) in `language`, plus `texts: [{language, text}]`, in that order. */
function collectTexts(args: Record<string, unknown>): WantedText[] | string {
  const defaultLanguage = typeof args.language === 'string' && args.language.trim() !== ''
    ? args.language.trim()
    : 'en-US';
  const wanted: WantedText[] = [];

  const queries = typeof args.query === 'string' ? [args.query] : Array.isArray(args.query) ? args.query : [];
  for (const q of queries) {
    if (typeof q === 'string' && q.trim() !== '') wanted.push({ language: defaultLanguage, text: q });
  }

  if (args.texts !== undefined) {
    if (!Array.isArray(args.texts)) return 'texts must be an array of {language, text}.';
    for (const [i, entry] of args.texts.entries()) {
      const e = (typeof entry === 'string' ? { text: entry } : entry) as Record<string, unknown> | null;
      if (!e || typeof e.text !== 'string' || e.text.trim() === '') {
        return `texts[${i}] has no text — each entry is {language, text}.`;
      }
      const language = typeof e.language === 'string' && e.language.trim() !== '' ? e.language.trim() : defaultLanguage;
      wanted.push({ language, text: e.text });
    }
  }
  return wanted;
}

function quoted(text: string): string {
  return `"${text.trim()}"`;
}

export async function exactLabelLookupTool(args: Record<string, unknown>, context: XppServerContext) {
  const collected = collectTexts(args);
  if (typeof collected === 'string') return error(collected);

  // The same text and language twice is one lookup.
  const seen = new Set<string>();
  const wanted = collected.filter(w => {
    const key = `${w.language.toLowerCase()}\u0000${normalizeLabelText(w.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (wanted.length === 0) {
    return error('nothing to look up — pass query="<text>" (with language) or texts=[{language, text}, …].');
  }
  if (wanted.length > MAX_EXACT_TEXTS) {
    return error(`${wanted.length} texts; at most ${MAX_EXACT_TEXTS} per call — split them over several calls.`);
  }

  const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : undefined;
  const labelFileId = typeof args.labelFileId === 'string' && args.labelFileId.trim() !== ''
    ? args.labelFileId.trim()
    : undefined;
  const narrowed = [model ? `model ${model}` : '', labelFileId ? `label file ${labelFileId}` : ''].filter(Boolean);

  const blocks: string[] = [];
  let failed = 0;
  for (const w of wanted) {
    let found: ReturnType<XppServerContext['symbolIndex']['findLabelsByExactText']>;
    try {
      found = context.symbolIndex.findLabelsByExactText(w.text, {
        language: w.language, model, labelFileId, maxMatches: MAX_EXACT_MATCHES,
      });
    } catch (err) {
      failed++;
      blocks.push(`❌ lookup failed for ${quoted(w.text)} (${w.language}): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const cutOff = found.truncated
      ? `the candidate set was cut off: only the ${found.candidates} shortest texts ` +
        `(up to ${found.comparedUpToLength} characters) were compared`
      : '';

    if (found.matches.length === 0) {
      blocks.push(
        found.truncated
          ? `no exact match for ${quoted(w.text)} (${w.language}) among the compared candidates — ${cutOff}, ` +
            `so this does NOT show that none exists; pass model or labelFileId to narrow.`
          : `no exact match for ${quoted(w.text)} (${w.language})` +
            (found.languageIndexed ? '' : ` — language ${w.language} is not indexed`),
      );
      continue;
    }

    const lines = [`${quoted(w.text)} (${w.language}) — ${found.matches.length} exact match(es):`];
    for (const m of found.matches.slice(0, MAX_EXACT_MATCHES)) {
      lines.push(`  ${formatLabelReference(m.labelFileId, m.labelId)}  [${m.model}]  ${m.language}: "${m.text}"`);
      for (const t of m.translations ?? []) lines.push(`      ${t.language}: "${t.text}"`);
    }
    const rest = found.matches.length - MAX_EXACT_MATCHES;
    if (rest > 0) lines.push(`  … and ${rest} more exact match(es) — pass model or labelFileId to narrow.`);
    if (found.truncated) lines.push(`  ⚠️ ${cutOff}; a longer text with extra whitespace could match too.`);
    blocks.push(lines.join('\n'));
  }

  const header =
    `Exact label lookup — ${wanted.length} text(s); equal after NFC, case and whitespace normalisation` +
    (narrowed.length > 0 ? `; narrowed to ${narrowed.join(', ')}` : '; every label file and model') + '.';

  return {
    content: [{ type: 'text', text: `${header}\n\n${blocks.join('\n\n')}` }],
    ...(failed === wanted.length ? { isError: true } : {}),
  };
}
