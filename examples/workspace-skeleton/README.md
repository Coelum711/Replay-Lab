# Replay Lab workspace skeleton

A real project directory uses this shape:

- `project.replaylab.json` — project manifest (created by Studio)
- `assets/characters/` — standing art / expression assets
- `assets/backgrounds/` — backgrounds
- `assets/cg/` — CG / overlay images
- `assets/bgm/` — music
- `assets/sfx/` — sound effects
- `assets/voice/imported/` — user-created/imported speech
- `assets/voice/generated/` — Replay Lab generated speech
- `cache/` — rebuildable derived caches
- `exports/` — optional rendered/exported outputs

Generated assets should be referenced by `project://...` URIs in the manifest, not absolute machine paths.
