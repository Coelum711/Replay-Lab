# Replay Lab 0.53-dev — Audio Director

- Adds first-class Ambient assets and Scene/Director state (`/ambient ...`, `/ambient stop`).
- Adds `ReplaySettings.audioMix` with Master / Voice / BGM / Ambient / SFX levels.
- Migrates legacy BGM/SFX volumes without changing old project/template mix levels.
- Adds real BGM crossfades rather than hard switches.
- Adds deterministic Voice ducking for BGM and Ambient based on scheduled Voice intervals.
- Adds per-line Voice and SFX gain/pan controls.
- Adds Voice pre-roll/post-roll timing controls while preserving dialogue/voice line binding.
- Adds a Master limiter to both realtime preview and offline MP4 audio paths.
- Realtime playback and offline audio render share the same semantic audio schedule and envelopes.
- The Audio Workbench visualizes BGM/Ambient fade spans and exposes the project mixer, crossfade, ducking and limiter controls.
