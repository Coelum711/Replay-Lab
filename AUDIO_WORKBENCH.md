# Audio Workbench — 0.52 / 0.53

Replay Lab treats audio as narrative timing attached to the existing script, not as a free-form DAW session.

## Workbench layout

The centre column is split into a Program Monitor and a resizable Workbench. The Workbench has four task tabs:

- Performance — the existing blocking / camera / playback controls.
- Audio — semantic Dialogue / Voice / SFX / Ambient / BGM tracks.
- Voice — the selected dialogue line and its bound Voice asset, with direct per-line controls and a link to the full AI voice workbench.
- Animation — reserved for the later generalized keyframe view over the existing custom-action system.

The Workbench has collapsed, standard and expanded heights. The Program Monitor remains separate from the Workbench, so editing a long timeline does not require scrolling the main preview away.

The right column is a Context Inspector with Properties / Check / Publish tabs. Line/Beat properties no longer compete vertically with diagnostics and exports.

## Dialogue / Voice binding

Dialogue and Voice clips use the same `lineId`. A generated or imported voice remains bound through the line's existing `audioAssetId`; the timeline only makes that relationship visible.

When a Voice asset has a persisted duration, automatic dialogue timing continues to derive from that duration. Per-line audio settings add Voice gain, stereo pan, pre-roll and post-roll without changing the displayed dialogue text.

SFX attached to a line also carries the line id into the audio schedule, so clicking the SFX clip can select the same script row.

## Waveform cache

Voice waveforms are decoded on demand and reduced to peak arrays. Peak arrays are cached in IndexedDB (`ReplayLabWaveforms`) using the asset identity plus requested resolution. Timeline zoom can therefore request an appropriate cached resolution instead of decoding the source audio on every redraw.

## 0.53 Audio Director

The project now has five semantic sound groups:

- Voice
- SFX
- Ambient (long-form looping environment beds)
- BGM
- Master

`ReplaySettings.audioMix` stores the project mix. Legacy `bgmVolume` and `sfxVolume` are preserved as synchronized compatibility mirrors, and old projects with only those two settings migrate without changing their levels.

### BGM crossfade

BGM state changes create overlapping schedule spans. The outgoing cue fades out while the incoming cue fades in. `/bgm stop` uses a fade tail instead of a hard cut. The global crossfade duration is exposed in the Audio Workbench.

### Ambient

Ambient is a first-class `MediaAsset` kind and Director/Scene state. It is looped independently from BGM and is suitable for rain, crowds, machinery, wind, sea noise and similar environmental beds. `/ambient <asset>` and `/ambient stop` are supported.

### Deterministic Voice ducking

Replay Lab already knows the scheduled start/end of each bound Voice line, so ducking does not need an audio-threshold detector. BGM and Ambient gain envelopes are generated directly from Voice intervals with configurable attack/release and separate BGM/Ambient duck depth.

### Gain and pan

Project-level Voice/BGM/Ambient/SFX gains live in the mixer strip. Voice and line-bound SFX can additionally store per-line gain and stereo pan. Realtime preview and offline MP4 mixing consume the same schedule values.

### Master limiter

Realtime and offline audio paths share a master dynamics limiter after the Master gain. It protects ordinary overlapping Voice/SFX/BGM/Ambient combinations from hard digital clipping. This is deliberately a safety stage, not a mastering suite.

## Scope intentionally deferred

0.53 does not attempt to be a full DAW. It does not yet expose arbitrary freehand automation lanes, bus/send routing, plugin chains, sample-level editing, per-character permanent Voice tracks, loop-region authoring or spatial 3D audio. Crossfade and ducking are generated automation envelopes; later advanced automation can visualize/edit those envelopes without replacing the current semantic model.
