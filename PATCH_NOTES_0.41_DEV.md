# Replay Lab 0.41-dev — VN Auto Director

This build continues from the 0.40-dev fixed package and focuses on automatic character blocking for visual-novel-style TRPG Replay.

## Automatic staging

- Added `settings.autoStageMode`:
  - `vn-continuity` (new default): actors stay on stage inside the current Scene and keep stable spatial relationships.
  - `recent`: preserves the 0.40 most-recent-speaker roster behavior for compatibility.
- Added a deterministic 1/2/3-person blocking solver using left / center / right slots.
- Alternating A/B dialogue no longer makes the roster reorder every line.
- Standard two-person blocking prefers left + right.
- A third newly joining actor prefers center while the established pair keeps its sides when possible.
- Structured Chapter / Scene boundaries reset the automatic conversation cluster using Replay Lab's actual boundary-marker semantics.
- Narration/system lines do not clear the automatic stage.
- `ReplayCharacter.defaultPosition` is treated as a persistent placement preference; per-line `stagePositions` remains a stronger override.
- A manually arranged custom-stage line can seed the following automatic composition without weakening manual precedence.
- Explicit Scene enter/exit staging remains supported and continues to override automatic roster selection.

## Speaker focus

- Added `settings.speakerFocus`: `none`, `subtle`, `strong`.
- Default Visual Novel focus is now deliberately subtle: inactive actors remain visually present instead of being dimmed almost to disappearance.
- The existing `focus-speaker` camera effect still provides a stronger deliberate close-focus treatment.
- VNVE export uses the same focus-strength semantics.

## Studio controls

`角色上镜` now exposes an Auto Director block with:

- VN 连续构图 / 最近说话人 compatibility mode
- max foreground actors: 1 / 2 / 3
- speaker focus: none / subtle / strong

Manual per-line staging and direct drag editing remain available and take priority.

## Compatibility and verification

- Old projects are normalized with the new defaults; no manual project migration is required.
- 0.40 recent-speaker behavior remains selectable.
- 20,000-line single-speaker compilation remains linear (about 0.12 s in the development container).
- Full automated suite: 156 / 156 passing at packaging time.
