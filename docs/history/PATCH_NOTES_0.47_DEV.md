# Replay Lab 0.47-dev — Onion Skin, Fullscreen CG and Custom Object Foundation

This release begins the backlog recorded in `ROADMAP_FROM_ONION_SKIN.md`. It deliberately implements the shared presentation foundation first; it does not claim the 0.48 interaction recorder or 0.49 generalized motion-keyframe editor are finished.

## Onion skin

- Stage Direct Editor can display previous and next authored-stage states as non-destructive ghosts.
- Previous and next references use separate tint classes, inspired by animation onion-skin workflows.
- Authors can toggle previous/next independently, adjust master opacity, and choose current-character or whole-stage scope.
- Onion ghosts are preview-only and are never persisted into ReplayProject.
- When the selected row is a Director command, current-character scope prefers the active actor in the compiled stage rather than treating the Director pseudo-speaker as a character.

## Fullscreen CG presentation

- CG remains a scene-level visual type, separate from Custom Objects and System Overlays.
- `CgPresentation` stores contain/cover fit, character visibility, textbox visibility, light push/pan presentation and duration.
- Canvas rendering applies this presentation state and preserves the existing `/cg` director-command workflow.

## Custom Objects

- Added content-agnostic `CustomPresentationObject` resources.
- Objects can be created from arbitrary image assets and can contain multiple named visual states.
- Each object carries template/tag metadata, interaction mode, default transform, hotspots and an initial state.
- Templates such as illustration/document/map/phone/title-card only predescribe author intent; they do not create separate engine systems.
- Added structured `/object show <object> [state]`, `/object state <object> <state>` and `/object hide <object>` director commands.
- Runtime/compiler state tracks object visibility and current state independently from characters, fullscreen CG, Dice and Wheel.
- Canvas renderer draws active objects through their own presentation layer.
- Diagnostics track object IDs, state IDs, referenced state assets and initial-state validity.

## Asset/editor integration

- Asset view can create, rename and configure reusable Custom Objects.
- Object states can be added, renamed, bound to image assets and marked as initial.
- Only image-capable assets appear in object-state image pickers.
- Removing a referenced asset clears the object-state asset reference instead of leaving a hidden broken link.

## Explicitly deferred

### 0.48
- Visual hotspot editor.
- Real inspect/open/close/stateful/pan-zoom interactions in the playable runtime.
- Object Interaction Recorder that bakes an interactive manipulation session into linear Director Beats for MP4 replay.

### 0.49
- General motion/keyframe visualization over the existing custom-action system.
- Human-facing easing presets.
- Onion skin driven by actual action keyframes rather than neighboring authored beats.

## Verification

- `npm test`: 192/192 pass.
- `npm run check`: passes.
- `node --check web/studio.js`: passes.
- `node --check web/stage-editor-controller.js`: passes.
