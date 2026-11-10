# Replay Lab 0.43-dev — Visual Stage Editor

## Human-first stage blocking

- The stage preview is now the primary editor for freeform character placement.
- Drag an on-stage actor directly to move it horizontally or vertically.
- Drag the `↕` handle to resize the actor.
- Five vertical composition guides plus eye/floor guides provide light snapping.
- Exact `x / y / scale` values are stored in the project model but are not exposed as the primary authoring UI.
- A manual transform becomes the authored state for that line and carries through the current Scene until changed or reset.
- Compiled actors report placement provenance as `auto`, `manual`, or `inherited`.

## Composition workflow

The stage bar now includes:

- Copy composition
- Paste composition
- Inherit previous placement
- Restore automatic layout

An explicit transform reset is stored as `null`, which prevents an earlier Scene transform from leaking forward when the author chooses “restore automatic”.

## Director Command bridge

`/move <Character>` is a readable zero-dialogue Director event. Precise placement data remains structured in `line.stageTransforms`; the script does not require authors to type coordinates.

## Safe character facing

Every character now has an explicit facing policy:

- `fixed` — default; the supplied artwork is never mirrored.
- `flippable` — manual mirroring is allowed only after the author also declares whether the source art faces left or right.
- `paired` — reserved semantic policy for asymmetric left/right source art; it never mirrors the image. Per-facing asset binding is not yet implemented in 0.43.

Automatic layout only chooses placement. It never infers that a sprite may be mirrored from whether the character stands on the left or right side of the screen.

## Compatibility and engineering

- Project/performance schema version: `0.43`.
- Older projects normalize to the new facing and transform defaults.
- Character merge and source-aware reimport preserve/remap stage transforms and facing configuration.
- Direct-manipulation transforms are rendered by the same Canvas renderer used for playtest/export.
- Existing slot-based left/center/right staging remains available as a semantic shortcut.

## Verification

- `npm test`: 170/170 passing.
- `npm run check`: passing.
- `node --check web/studio.js`: passing.
- `node --check web/stage-editor-controller.js`: passing.
