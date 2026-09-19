# Replay Lab 0.42-dev — Director Commands

This release adds a scriptable Director Command layer directly inside the Replay Log timeline.

## What changed

- Added draggable command rows that live alongside dialogue/narration lines.
- Added slash-command syntax with quoted names/asset names:
  - `/expression <character> <expression>`
  - `/enter <character> [auto|left|center|right]`
  - `/dismiss <character>`
  - `/scene <title>`
  - `/chapter <title>`
  - `/bg <asset|none>`
  - `/cg <asset|none>`
  - `/bgm <asset|stop>`
  - `/sfx <asset>`
  - `/camera none|push|shake|focus-speaker`
  - `/transition cut|fade`
  - `/wait <seconds>`
- Added quick-insert buttons in the left timeline for expression, enter, dismiss, scene, background, BGM, SFX, wait, and raw commands.
- Added a bidirectional structured command editor in the right inspector. Editing the form rewrites the slash command; editing the slash command reparses the structured form.
- `/expression` now changes persistent character expression state until another expression command overrides it.
- `/enter` and `/dismiss` bridge into the VN auto-director stage state. Explicit positions seed later continuity.
- Background/CG/BGM commands mutate persistent performance state; SFX fires at the command point.
- Command rows do not draw dialogue boxes and are automatically consumed by the VN runtime. `/wait`, camera, and transition events can intentionally occupy time.
- Backlog skips command rows.
- Source-aware Log reimport preserves manually authored director commands by re-anchoring them around surviving source lines.
- Diagnostics now report invalid/unresolved director commands and count referenced command assets as used.
- YMM/CSV exports suppress command rows. Tyrano export translates a safe subset and emits comments for unsupported commands.

## Engineering / compatibility

- Project and performance schema version: `0.42`.
- Existing 0.41 VN Auto Director behavior is preserved.
- Old projects normalize with `command: null`; no manual migration is required.
- Test suite: 165 / 165 passing.

## Deliberately deferred

The command layer is intentionally structured rather than a free-form scripting VM. Later versions can add richer production features such as `/move`, focus cuts for 4+ actors, whip-pan direction, command groups/macros, and optional conditional/choice flow without turning ordinary Log editing into code maintenance.
