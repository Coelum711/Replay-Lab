# Replay Lab 0.50 — Lighting, Filters and Masks

0.50 turns the Scene Graph effect metadata from 0.48 into active rendering behavior.

## Effect scopes

- **Node** — one Scene Graph node (for example `cg` or `character:<id>`).
- **Layer** — background, CG, characters, world FX, presentation, dialogue, or screen FX.
- **World** — the whole camera-affected WorldSpace subtree. Dialogue/UI remain untouched.
- **Output** — the final composed frame, including UI.

The Canvas renderer isolates effect scopes on scratch surfaces before compositing them, so a CG mask does not accidentally mask the background and a World filter does not recolor the dialogue box.

## Scene-local state

Project `sceneGraph` remains the default. A Replay line may add `scene.sceneGraph` as a patch. The patch persists for the rest of that Scene, then resets to project defaults at the next Scene boundary.

This makes lighting behave like authored scene state rather than a global preference.

## Environment light

Ambient light has a color, intensity, and target layer list. Studio exposes Background / CG / Character toggles. UI is excluded by default.

The current Canvas implementation is a color-light mix over existing pixels. True local spatial lights with radius/falloff are intentionally deferred to a later WebGL/Pixi renderer rather than approximated with brittle per-sprite hacks.

## Filters

Current filter vocabulary: brightness, contrast, saturation, grayscale, blur, tint, and custom CSS-canvas filters. Studio provides human-readable presets such as Night, Warm, Desaturate, Dream and High Contrast.

## CG masks

Fullscreen CG can use:

- circle mask (spotlight/flashlight style),
- rectangle mask (door/slit/window style),
- alpha image mask,
- invert,
- reveal,
- wipe-left / wipe-right.

Mask parameters stay structured in `CgPresentation.mask`; visible dialogue text is never polluted with mask syntax.
