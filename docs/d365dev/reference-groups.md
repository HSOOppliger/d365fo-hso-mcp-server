# feat(form): add-control writes reference groups, and picks one for a surrogate foreign key

*Upstream pull request text for dynamics365ninja/d365fo-mcp-server. On `d365dev` this is the commit after `c5bd5ca0`; no tag yet. PR branch `feat/reference-groups` = the same commit on `main` (`06f363ad`), without this file; not yet filed. The PR body is everything from "The gap" down.*

## The gap

`add-control` cannot write a reference group, and says it did.

- On a form extension, `controlType="ReferenceGroup"` is not in the XML writer's control map (`CONTROL_TYPE_TO_FORM_CONTROL`), and an unknown type falls back to `AxFormStringControl`. On a dev VM the call reported ✅ and wrote this into a form extension:

  ```xml
  <AxFormControl xmlns="" i:type="AxFormStringControl">
      <Name>…</Name>
      <Type>String</Type>
      <FormControlExtension i:nil="true" />
      <DataSource>SalesTable</DataSource>
  </AxFormControl>
  ```

  The agent then removed it, would not hand-edit the XML, and sent the user to the form designer.
- On a plain form the bridge builds `AxForm{controlType}Control` by reflection, so it can create the control, but it sets `DataField`, which a reference group does not have (`unsupportedProperties`), and nothing sets its `ReferenceField`.
- Without a `controlType`, the type comes from the EDT's base type. `SalesTable.WorkerSalesTaker` (EDT `SalesTaker` → `HcmWorkerRecId` → `RefRecId`, relation `WorkerSalesTaker_FK` to `HcmWorker.RecId`) becomes an Int64 control showing a RecId. Dragging the same field onto a form in Visual Studio adds a reference group, which shows the worker by `HcmWorker`'s replacement key.

## Change

**Writing a reference group.** `ReferenceGroup` maps to `AxFormReferenceGroupControl`. `controlDataField` becomes its `<ReferenceField>`, and it gets an empty `<Controls />`, in the element order of the census (`formControlElementOrder.generated.ts`): `Name, Type, FormControlExtension, Controls, DataSource, ReferenceField`. That is the shape Visual Studio saves: in 46 designer-saved reference groups `<Controls />` is always empty (the lookup fields are generated at run time), and none carries a `DataField`; in 200 shipped ApplicationSuite forms, 598 of 615 are bound by `ReferenceField`. Both form-extension shapes (envelope under a base-form parent, nested under a parent the extension defines) get it, through `innerControlLines`.

On a plain form the bridge creates the control as before, without the `DataField`, and `ReferenceField` is written into the saved file with the same writer `modify-property` uses on a control (`directXmlModifyControlProperty`). If that step fails, the control is reported as added, with a warning naming the `modify-property` call that binds it. `ReplacementFieldGroup` is not a parameter: it is set on the control with `modify-property`, as for any other property.

**Choosing a reference group.** Without a `controlType`, `add-control` now writes a reference group when the field is a surrogate foreign key whose related table has a replacement key:

1. the field is an `AxTableFieldInt64` (in the table or one of its extensions);
2. its EDT chain reaches `RefRecId`;
3. it is related to `RecId` of another table: a table relation (also one in a table extension), or else the first `ReferenceTable` on the EDT chain;
4. that table has a `ReplacementKey`.

The reply says what was found and how to get a plain control (`controlType="Int64"`). A surrogate foreign key whose related table has no replacement key stays an Int64 control, and the reply says `controlType="ReferenceGroup"` gives a reference group anyway. An explicit `controlType` always wins and is not checked.

Why that rule: the designer's rule is not documented. Microsoft Learn ("Data entity wizard rules") defines a surrogate foreign key as one whose EDT is RefRecId or derives from it, and its display value as the replacement key, then primary key, alternate key, AutoIdentification group. In 228 shipped ApplicationSuite forms (every 25th), fields bound by a reference group or an Int64 control:

| Field | Reference group | Int64 control |
|---|---|---|
| Int64, EDT derives from RefRecId, relation on RecId, related table **has** a replacement key | 114 | 1 |
| Same, related table has **no** replacement key | 13 | 3 |
| Int64 without a RecId relation on the table | 2 (EDT `ReferenceTable`) | 3 |

The first row is the rule. The second is left to the caller: most shipped forms use a reference group there too, but not all.

The data source's table comes from the form (for an extension, from the base form and the data sources the extension adds), else the data source's name. Tables, EDTs and the related table are read with `findBaseObjectXml`; table extensions come from the index, else the package folders (`findAotFilesInAllPackages`). The replacement key is not in the index, so the related table's XML is read. A failed lookup leaves the old choice in place.

**An unknown type is refused.** On a form extension, a `controlType` the caller named that the writer cannot produce (`SegmentedEntry`, `Grid`, …) is refused with the supported list, and nothing is written. A type picked from the field's EDT still falls back to String, as before. The plain-form path is unchanged: the bridge already throws on an unknown type.

The logic is in `write/referenceGroupControl.ts` (I/O) and `xml/surrogateForeignKey.ts` (pure); `modifyD365File.ts` gets 8 lines shorter (the bridge call moved into `bridgeAddFormControl`). No C# bridge change. The `controlType` descriptions (the zod parameter and the op-spec) and the `add-control` op-spec note name the new type and the rule; they are not in the published schema, so the payload is unchanged (45,020).

## Out of scope / follow-ups

- A write-only companion without an index finds a standard table only in the configured model (`findBaseObjectXml` scans every package for menus only), so there a standard table's field gets the old choice.
- `generate_object` form scaffolds and `create` do not use the rule.

## Tests

- `tests/tools/surrogateForeignKey.test.ts` (new): a field's type and EDT in any casing, the RecId relation (a natural-key relation is not one), an EDT's links, a table's replacement key, a form's data source tables.
- `tests/utils/formExtensionControlXml.test.ts`: a reference group in both extension shapes, in the census order with no element-order violation, and the note when it is bound to no field.
- `tests/tools/referenceGroupControl.test.ts` (new), through `modifyD365FileTool`: on a form extension, a surrogate foreign key becomes a reference group, found in the table, in a table extension, and through the EDT's `ReferenceTable`; no replacement key gives Int64 with the note; an Int64 EDT that does not derive from RefRecId is left alone; an explicit `Int64` and an explicit `ReferenceGroup` win; an unknown type is refused and the file is unchanged. On a plain form: the bridge gets `ReferenceGroup` without the `DataField` and `ReferenceField` is written after it; a binding that cannot be written is a warning on a success; other types keep their `DataField`.

Without the writer changes, 8 of these fail.

**Not tested on a dev VM yet.**

## Checks

- `npm ci && npm run build && npm run typecheck && npm run lint && npm run test:run` on this branch: green (567 test files passed, 2 skipped; 8433 tests passed, 32 skipped); payload 45,072, as on `main`.

## Checklist

- [x] No C# bridge change.
- [x] CHANGELOG `[Unreleased]` → Added and Fixed.
- [x] Tool schema payload unchanged.
- [x] No settings, DB schema or parser change.
- [ ] Tested on a dev VM.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
