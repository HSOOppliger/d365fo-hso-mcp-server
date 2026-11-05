# feat(labels): exact label lookup — `labels(action="search", exact=true)`

*Upstream pull request [#1186](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1186) for dynamics365ninja/d365fo-mcp-server, filed from branch `feat/label-exact-lookup` (one commit, 676b76fa on upstream `main` 5122a30b). On `d365dev` the same change is two tags: `v1.22.0-d365dev.5` (the lookup) and `v1.22.0-d365dev.6` (fixed custom-first order, distribution line, `maxMatches`). The text below is the PR description as filed; the test counts are for the PR branch.*

## The question this answers

"Which label's text is **exactly** `Posting`?" A caller asks it before creating a label, to reuse one instead of adding a duplicate. An instruction file or skill that creates labels asks it once per label and language.

## What 1.22.0 offers for it

- **`action="search"` answers a different question.** It is a full-text word match on label id, text and developer comment, ranked by relevance. Quotes are stripped, so there is no phrase search either. `query="Posting"` returns every label that contains the word: `Posting`, `Posting date`, `Posting profile`, labels whose comment mentions posting … The caller has to compare dozens of candidates itself, and an LLM caller does that unreliably (case, extra spaces, umlauts).
- **The search budget stops a legitimate workflow.** From the third `search` call in a session, every answer opens with `🛑 STOP — that was label search call 3 … Do not search again … create your own label`. That budget is right for what it was built for: an agent guessing wordings against a word index whose answer doesn't change (19 calls in one benchmark run). It's wrong for a caller that checks one known text per label: the third label of an object gets "do not search again" and the advice to create the label without looking.
- **`createIfMissing`** reuses by label **id**, not by text, so it doesn't answer "is there already a label that says this?".
- **`findLabelByExactText`** (the raw-text resolver in `createLabel.ts`, behind `d365fo_file`) compares text, but internally: en-US only, inside one model, on the top 200 FTS-ranked rows, with trim + lowercase only. It isn't reachable as a lookup and this PR doesn't change it.

## Why this belongs in the server

- **The server has the index; the caller has only the search.** A client can't do an exact lookup with the tools it has: word search plus client-side comparison is the slow, lossy route described above, and every call counts toward the budget.
- **It is deterministic, so the budget exemption is safe.** The budget ends a *rephrasing loop*: an exact lookup has nothing to rephrase. Equal or not equal, one text gives one answer, and asking again gives the same one. It is also bounded: at most 12 texts per call, at most 20 listed matches per text by default (50 at most), and the candidate set is capped and reported when it is cut. So it is not counted, reads no search history, and never carries the STOP notice or the "create your own label" advice (whether to create is the caller's decision on a definite answer). Normal searches keep their budget exactly as before, and exact calls don't change the count they see.
- **Nothing changes unless it is asked for.** `exact` is a hidden knob like the other `labels` write plumbing: accepted flat or in `params`, documented in the op-spec, not in the published schema (the payload is unchanged). Without it, `search` and every other action behave exactly as before. A test pins normal-search output byte-for-byte across exact calls, and a run of seven normal searches gave identical output before and after the change.
- **Small and self-contained.** One index method, one handler, one normaliser, one branch in `labels`. No DB schema, parser or bridge change, and no new setting.

## Change

### Call

```text
labels(action="search", exact=true, query="Posting")                       # en-US
labels(action="search", exact=true, query=["Posting", "Posting date"], language="en-US")
labels(action="search", params={exact:true, texts:[{language:"en-US", text:"Posting"},
                                                   {language:"de",    text:"Buchungen"}]})
labels(action="search", exact=true, query="Buchungen", language="de", maxMatches=5)
```

- `exact: true` (a stringified `"true"` is accepted too) on `action="search"`.
- Texts: `query` (string or string[]) in `language` (default en-US), and/or `texts: [{language, text}, …]`; at most 12 per call, more is an error. Each entry is looked up on its own; the same text and language twice is one lookup. The `text` / `searchText` / `q` synonyms of `query` work as for a normal search.
- Scope: every label file and model in that language. `model` / `labelFileId` narrow it (the header says so).
- `maxMatches`: integer 1..50, default 20, the number of matches **listed** per text. Each listed match carries its translations, so a caller that only needs to know whether its own copy exists can ask for a few. Out of range (`0`, `51`, `2.5`, `"five"`) is an error, not clamped. Like `exact`, it is accepted flat or in `params` and is not in the published schema.

### Match

Equal after normalising both sides: Unicode NFC, trim, inner whitespace runs collapsed to one space, lower-cased with JS `toLowerCase` (Unicode default case mapping, locale-independent). Nothing else: no stemming, no substring, no diacritic folding (`Prüfung` ≠ `Prufung`), no punctuation stripping.

Not SQLite `LOWER()`: it folds ASCII only (`LOWER('PRÜFUNG')` = `prÜfung`), and `LIKE` is ASCII-case-insensitive only (`'Prüfung' LIKE 'PRÜFUNG'` = 0).

### Candidates

- **FTS path.** Each whitespace-separated chunk of the text that has a letter or digit becomes a quoted phrase on the `text` column (`text : "posting" AND text : "date"`), so FTS operators (`NOT`, `OR`) and punctuation are plain input, never syntax. `unicode61` folds case and diacritics, so the candidates are a superset of the exact matches, including stored decomposed umlauts. The equality is decided in JS.
- **Scan path.** A text without letters or digits (`-`, `%`, `_`) gives FTS nothing to match. It scans the language through `idx_labels_language_lower`, pre-filtered with `text NOT GLOB '*[A-Za-z0-9]*'`; an equal text can't contain one.
- **Cap.** Candidates are compared shortest first, at most 50,000. If the set was cut off, the answer says so and names the length reached. It never reports "no exact match" as if that were proof. For scale on a synthetic 400k-row language: 80k FTS candidates took about 160 ms, and a scan of the whole language about 700 ms.

### Order

One text can have many exact matches. On a real index, the German `Buchungen` is 45 different labels in the standard models (SYS 27, RET 17, GLS 1). A team's own copy must not be lost behind them: a caller that sees only standard labels creates a duplicate. So the listed order is fixed:

1. **custom models first**: `isCustomModel` (`CUSTOM_MODELS` patterns, `EXTENSION_PREFIX`, `D365FO_MODEL_NAME`, models auto-detected from the workspace), the same classification the rest of the server uses;
2. then by **label file id**, then **label id**, then model, each case-insensitive, with the stored spelling as the tie-break.

The cut (`maxMatches`) comes after sorting, so a custom copy is listed before any standard one. With no custom model configured, every model counts as standard and the order is simply label file id, then label id. The order doesn't depend on the process locale (code-unit comparison, not `localeCompare`), and two calls on the same index answer byte-for-byte the same. Sorting costs nothing measurable: 500 matches classify and sort in about 0.2 ms, and a whole 500-copy lookup with 2,000 more candidates takes about 6 ms.

Translations are fetched only for the listed matches.

### Result

One block per text. Here with `CUSTOM_MODELS=ContosoExt` and `maxMatches=3`:

```text
Exact label lookup — 1 text(s); equal after NFC, case and whitespace normalisation; every label file and model; listed custom models first, then by label file id and label id.

"Buchungen" (de) — 46 exact match(es):
  46 exact matches: ContosoExt (custom): ContosoExt 1; ApplicationPlatform: SYS 27, RET 17, GLS 1
  @ContosoExt:Postings  [ContosoExt]  de: "Buchungen"
      en-US: "Postings"
  @GLS2001  [ApplicationPlatform]  de: "Buchungen"
      en-US: "Postings"
  @RET2000  [ApplicationPlatform]  de: "Buchungen"
  … and 43 more exact match(es) — pass model or labelFileId to narrow.
```

And several texts with the default of 20:

```text
Exact label lookup — 4 text(s); equal after NFC, case and whitespace normalisation; every label file and model; listed custom models first, then by label file id and label id.

"POSTING" (en-US) — 2 exact match(es):
  2 exact matches: ApplicationPlatform: SYS 1; ContosoExt: ContosoExt 1
  @SYS1001  [ApplicationPlatform]  en-US: "Posting"
      de: "Buchung"
  @ContosoExt:Posting  [ContosoExt]  en-US: "Posting"
      de: "Buchungen"

"Buchungen" (de) — 1 exact match(es):
  @ContosoExt:Posting  [ContosoExt]  de: "Buchungen"
      en-US: "Posting"

no exact match for "Postings" (en-US)

no exact match for "Posting" (ja) — language ja is not indexed
```

- Each match: the reference (`formatLabelReference`, so legacy ids stay `@SYS1001`), the model, the language and the stored text. After it, that label's other indexed languages (same label id, label file and model), one line each.
- **Distribution line**, whenever a text has more than one match: `N exact matches: <model>: <file> n, <file> n; <model>: …`, covering *all* matches, not only the listed ones. Custom models come first, marked `(custom)`; the other models follow by number of matches, and inside a model the label files by number of matches. The line names at most 8 model/label-file groups, then `and N more groups`.
- `maxMatches` matches per text (default 20), then `… and N more exact match(es)`. The count in the block header and in the distribution line is always the full number.
- A cut-off candidate set adds a ⚠️ line, or replaces the "no exact match" line with one that says it isn't proof.

## Tests

- `tests/tools/labelExactLookup.test.ts` (36), on a real in-memory index through the `labels` tool:
  - **Matching:** exact hit with translations; the same text in a standard and a custom label file; case and surrounding whitespace; inner whitespace collapsed on both sides; non-ASCII case and a stored decomposed `ü`; a substring, a longer and a shorter text don't match.
  - **Call shapes:** several languages in one call (`params.texts`); text only in another language → no match; language not indexed; punctuation-only text and FTS operator words (`NOT POSTED`); the `text` synonym and `exact: "true"`; more than 12 texts and an empty call rejected; 20-match cap with the rest counted.
  - **Truncation:** a cut-off candidate set from the index (shortest first), and its rendering, which never reads as plain "no exact match".
  - **Budget:** ten exact calls, then a normal search: no STOP notice, and the call count is 1. Control: the third normal search still gets its STOP, with an exact call in between not counted. An exact miss carries no "create your own" advice and leaves no history behind for a later fruitless search. Normal-search output is byte-identical with and without exact calls before it.
  - **Order and listing** (the 46-copy shape: SYS 27, RET 17, GLS 1 in one standard model, plus one copy in another model):
    - no custom model configured: label file id, then label id, with the exact distribution line;
    - a custom copy whose model sorts *last* is listed first under `CUSTOM_MODELS`, and under `EXTENSION_PREFIX`. Control: without the setting it is cut off;
    - two calls answer identically;
    - no distribution line for a single match; the line stops after 8 groups;
    - `maxMatches` 5 (flat, and as a string in `params`) lists 5 and counts 41 more; 50 lists all 46; `0`, `51`, `2.5`, `"five"` and `-1` are errors.
  - **Contract:** `exact` / `texts` / `maxMatches` stay out of the published schema; the op-spec carries the contract (including the order rule) and resolves for `topic="labels.exact"`.
- Normal-search output was compared byte-for-byte between upstream `main` and this branch: seven calls (single, batch, no hit, other language, punctuation, `exact:false`, verbose), including the calls that carry the STOP notice. Identical.
- `tests/utils/toolSchemaBudget.test.ts` and `tests/tools/schemaHeadroom.test.ts` are unchanged and green.
- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run`: green on this branch (522 test files passed, 2 skipped; 7,498 tests passed, 30 skipped).
- On a D365FO dev VM (shared server on `v1.22.0-d365dev.6`, the same change): a text with more than 20 exact matches across standard label files (distribution line, documented order), the same with `maxMatches` 5, a text in a custom and a standard model (custom listed first), case and extra spaces, a substring (no match), two languages in one call, a language that is not indexed, a single match (no distribution line), and ten exact calls followed by a normal search (no STOP notice). All as expected. Also in use through a client skill that checks each label text per language before creating it.

## Checklist

- [x] Default behaviour unchanged (normal search byte-identical; other actions untouched); existing tests unchanged and green.
- [x] No new setting; no DB schema, parser or bridge change.
- [x] CHANGELOG `[Unreleased]`, `docs/MCP_TOOLS.md` (`labels` row), op-spec (`exact`, `texts`, `maxMatches`, `topic="labels.exact"`).
- [x] Manual test on a D365FO dev VM.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
