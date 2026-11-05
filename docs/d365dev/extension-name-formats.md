# feat(naming): extension name formats — `{0}.CTSO`, `CTSO_{0}Dbt_Extension`

*Upstream pull request [#1185](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1185) for dynamics365ninja/d365fo-mcp-server, filed from branch `feat/extension-name-formats` (commit 5b873dd9 on upstream `main` 5122a30b). On `d365dev` the same change is tag `v1.22.0-d365dev.4`. The text below is the PR description as filed.*

## The convention this is for

Some teams have a naming convention fixed by contract or by a customer's standards, and it fixes the whole name, not just a token:

| Extends | Name |
|---|---|
| any element (table, form, EDT, enum, menu item, security object …) | `InventTable.CTSO` |
| a class (CoC) | `CTSO_SalesFormLetterCls_Extension` |
| a table (CoC) | `CTSO_InventTableDbt_Extension` |
| a form (CoC) | `CTSO_InventTableFrm_Extension` |

`CTSO` stands for the team's token. The class token depends on the **type** of the object extended, because `InventTable` is both a table and a form.

## What 1.22.0 offers for it

- **The styles** (`naming.extensionStyle`, `naming.extensionClassStyle`) put one token at one spot:
  - From a base name, none of them produces `InventTable.CTSO` (unless the model is named `CTSO`) or `CTSO_{0}Dbt_Extension`. There is no separator control and no per-type token.
  - A full element name passed in is kept (`InventTable.CTSO`, a bare token), but `validate_object_naming` warns about it.
  - A full class name is normalised back to the style: `CTSO_InventTableDbt_Extension` → `CTSO_InventTableDbtCtso_Extension` under `prefix`.
- **`prefixSource=as-given` (#1134)** lets the agent write these names, with the convention stated in the instruction file. The server then neither generates nor checks them. `generate_object` scaffolds carry no token, `validate_object_naming` checks the structure only, and a name the agent gets wrong (`CTSO_InventTableCls_Extension` for a table) is written.
- **#1027** asked for a per-type token and was declined for the *default* naming, with good evidence: the shipped metadata does not use it. This PR does not change the defaults or the styles. It adds an opt-in for teams whose convention is not the platform's, so the server can apply and enforce that convention instead of only describing it.

## Why this belongs in the server

- **It finishes what #1134 started.** `as-given` already accepts that some teams have conventions the styles can't express. But it hands the convention to the agent, and the agent can't apply it reliably. Picking `Dbt` or `Frm` depends on the base *type*, and a name like `InventTable` doesn't say which one is meant. The server already knows the type: create parses `[ExtensionOf(tableStr|formStr|classStr(…))]`, and the `generate_object` pattern says it. With a format, the server applies the convention and rejects a wrong name before it is written. Under `as-given`, a wrong name only shows up in code review.
- **Nothing changes unless it is configured.** All five settings are empty by default, and an empty setting gives exactly the 1.22.0 name. A test pins this for each of the five styles and each of four ways of leaving the formats unset. Existing tests are unchanged and pass.
- **The change is small and self-contained.** It adds one env-only module (`src/utils/extensionNameFormat.ts`, no imports) and one resolver that every naming path calls. There is no DB schema, parser or bridge change. The published tool schemas get *smaller* (45,096 → 45,076 chars) even though `validate_object_naming` gains one optional parameter.
- **It doesn't guess.** In a case no format covers, the tool asks for the name (`ask`, the default) instead of making one up. A format that can't produce valid AOT names is rejected on every write, never silently ignored.
- **Same names in every deployment.** The resolver never reads the index. The write-only companion (empty index) and a shared server (full index) therefore produce the same name, which a test checks.
- **Tested on a dev VM.** Table, form and class extensions (of a class, a table and a form) were created under formats, along with the ask-back and `class-format` cases, `validate_object_naming` passes and rejections, and `get_workspace_info`. Every result matched the expected name.

## Change

Five settings in the `naming` section, all empty by default. Empty means every name is generated exactly as before.

| Setting | Example | Names |
|---|---|---|
| `naming.elementNameFormat` / `EXTENSION_ELEMENT_NAME_FORMAT` | `{0}.CTSO` | every element extension |
| `naming.classNameFormat` / `EXTENSION_CLASS_NAME_FORMAT` | `CTSO_{0}Cls` | extension classes of classes; also of tables and forms that have no format of their own |
| `naming.classNameFormatTable` / `EXTENSION_CLASS_NAME_FORMAT_TABLE` | `CTSO_{0}Dbt` | extension classes of tables |
| `naming.classNameFormatForm` / `EXTENSION_CLASS_NAME_FORMAT_FORM` | `CTSO_{0}Frm` | extension classes of forms |
| `naming.undefinedNameFormat` / `EXTENSION_NAME_FORMAT_UNDEFINED` | `ask` (default) \| `class-format` | extension classes no format defines |

`{0}` is the extended object's name. `_Extension` is always appended to a class format (and not doubled if the value already ends in it).

**The base type comes from the call, never from a name.** `CustTable` is a table and a form, so a name alone can't say which format applies. The type is taken from:
- `d365fo_file(action="create")`: the `[ExtensionOf(<kind>Str(…))]` in `sourceCode`, which `parseExtensionOfAttribute` already parsed (`baseKind`) and create threw away; or the new optional `properties.baseObjectType` when there is no source;
- `generate_object(mode="pattern")`: the pattern (`class-extension` → class, `table-extension` → table, `form-handler` → form, `form-datasource-extension` → form data source, …);
- `validate_object_naming`: the new optional `baseObjectType`.

**Cases no format defines** are extension classes of form data sources and controls, views, data entities, maps …, and calls that state no type:
- `ask` (default): the tool does not invent a name. It returns `no naming convention for an extension class of a form-datasource …: ask the user for the name and call again with an explicit name`, saying where the name goes (`objectName` with the `[ExtensionOf]`; `params.className` for `generate_object`). Nothing is written. This works in every client. MCP elicitation exists in the SDK (1.31) but is used nowhere in the server and is not used here.
- `class-format`: the class format names them.
- Either way, an explicit full name (ending in `_Extension`) is kept for these cases.

**Where it applies.** All callers use one resolver, `resolveFormattedExtensionName` in `src/utils/objectNaming.ts`:
- `normalizeObjectName`, used by create, the modify name lookup, delete and `prepare`;
- `codeGen` (generate_object CoC patterns);
- the cross-model refusal's suggested extension name;
- the class-extension XML template, whose `[ExtensionOf]` now follows the format's type (`tableStr`/`formStr`).

**Validation** (`checkObjectNaming`, used by `validate_object_naming` and `prepare`):
- where a format is defined, the name must be exactly the format's (only the base part compares case-insensitively);
- for a case no format defines, any name the compiler accepts passes: an identifier ending in `_Extension`, at most 81 characters, not in `XPP_KEYWORDS`;
- with no type stated, a name some format produces passes, and any other gets a warning that names `baseObjectType`.

**Reverse parsing.** `extensionClassBaseOf` and `inferExtendedBase` read a formatted name back by its format. Where formats overlap (`CTSO_{0}` and `CTSO_{0}Frm` both spell `CTSO_CustTableFrm`), the more specific format wins and the name reads as the form `CustTable`. An `[ExtensionOf]` in the source settles it the other way. Under formats, `inferExtendedBase` doesn't consult the index, so the companion (empty index) and the shared server (full index) read the same base.

**Other parts:**
- **Prefix inference** skips names a format produced, so `{0}.ConExtension` cannot teach the prefix `Con`. Regular objects still teach theirs.
- **`as-given`** keeps its meaning (nothing is renamed). With a format set, create refuses a name the format would change and names the one it expects.
- **A broken format** is refused on every write, never silently ignored: no `{0}`, characters other than letters, digits and `_`, or an element format without `{0}.<Token>`. `get_workspace_info` lists it.
- **Reporting:** `get_workspace_info` lists the active formats with samples per base type. The `generate_object` naming line names the format that applied, and the prompt's CoC rule says the format names the class.

**Unchanged:** the defaults, the styles and `prefixSource`, new-object, field and method prefixing, `d365fo_file(action="generate")` (names as given, as before), and the DB schema, parser and C# bridge.

## Hybrid deployment

Both instances name extensions: the companion writes (`d365fo_file`), and the shared server names in `generate_object` and checks in `validate_object_naming` / `prepare`. Give both the same values. Several conventions on one machine: one companion entry per customer, each with its own environment (documented in `MCP_CONFIG.md`). No format is passed per call.

## Tests

- `tests/utils/extensionNameFormat.test.ts` (80):
  - **unchanged with no format:** five styles (prefix, model-name, prefix-leading class, `none`, `as-given`) × formats absent, empty, blank, or only `UNDEFINED` set, all with the 1.22.0 names;
  - **generation:** every element type; class, table and form, plus the fallback to the class format; idempotence; a stated type re-names a name of the wrong format;
  - **both `UNDEFINED` modes:** for form data source, form control, view, data entity, map and no type; the ask-back text; the explicit name on the second call; broken formats;
  - **reverse parsing:** including both ambiguous cases;
  - **inference** with and without the filter; **`as-given`** interplay.
- `tests/tools/extensionNameFormatTools.test.ts` (23):
  - `validate_object_naming`: accept and reject per type, exact vs case, undefined cases, compiler rejections, no type, no format;
  - `generate_object`: per pattern, the ask-back, `className`, `class-format`;
  - `get_workspace_info`: formats, samples, a broken format, no format;
  - `prepare` predictions; the cross-model suggestion.
- `tests/tools/createExtensionNameFormat.test.ts` (18):
  - create with `[ExtensionOf(tableStr|formStr|classStr)]` and with `properties.baseObjectType`, each run against an empty write-only index and a populated server index, with identical names;
  - the template's intrinsic; the ask-back with no write; the explicit second call; `class-format`; element extensions; `as-given`.
- `tests/utils/toolSchemaBudget.test.ts`: `validate_object_naming` publishes `baseObjectType` and pays for it in its own schema. Payload 45,096 → 45,076 chars.
- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run`: green (526 test files passed, 2 skipped; 7,615 tests passed, 30 skipped).
- On a D365FO dev VM (sandbox model, formats `{0}.CTSO`, `CTSO_{0}Cls`, `CTSO_{0}Dbt`, `CTSO_{0}Frm`), all expected names: `d365fo_file` create of a table extension and a form extension (`InventTable.CTSO`), class extensions of a class, a table and a form (`CTSO_SalesFormLetterCls_Extension`, `CTSO_InventTableDbt_Extension`, `CTSO_InventTableFrm_Extension`); a form data source extension class with `ask` (refused with the ask-back, created on the second call with an explicit name) and with `class-format` (`CTSO_InventTableCls_Extension`); `validate_object_naming` accept and reject; `get_workspace_info`.

## Checklist

- [x] Default behaviour unchanged (tested per style); existing tests unchanged and green.
- [x] Settings registered in `src/config/settings.ts`; `docs/CONFIGURATION.md` regenerated.
- [x] CHANGELOG `[Unreleased]`, `docs/CUSTOM_EXTENSIONS.md` (§ Extension name formats), `docs/ARCHITECTURE.md`, `docs/MCP_CONFIG.md`, `docs/MCP_TOOLS.md`, op-specs (`class-extension` create properties, generate_object `className`).
- [x] No DB schema, parser or bridge change.
- [x] Manual test on a D365FO dev VM.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
