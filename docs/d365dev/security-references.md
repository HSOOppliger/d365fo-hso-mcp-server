# feat(security): add and remove duty and privilege references on roles, duties and their extensions

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this was `116d11ef` (tag `v1.23.0-d365dev.3`); since `v1.23.0-d365dev.4` it comes from upstream `main`. PR branch `feat/security-references` = the same commit on `main` (`v1.23.0`, `2bc52137`) as `5bff6489`, without this file. The PR body is everything from "The gap" down. Merged as #1207 on 2026-11-10. It uses nothing from #1203 or the menu reader. The test counts below are for the PR branch.*

## The gap

`create` writes `duties[]` and `privileges[]` for `security-role`, `security-duty` and both extension types. After that, nothing can change the lists:

- on a role or duty, `modify` offers only `modify-property`, and that in effect only reaches `Label`: the bridge's `SetProperty` has no security case, and the XML fallback only replaces an element that appears once;
- `security-role-extension` and `security-duty-extension` are not in the object types `modify` accepts;
- the only way is `create(overwrite=true)` with the complete list, or hand-written XML.

## Change

Four operations, each named after what it references, as `add-entry-point` is. Several references go in the existing `operations[]`; there are no list parameters.

| operation | param | objectTypes | list |
|---|---|---|---|
| `add-duty` / `remove-duty` | `dutyName` | `security-role`, `security-role-extension` | `<Duties>` / `<AxSecurityDutyReference>` |
| `add-privilege` / `remove-privilege` | `privilegeName` | those and `security-duty`, `security-duty-extension` | `<Privileges>` / `<AxSecurityPrivilegeReference>` |

**Add** appends to the list and expands a self-closing `<Duties />`. Names compare case-insensitively; a reference already there is reported as `SKIPPED, nothing was written`. A value that is not one AOT name (`A,B`, a stray tag) is refused, with a pointer to `operations[]`.

**Remove** collapses an emptied list back to `<Duties />` / `<Privileges />`, so add then remove returns the file byte for byte. A name that is not there comes back with the list that is, and on an extension the reply adds that an extension lists only what it adds. A name listed twice is refused.

**Checks against the symbol index**, on add only, so a dangling reference can always be removed:
- a name that exists only as the other kind is refused, with the operation to use (a name that is both is fine: a duty and a privilege may share one);
- an unknown name is warned about and written, as `add-module-reference` does, since it may come later in the batch or not be indexed yet;
- an index with no objects of that kind at all (a write-only companion) gets "could not verify", not "unknown".

**On an extension**, a reference the base role or duty already holds is warned about and written. The base is read with `findBaseObjectXml`; when it cannot be read there is no warning.

**A wrong objectType** is refused before the file is looked up, with what that object holds instead. `canBridgeModify` cannot answer this: it admits every listed operation on every ordinary bridge type, and for `security-privilege` it says "not supported by the bridge".

The transform is in `tools/xml/securityDutyRoleXml.ts`, next to the builders, and walks tokens (`xmlScan.ts`), so a commented-out reference is not read as real and a list is not confused with another collection of the same child element. The writers are in `directXmlWriters.ts`; the checks are in a new `write/securityReferences.ts`. No bridge call.

**Three things the operations needed that were not in the list of files to touch:**
- `AOT_FOLDER_BY_OBJECT_TYPE` (`objectFileLookup.ts`) had no entry for the two extension types, so `modify` could not find an existing extension by name.
- `missingExtensionVerdict` looked for the base through `resolveD365FileByName`, which reads security types in the configured model only. For a missing extension of a standard role the answer was "File not found" with lookup options, not "create it and apply the same edit in ONE call". It now also asks `findBaseObjectXml`, for security types only, so the other extension types behave as before.
- The refusal to modify a standard object named table, class and form extensions only. It now names the two security extension types, since that is where an agent trying `add-duty` on a standard role has to go.

`remove-duty` and `remove-privilege` are on `REMOVING_OPERATIONS` (`preserveMetadataElements.ts`). That set exempts an operation from the guard that restores a dropped top-level property. These two only touch elements below that level, so it changes nothing today; they are listed because the set says what an operation is for.

`create` and `prepare` need no change. `action="undo"` needs none either: the writers go through the same backup path as every modify. On a git-tracked file undo restores it (tested on a real repository). Outside git undo cannot revert any modify, and the `.backup-*` copy is the way back, as for `add-entry-point`.

## Shape of the XML

The Microsoft files were **not** read for this change: no `PackagesLocalDirectory` was available where it was built. What was read instead is the shape of 172 roles, duties and extensions that Visual Studio serialized, from model source trees (element names and counts only):

