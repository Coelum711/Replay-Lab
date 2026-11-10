# Replay Lab 0.46-dev — Editable Director Beats

## What changed

- Director Beats are now selectable/editable in Studio instead of being display-only grouping rows.
- Beat Inspector supports **同时发生 (parallel)** and **顺序发生 (sequence)** timing. Sequence preserves the historical row-by-row behavior. Parallel makes non-blocking command rows share a cue point; persistent state commands are applied before the following visible line, SFX/BGM use that cue, and camera/custom character motion are materialized on the following visible line. `/wait` remains an explicit blocking timing barrier.
- Drag an existing director command onto a Beat header to join that Beat. Drag command rows elsewhere in the script to split/re-group them. Beats remain derived from contiguous command rows, so there is still only one source of truth.
- Beat Inspector can add expression, existing custom action, SFX, camera, enter and dismiss events, reorder them, edit them or remove them.
- Added `/motion <character> <existing-action> [seconds]`. This **invokes the existing custom/stage action vocabulary** (`stageMethod` / RplGen-compatible names); it does not introduce a second action editor. The action field remains free-form with the existing preset datalist as suggestions.
- Character motion is now per actor in compiled stage state. A motion command can animate Arthur without shaking every other on-screen actor, and the transient motion does not overwrite blocking position/transform.
- Parallel Beat camera/transition commands are applied to the following visible line so zero-UI command rows do not consume frames just to show an effect.
- Beat timing is stored on the source commands (`beatMode`) so drag/reorder remains lossless and Beat grouping can stay derived.

## Compatibility

- Old Beats default to `sequence`, preserving 0.45 playback timing.
- Existing custom action names and ordinary `stageMethod` authoring remain valid.
- Existing `/command` syntax remains valid; `/motion` is additive.
- Normalization preserves Beat timing metadata when reparsing command text.

## Verification

- Project/performance schema: `0.46`.
- TypeScript check passes.
- 188 Node regression tests pass, including new tests for Beat timing and custom-motion cues.
