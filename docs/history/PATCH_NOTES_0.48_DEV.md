# Replay Lab 0.48-dev — Scene Graph Foundation

0.48 introduces a renderer-agnostic 2.5D-ready scene graph without replacing Replay Lab's existing authoring model.

## What changed

- Every project now owns `sceneGraph` settings with a flat/2.5D projection flag, layer effect stacks and stable node overrides.
- Every compiled Performance line derives a `SceneGraphSnapshot` from existing BG / CG / character / Custom Object / system-overlay / dialogue state.
- The default layers are explicit:
  - `world.background`
  - `world.cg`
  - `world.characters`
  - `world.front-fx`
  - `screen.presentation`
  - `screen.dialogue`
  - `screen.fx`
- Scene nodes carry `space`, `depth`, `zBias`, transforms, masks and filter stacks. Filters/masks are authoring-ready metadata in this foundation release; the GPU/filter renderer arrives later.
- Character stage transforms can optionally carry normalized `depth` (`0 = near`, `1 = far`). Missing depth stays absent in legacy authoring and compiles as zero, preserving old project shapes.
- Custom Objects now compile as `ScreenSpace` presentation nodes by default; node overrides can place one in `WorldSpace` later without inventing another object type.
- Canvas rendering now honors the derived Custom Object space: screen presentation objects are drawn after the world camera transform, while old pre-0.48 Performance JSON keeps historical WorldSpace fallback behavior.
- `normalizeReplayProject()` safely upgrades old projects to 0.48 and adds a default flat scene graph.

## Important boundary

0.48 does **not** yet turn on visible 2.5D projection. `projection: "flat"` remains the default and depth does not resize/reposition characters yet. It also does not render scene filters/masks yet. The point of this release is to freeze one scene-graph contract before adding depth motion, lighting, filters, masks and interactive Custom Objects.

## Next dependency order

1. 0.49 — 2.5D Stage: direct depth dragging, depth projection, automatic occlusion and parallax.
2. 0.50 — Lighting / Filter / Mask: object/layer/world/screen effect scopes and animated CG masks.
3. 0.51 — Custom Object interaction: hotspot authoring, inspect/pan-zoom/stateful playback and interaction recording.
4. Later — generalized keyframe/onion-skin editing for existing custom actions and other animatable properties.
