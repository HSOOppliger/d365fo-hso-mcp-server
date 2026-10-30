# feat(knowledge): reserved-words topic; KW001 checks every name of a declaration list

*Upstream pull request [#1183](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1183) for dynamics365ninja/d365fo-mcp-server, filed from branch `feat/reserved-word-check` (commit fe1a917b on upstream `main` 5122a30b). On `d365dev` the same change is tag `v1.22.0-d365dev.1`. The text below is the PR description as filed.*

Builds on 754eb415 (KW001 on any declared type and on parameters, in 1.22.0) and leaves its approach as it is: same regexes, same `asc`/`desc` exemption, same reserved-type rule.

## Why

**No way to look the set up.** `get_knowledge(topic="reserved keywords")` answers with the `switch` topic. The compiler's set is already captured (`XPP_KEYWORDS`, 115 words), but nothing teaches it, and the Microsoft language reference lists a different set: it still has `pause`, `window` and `tableLock`, and it omits `async`, `await`, `const`, `finally`, `foreach`, `generateonly`, `having`, `hint`, `namespace`, `readonly`, `unchecked`, `using`, `var`, `firstonly1`, `client`, `server`, `index` and `internal`.

**Two positions KW001 still misses.** A probe class compiled with xppc rejects both, and `validate_code` on `main` passes both:

| Probe | xppc | `validate_code` on `main` |
|---|---|---|
| `int a, count;` | "'identifier' expected" | passes (only the first name is checked) |
| `void foo(str 20 select)` | "invalid name for a parameter …" | passes (`paramRe` has no length) |

A reserved word as a `for`, `using` or `catch` variable is already caught, but the fix message calls it a parameter.

## Change

- **`reserved-words` knowledge topic** (`xppKnowledge.ts`), found by `reserved keywords`, `reserved words`, `keywords`. The catalog rule is built from `XPP_KEYWORDS` when the module loads, the same way as the intrinsic catalog, and grouped by kind: types, control flow, declarations, expressions, database, aggregates, select options, transactions. A word missing from the group map lands under "other", so a recapture can't drop a word. The topic also covers:
  - the positions xppc rejects;
  - the `in` exemption and the `@` escape;
  - that method names are legal (`count()` compiles);
  - that `boolean` is not reserved;
  - where the reference and the compiler disagree.

  It agrees with `switch-loops` (removed keywords) and `xpp-declarations`.
- **KW001, declaration lists:** after a `declRe` match that ends in `,` or `=`, the rest of the statement (up to `;`; a brace before it means it is not one) is split at top-level commas. Each later bare name, or `name = …`, is checked. Commas inside `()` and `[]` belong to an initializer.
- **KW001, sized-string parameters:** `paramRe` accepts `str <n>` like `declRe` already does.
- **KW001, wording:** a match right after `for (` says "loop variable"; one after `using (` or `catch (` says "variable".
- **No new word list.** `scripts/capture-compiler-facts.ts` stays the source; KW001 and the topic both follow a recapture.

## Tests

- `tests/knowledge/compilerFacts.test.ts`:
  - declaration lists are flagged: `int a, count;`, a list with a `max(b, c)` initializer, `str 20 x, index;`, a reserved third name;
  - lists stay silent on a reserved word inside an initializer or a container literal, on `@count` and on `in`;
  - the sized-string parameter is flagged, and a legal one is not;
  - the fix names the position (parameter, loop variable, `using`/`catch` variable, list name);
  - still silent on `boolean boolean;`, `@index` (variable and parameter), `in` as a parameter and a method named `count()`;
  - a parenthesised select with several `desc` keys is not flagged.
- `tests/knowledge/reservedWords.test.ts` (new):
  - the topic lists exactly `XPP_KEYWORDS` minus the exempted words (set equality and count);
  - no word falls into "other" today;
  - the exemption, escape and reference notes are there;
  - the topic is the first answer to `reserved keywords`, `reserved words`, `keywords` and `reserved-words`.
- `tests/fixtures/oracles/AxClass/FixtureReservedWordShapes.xml` (new): the select-expression shape from `SalesLine`/`SalesTable.lastPackingSlip` and the probe-legal names. `npm run oracle:sweep -- --dry` shows no KW001. Its one error, TST002 on `FixtureAttributeStacking.xml`, is already on `main`.
- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run`: green (522 test files passed, 2 skipped; 7474 tests passed, 30 skipped).
- **Full sweep over the shipped sources** (`npm run oracle:sweep` on a D365FO VM, this branch on `main` 5122a30b): 111,452 files, 648 MB of X++, 1,837 s. **No error-severity finding from any rule** (the bar is zero), so the declaration-list and sized-string additions raise nothing on code that compiles. KW001 has no warning severity, so the warning counts are not affected by this change.

## Checklist

- [x] Same `XPP_KEYWORDS` set and masking; no hand-written keyword list.
- [x] `in`, `@name`, `boolean boolean;` and method names stay unflagged.
- [x] CHANGELOG `[Unreleased]`, `docs/ARCHITECTURE.md`, `docs/MCP_TOOLS.md`.
- [x] No settings, DB schema, parser or bridge change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
