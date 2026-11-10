# Replay Lab 0.50-dev patch notes

- Activated Scene Graph effect stacks in Canvas preview, VN playtest and video rendering.
- Added Scene-local ambient/environment light with Background / CG / Character targeting.
- Added WorldSpace-only and final-output effect scopes.
- Added per-layer effect presets while preserving node effect overrides in the data contract.
- Added CG circle, rectangle and alpha-image masks with reveal/directional wipe animation.
- Scene-local lighting/effects persist inside a Scene and reset at the next Scene boundary.
- Kept dialogue/UI in ScreenSpace so World filters do not recolor it unless an Output filter is explicitly chosen.
- Uses isolated scratch canvases for mask/effect composition rather than applying filters destructively to the main canvas.
- Local spatial point lights are explicitly deferred to the later WebGL/Pixi path.
