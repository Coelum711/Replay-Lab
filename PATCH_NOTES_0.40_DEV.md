# Replay Lab 0.40-dev repair notes

This package contains a focused stability/performance pass over the supplied 0.40-dev build.

## Fixed

- `compilePerformance()` no longer scans backwards through the script for every line. Automatic stage rosters are precomputed in one forward pass and character/assets use indexed maps.
  - Synthetic 20,000-line single-speaker benchmark in the repair environment: ~4.82 s before, ~0.11 s after.
- Project Undo history no longer retains both a structured-cloned project and a full JSON string for every step.
  - Snapshots are retained once as serialized data and materialized only on Undo/Redo.
  - History now has an approximate 96 MiB retained-snapshot budget while always keeping at least one useful Undo step.
- Studio manifest autosave no longer recursively lists the whole workspace after every save.
  - Workspace asset statistics are refreshed only on explicit workspace/asset operations.
- Script reimport with “preserve setup” now keeps stable line ids and non-default local performance authoring for unchanged lines, even when unrelated Log lines were inserted/deleted.
  - Preserves authored expression, duration, speech settings, voice/SFX, mouth cues, bubble, staging, stage method, scene/camera/BGM work, dialogue style and metadata.
  - Changed source lines are treated conservatively as new.
  - If the count of identical duplicate lines changes, Replay Lab refuses ambiguous performance carry-over rather than attaching it to an arbitrary duplicate.
- Fast MP4 export no longer decodes the entire soundtrack up front.
  - Audio is decoded incrementally by export chunk.
  - Decoded export audio uses an approximate 96 MiB LRU budget, with currently active audio protected from eviction.

## Verification

- TypeScript build succeeds.
- Full test suite: 151/151 passing.
- Added regression coverage for automatic roster ordering, history byte-budget trimming, safe line-level reimport, duplicate-line ambiguity, cheap autosave, and incremental MP4 audio decoding.

## Deliberately not included in this repair pass

- ASR / speaker diarization workflow for voice-session recordings.
- Stable importer-native message IDs/source references for edited source lines.
- Full command/patch-based Undo architecture.

Those are larger feature/schema changes rather than safe 0.40-dev repairs.
