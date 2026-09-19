# Replay Lab 0.44-dev patch notes

## Visual camera framing

- Camera framing is now edited directly on the stage preview rather than through exposed x/y/zoom fields.
- Drag the scene while camera edit mode is active to pan the framing.
- Drag the vertical zoom handle, or use the mouse wheel in camera edit mode, to zoom.
- Camera framing is stored internally as normalized structured data and clamped so the crop cannot reveal empty canvas outside the scene.
- Framing inherits through the current Scene. Scene boundaries reset to the full frame unless new framing is authored.
- `镜头继承` copies the previous effective framing; `镜头全景` explicitly resets the current point to the full frame.
- Existing camera presets such as push/shake/focus-speaker remain separate and compose with authored framing.
- Character/stage editing and camera editing are mutually exclusive interaction modes to avoid ambiguous drags.

## Real paired left/right character art

Character facing policies are now behaviorally distinct:

- `fixed`: keep the source artwork exactly as authored; never mirror automatically.
- `flippable`: permit explicit manual mirroring only.
- `paired`: use independent left-facing and right-facing artwork; no pixel mirroring.

`paired` characters can bind direction-specific base/IDLE art in Studio. The data model also supports direction-specific expression/layer overrides for later editor expansion. If a directional override is missing, rendering safely falls back to the shared character art.

Auto layout continues to decide placement only. It does not silently mirror a character or choose a different paired direction.

## Structured state and persistence

- `ReplayLine.cameraTransform` stores visual camera edits; missing values inherit and `null` is an explicit full-frame reset.
- Compiled lines expose the effective camera transform and whether it is `auto`, `manual`, or `inherited`.
- Reimport preserves authored camera transforms alongside existing stage/director state.
- Paired-facing variants are normalized and copied through compilation without sharing mutable project references.

## Verification

- TypeScript check passes.
- Full test suite: 173/173 passing.
- New regression coverage includes camera inheritance/reset across Scene boundaries, camera crop clamping, paired-art rendering structure, and the direct-manipulation Studio wiring.
