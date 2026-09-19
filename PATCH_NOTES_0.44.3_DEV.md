# Replay Lab 0.44.3-dev — Batch punctuation timing

- Adds batch punctuation-pause authoring without modifying visible dialogue text.
- Batch mode supports: unchanged, reset/default, one uniform pause for all punctuation, or per-category timing.
- Chinese/English punctuation share categories: comma, period, question, exclamation, ellipsis, semicolon, colon.
- Punctuation clusters are collapsed: `?!`, `！！！`, `……`, and repeated `...` pause once instead of accumulating glyph-by-glyph.
- Custom punctuation seconds are exact authored values; legacy projects keep the existing pauseScale behavior.
- Built-in Replay Lab TTS receives the same structured punctuation timing, while imported human audio is not lengthened by duplicate punctuation pauses.
- Batch settings are stored structurally on the line speech config and survive ordinary editing/reimport carry-over when that line is retained.
- 178/178 automated tests pass; TypeScript check passes.

Character action animation (shake/move/collision/jump) is intentionally not bundled into this patch; it should reuse the visual transform/timeline system rather than becoming a separate effect path.
