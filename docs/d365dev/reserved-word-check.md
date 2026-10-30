# validate_code KW001: check every declaration position; add a `reserved-words` knowledge topic

*Upstream pull request description for dynamics365ninja/d365fo-mcp-server. Fork commit on `d365dev`
(tag `v1.21.0-d365dev.1`); the PR branch is `pr/reserved-word-check`, cherry-picked onto upstream `main`.*

## Problem

The reserved-word set is already captured from the compiler (`XPP_KEYWORDS` in
`src/knowledge/compilerFacts.generated.ts`, 115 words, `in` exempted), and rule KW001 uses it.
But KW001 was one regular expression that only matched a line shaped like
`<primitive type> <name> [;,=]`. A probe class showed the compiler rejecting all of these, and
`validate_code` passed every one:

| Probe | xppc | `validate_code` before |
|---|---|---|
| `void foo(int index) {}` | "'index' is an invalid name for a parameter because it is an X++ keyword" | passes |
| `for (int count = 0; …)` | "Invalid token 'count'" | passes |
| `CustTable group;` | "'group' is an invalid name for a variable …" | passes |
| `Query order;` | "'order' is an invalid name for a variable …" | passes |
| `var index = 1;` | "Invalid token 'index'" | passes |
| `int a, count;` | "'identifier' expected" | passes |

The same probe confirmed what must stay silent: `boolean boolean;`, `int @index;`, `int in;`
and a method named `count()` all compile.

Most of those messages do not name the word, so a generated-code check is where this is cheapest
to catch.

Separately, `get_knowledge(topic="reserved keywords")` answered with the `switch` topic, and the
Microsoft language reference lists a different set from the compiler (it still has `pause`,
`window` and `tableLock`, and it omits `async`, `await`, `const`, `finally`, `foreach`,
`generateonly`, `having`, `hint`, `namespace`, `readonly`, `unchecked`, `using`, `var`,
`firstonly1`, `client`, `server`, `index` and `internal`).

## Change

**KW001** (`checkReservedIdentifiers`, `src/tools/analysis/validateXpp.ts`) still uses the same set
through `isReservedKeyword()` and the shared masked source, and is still regex-based (no AST):

- **Statements and member declarations:** the masked source is split at `;`, `{` and `}`. A piece
  that is entirely `[modifiers] Type [length] [<generic>] name [array] [= … | , …]` is a
  declaration. The type may be any identifier or dotted name (class, table, enum, EDT, .NET type).
  Every later name of the list is checked too.
- **Parenthesised lists:** one stack pass pairs `(` and `)`. A `for (` header has its init part
  checked as a declaration; any other group without `;` `{` `}` inside has each top-level comma
  segment checked as `Type name [= default]` (a parameter; for `using (` / `catch (` a variable).
  A group that starts with `select` is a select expression, not a parameter list, and is skipped.
- **Not a declaration:** a type token that is itself reserved, unless it is a type word (`str`,
  `int`, `int64`, `real`, `date`, `utcdatetime`, `guid`, `container`, `anytype`, `var`). So
  `return x;` and `else x = 1;` are statements. A name followed by `(` never matches, so method
  names are not checked. `@name` and `in` stay legal.
- The fix message names the position (variable, parameter, loop variable).

**New knowledge topic `reserved-words`** (`src/tools/knowledge/xppKnowledge.ts`), found by
`reserved keywords`, `reserved words`, `keywords`. Its catalog rule is built from `XPP_KEYWORDS` when
the module loads, like the intrinsic catalog, and grouped by kind (types, control flow,
declarations, expressions, database, aggregates, select options, transactions). A word the group
map does not know appears under "other", so a recapture cannot drop a word. The topic states the
`in` exemption, the `@` escape, the positions the compiler rejects, that `boolean` is not reserved,
and where the reference and the compiler differ. Consistent with `switch-loops` (removed keywords)
and `xpp-declarations`.

**No new word list.** After a compiler update, `scripts/capture-compiler-facts.ts` recaptures the set
and both KW001 and the topic follow.

**Found by the widened rule:** the `args-object` topic's example declared `MyOrderTable order;`,
which does not compile (the probe's `Query order;` shape). The variable is renamed `orderTable`.

## Tests

- `tests/knowledge/compilerFacts.test.ts`: per position, a reserved word is flagged and a legal name
  is not (class/table/EDT types, `var`, declaration lists, parameters, `for`, `using`, `catch`); the
  fix names the position; silent on `boolean boolean;`, `@index` (variable and parameter), `in`
  (parameter and loop variable), a method named `count()`, `next count();`; silent on `return x;`,
  `else x = 1;`, `order by … desc` (one line and split over lines), a parenthesised select with
  several `desc` keys, `group by`, a container literal and a container unpack; every reserved type
  word is in `XPP_KEYWORDS`.
- `tests/knowledge/reservedWords.test.ts` (new): the topic lists exactly `XPP_KEYWORDS` minus the
  exempted words (set equality and count), no word falls into "other" today, the exemption/escape/
  reference notes are present, and the topic is the first answer to `reserved keywords`,
  `reserved words`, `keywords` and `reserved-words`.
- `npx vitest run tests/knowledge tests/tools/xpp-knowledge.test.ts`: the three knowledge gates pass.
- `npm run oracle:sweep -- --dry`: no KW001 finding. (The one error it reports, TST002 on
  `FixtureAttributeStacking.xml`, is the same at `v1.21.0` without this change.)
- **Sweep over the shipped standard sources** (`npm run oracle:sweep` on a D365FO VM: 111,452 files,
  648 MB of X++, 1,987 s). Standard code compiles, so every KW001 hit is a false positive; zero is
  the bar. The first run found **2**, both the same shape in `SalesLine` and
  `SalesTable.lastPackingSlip`: a select used as an expression,
  `(select … order by DeliveryDate desc, CreatedDateTime desc, PackingSlipId desc where …)`, whose
  middle sort key the parameter pass read as `Type name`. A parenthesised group that starts with
  `select` is now skipped (a parameter list never does). That guard can only remove findings, so
  the other 111,450 files stay clean. Re-running the rules on the two files gives 0 KW001 and no
  error of any rule. The shape is now a unit test and an oracle fixture
  (`tests/fixtures/oracles/AxClass/FixtureReservedWordShapes.xml`, which also carries the
  probe-confirmed legal names); `--dry` flags it without the guard and is clean with it.
  No other rule raised an error in that sweep.

## Checklist

- [x] Same `XPP_KEYWORDS` set, same masking; no hand-written keyword list.
- [x] `in`, `@name`, `boolean boolean;` and method names stay unflagged.
- [x] CHANGELOG `[Unreleased]`, `docs/ARCHITECTURE.md`, `docs/MCP_TOOLS.md`.
- [x] No settings, no DB schema or parser change, no bridge change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
