# Replay Lab 0.49-dev patch notes

- Added optional Flat / 2.5D project projection mode.
- Added a human-facing near/far drag handle to Stage Direct Editor; numeric depth remains internal.
- Added deterministic 2.5D projection helpers and inverse drag compensation.
- Far WorldSpace characters automatically scale down, converge toward the horizon, and render behind nearer characters.
- Added light per-depth camera parallax compensation. Dialogue/UI remain ScreenSpace and unaffected.
- WorldSpace Custom Objects reuse the same projection and depth painter order.
- Existing motion evaluator now supports transient `retreat_*` and `approach_*` depth gestures without changing persistent blocking.
- Flat remains the project default; old authoring without `depth` renders identically.
- Added regression coverage for projection, depth painter order, and depth motion.
