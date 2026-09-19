# Replay Lab 0.53.1-dev — Simpler Audio UX

This patch keeps the 0.53 Audio Director engine intact but reduces the default interface.

## Default audio controls

Normal editing now shows only the controls most replay/VN creators routinely need:

- Voice volume
- BGM volume
- Ambient volume
- SFX volume
- `对白时自动降低背景音乐`
- `BGM 自动淡入淡出`

The semantic Dialogue / Voice / SFX / Ambient / BGM timeline remains unchanged.

## Advanced Tools

The existing top-level `高级工具` switch now reveals precision audio controls instead of forcing them into the default workflow:

- Master volume
- exact BGM crossfade duration
- output limiter toggle
- per-line Voice/SFX stereo pan
- Voice offset
- exact pre-roll / post-roll seconds

No audio capability or project data was removed. Realtime preview and offline export still use the same 0.53 audio scheduling, ducking, crossfade, panning, gain and limiter implementation.

## Product rule

The intended boundary is now explicit: **DAW-like engine, VN/replay-like surface**. Common actions stay visible; engineering parameters stay available but optional.
