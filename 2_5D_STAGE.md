# Replay Lab 0.49 — Optional 2.5D Stage

Replay Lab remains a 2D sprite/VN tool. The 2.5D mode adds one normalized `depth` dimension to WorldSpace nodes; it does not introduce meshes, 3D cameras, lighting or perspective-correct geometry.

## Authoring

The stage toolbar now has **平面 / 伪3D**. Flat is the default and preserves old projects exactly.

In 2.5D mode each visible character gets a dedicated **↗ near/far handle**. Normal dragging still changes authored x/y placement, ↕ still changes the art-specific scale override, and ↗ changes only depth. This keeps three concepts separate: blocking position, source-art size correction, and scene depth.

Depth is stored internally from 0 (near/front) to 1 (far). Authors do not need to type the number.

## Projection

Depth drives four deterministic effects:

1. Far actors become smaller.
2. Their floor anchors converge toward a visual horizon.
3. Their x positions converge slightly toward the vanishing region.
4. Far actors compensate more of camera panning, producing light parallax.

World actors are painted far-to-near so a nearer sprite naturally occludes a farther sprite. ScreenSpace dialogue, dice, wheel and presentation objects remain outside this projection. WorldSpace Custom Objects use the same projection when explicitly placed in the world layer.

## Motion

The existing custom-motion vocabulary gains `retreat_minor`, `retreat_major`, `retreat_entire`, `approach_minor`, and `approach_major`. These are transient motion offsets for a Beat. Persistent staging still belongs to `StageTransform.depth`: if a character runs away and should stay far away afterwards, save the final depth placement as part of the following stage state.

## Deliberately deferred

0.49 does not execute layer filters, lighting or masks. Those belong to 0.50 on top of the Scene Graph. It also does not add real 3D assets or meshes.
