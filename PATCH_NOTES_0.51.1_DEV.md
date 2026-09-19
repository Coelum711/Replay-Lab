# Replay Lab 0.51.1-dev — Stage Projection Switch UX

- Moved the existing 2D / 2.5D projection selector from the tool row below the preview into the preview stage itself.
- The selector is now pinned to the stage's top-right corner and uses explicit `2D` / `2.5D` labels.
- Projection behavior, project schema, and renderer semantics are unchanged from 0.51.
- This is a UI-only patch; `sceneGraph.projection` remains the single source of truth.