- all 877 references hold `<Name>` and nothing else, with no attributes, and every name is a plain identifier;
- `Name, Description?, Label, DirectAccessPermissions, Duties, Privileges, SubRoles` on a role; `Name, DirectAccessPermissions, Duties, Privileges, PropertyModifications` on a role extension; `Name, Description?, Label?, Privileges` on a duty; `Name, Privileges, PropertyModifications` on a duty extension;
- the containers are always there, an empty one is `<Duties />`, no list repeats a name, no file has a comment or a BOM, all are CRLF.

There are only 2 role extensions in that sample, and every duty in it has privileges, so an empty duty was not seen there. An empty role, duty and extension of each type, created in Visual Studio on the dev VM, filled that gap: an empty duty is `<Privileges />` too. A file with no container is refused (`no-collection`), as `add-entry-point` does, rather than given an element at a guessed position. A look at `AxSecurityRole`/`AxSecurityDuty` from ApplicationSuite, `SystemUser.ApplicationCommon.xml` and `BatchJobMaintain.ApplicationCommon.xml` would still be welcome.

## Schema budget

Measured on `main`: 45,093 before, 45,085 after; `d365fo_file` 5,737 → 5,729. The four enum values cost 60 characters and are paid for in `properties`, whose description listed example properties that the op-spec it points to returns, and said "creation" under a `[create]` tag (68 characters). The ceiling stays at 45,100.

**Whichever of this PR and the menu reader merges second has to re-measure the payload and rewrite its note in `toolSchemaBudget.test.ts`.** The note on this branch states the figure for `main`; with the reader's saving under it, `d365dev` measures 45,033.

`modifyD365File.ts` is capped at 4,800 lines by `layering.test.ts` and was at 4,798. The cap is raised to 4,820 for 19 lines, with a note; the logic went elsewhere, and what landed is two schema parameters, the import, the objectType refusal, one switch arm for all four operations, the base lookup and a line in the standard-model refusal.

## Out of scope / follow-ups

- Sub-roles (`<SubRoles>` / `AxSecurityRoleReference`) and sub-duties: the same pattern.
- `modify-property` cannot insert a missing `<Description>` on security objects.
- On a write-only companion a standard base role is not found (its index is empty and `findBaseObjectXml` looks in the configured model), so there is no base warning, and a missing extension gets "File not found" rather than the one-call reply. `create` with `operations[]` works there. #1203's all-packages scan could close this once it is merged.

## Tests

- `tests/tools/securityDutyRoleXml.test.ts` (new): add and remove on every root (add then remove round-trips byte for byte), self-closing and paired empty lists, duplicates in any casing, the middle and the last entry, a name not there, a name twice, comments, a list next to another collection of the same child, invalid names; the writers on a real file (CRLF, no BOM, a skip leaves the bytes alone) and `undo` of an add and a remove on a real git repository.
- `tests/tools/securityReferenceOps.test.ts` (new): through `modifyD365FileTool`: the gate for each operation and objectType, all four roots, an extension found by name, the skip, both kind refusals, a name that is both kinds, the unknown-name warning, the index that holds nothing, a list of names, the missing-parameter spec, the base warning on both extension types, every wrong objectType including a table, a `filePath` pointing at another kind of object, and a missing extension with and without a base.
- `d365foFileOpSpecs.test.ts`: the operation count, 42 → 46.

**Run through `d365foFileTool` on a real file system** (outside the suite, on Linux): `operations[]` with three adds, then a duplicate, a remove and an unknown name in one batch, the kind refusal, the not-found list, and the base warning on a role extension; element order and CRLF as expected. `create` itself could not be run there, since it needs Windows paths, so `create` with `operations[]` and the automatic create of a missing extension have not been run to the end.

**Tested on a dev VM** (MCP server in full mode, agent prompts): add and remove on a role, a duty and both extension types, created empty in Visual Studio; add then remove leaves each file byte-identical to what Visual Studio wrote, and Visual Studio's empty duty is `<Privileges />`. `create` with references in one call, the automatic create of a missing role and duty extension, the base warning, removing a base reference through an extension, the kind and objectType refusals, an unknown name, `undo`, a name listed twice and a paired empty list all behaved as described. The agent caught most of the wrong requests before calling the tool; sent anyway, the server refused them. The project built with the new references in place.

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (539 test files passed, 2 skipped; 7916 tests passed, 30 skipped).

## Checklist

- [x] No C# bridge change.
- [x] CHANGELOG `[Unreleased]` → Added.
- [x] Tool schema payload lower than before; ceiling unchanged.
- [x] No settings, DB schema or parser change.
- [x] Shape checked against files Visual Studio serialized (172 roles, duties and extensions, 877 references; empty objects created on the VM). Not compared with the shipped Microsoft files.
- [x] Tested on a dev VM.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
