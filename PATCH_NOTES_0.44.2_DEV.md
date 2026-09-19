# Replay Lab 0.44.2-dev

## Stable three-character sprite sizing

- Normal 1/2/3-character VN shots now share the same per-character width/height budget.
- Adding a third actor no longer shrinks all sprites from 31% to 25% of the viewport width.
- Three-person compositions may overlap slightly, which preserves visual continuity and matches common VN blocking better than sudden global shrinking.
- 4+ actor emergency layouts still reduce the width budget to avoid unusable crowding.
- Added a regression test asserting that two- and three-person shots keep identical size budgets.
