# fix(get_object_info): answer include:"xml" on a binary ISV object instead of a retry loop

*Upstream pull request [#1273](https://github.com/dynamics365ninja/d365fo-mcp-server/pull/1273) for dynamics365ninja/d365fo-mcp-server, filed 2026-11-15 from branch `fix/xml-not-found-binary-isv` (commit `4f9545d0` on upstream `main` `2308d282`, v1.24.0). Not on `d365dev`: it comes in from upstream once merged. The text below is the PR description as prepared; its test counts are for the PR branch.*

## Problem

On a host with a binary ISV model imported with `npm run extract-binary-models` (no bridge),
`get_object_info` on one of its classes works and shows "🔒 Binary ISV, signatures only".
The same call with `include:"xml"` sends the caller in a circle:

1. `readObjectXml` finds no file (the model is compiled only; its index rows carry a
   `binary-isv://<Model>/AxClass/<Name>` marker, not a path), and `objectXmlNotFound` answers
   *"The index has it in "ContosoCore" — retry with options.modelName="ContosoCore""*.
2. The retry with `modelName:"ContosoCore"` misses again. `elsewhere` now holds only the
   model that was passed, the filter `elsewhere.filter(m => m !== modelName)` leaves nothing,
   and the answer is *"No model in the symbol index holds a class of that name … or the object
   does not exist yet"*. That is false: the object exists and was just described.

The same happens for a table or any other type of a binary model. The second half (the false
"no model holds it" after following the hint) also happens for an ordinary object whose index
row outlived its file, or on a host that has only the database.

## Fix

- `readObjectXml`: when there is no file and no stored copy, look for index rows of this
  type and name whose `file_path` starts with `binary-isv://` (restricted to
  `options.modelName`, case-insensitively, when given). If there are any, answer:
  *"class "ContosoRentEquipmentJob" is in the binary ISV model "ContosoCore" (compiled only,
  signatures only): no XML or X++ source exists. get_object_info without include:"xml" gives
  its signatures."* plus the `binary-isv://` path. Still `isError`, with no retry hint.
- `objectXmlNotFound`: when the index lists the object only in the model that was passed,
  the answer now says so: the file is not on disk, so the row is stale or the host has only
  the database, and another `modelName` will not help. The old "No model in the symbol index
  holds …" text stays for the case where no model has the object at all.
- `findD365FileViaIndex` skips `binary-isv://` rows instead of joining the marker onto every
  packages root and probing paths that cannot exist.
- New helpers in `objectFileLookup.ts`: `isBinaryIsvPath` and `binaryIsvObjectRows`.

Objects that do have a file (or a stored copy) are read exactly as before. The fix is in the
reader's message paths only; the index and the import are unchanged.

## Tests

New `tests/tools/objectXmlBinaryIsv.test.ts`, on a real in-memory `XppSymbolIndex` with
synthetic Contoso rows:

- binary class and binary table: the binary answer without `modelName`, with it, and with it
  in lower case; no "retry with", no "No model in the symbol index"
- a binary object asked for under another model: still points at the binary model, whose
  retry then gets the binary answer
- stale row in the model asked for (via `readObjectXml` and `objectXmlNotFound(…, [modelName])`):
  the stale-row text, not "no model holds it"
- `elsewhere = []` and an object nobody holds: today's text, unchanged
- an object with a real file: rendered as before, with and without `modelName`

Against the unfixed source, four of these fail (the binary class and table cases and both
stale-row cases); with the fix all pass. The existing `objectXmlAndTiming`, `formStoredCopy`
and `objectSource` tests pass unchanged.

`npm run build`, `typecheck`, `lint` and `test:run` are green, except
`tests/packaging/publishedFiles.test.ts`, which is unrelated to this change: on npm 12
`npm pack --dry-run --json` prints an object keyed by package name instead of an array, and
the test reads `report[0].files`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
