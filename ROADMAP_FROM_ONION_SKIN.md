# Replay Lab — backlog from onion skin onward

This file records the features discussed after 0.46 and separates foundation work from later interaction work.

## 0.47 — visual presentation foundation
- Onion skin in Stage Direct Editor: previous/next beat ghosts, previous/next tint, opacity, current-character/all-stage scope.
- Fullscreen CG presentation state: contain/cover, hide characters, hide textbox, fade/push/pan presentation presets.
- Custom Object foundation: reusable arbitrary visual objects with states, hotspots, interaction mode, default transform, and `/object show|hide|state` director commands.
- Keep Dice and Wheel as System Overlay types; do not flatten them into Custom Object.

## 0.48 — Custom Object interaction
- Object inspector/editor: create from an image asset, edit states, choose state art, add hotspots visually.
- Runtime inspect interaction: open/close, state switching, pan/zoom, hotspots.
- Object Interaction Recorder: record an interaction session into linear Director Beat commands for MP4 replay.

## 0.49 — motion visualization
- Generalized motion/keyframe preview over existing custom motion system.
- Human-facing easing presets (hold / linear / smooth / ease-in / ease-out / ease-in-out / bounce) while internal numeric curves remain hidden.
- Onion skin follows actual motion keyframes when available rather than only neighboring script beats.

## Guardrails
- Custom Objects are content-agnostic. "Evidence", "phone", "map", "document", "title card" are templates/tags, not engine-level object kinds.
- Existing custom character actions remain the motion authoring source. Replay Lab orchestrates them; it does not create a second action editor.
- Fullscreen CG is separate from Custom Object/System Overlay because it has scene-level presentation semantics.


## Revised dependency order after the 2.5D scene-graph decision

The earlier plan placed interactive Custom Objects immediately after 0.47. That would have welded hotspot/interaction authoring to the old flat Canvas structure and forced another migration when depth, lighting and masks arrived. The implementation order is therefore revised:

### 0.48 — Scene Graph Foundation (implemented)
- WorldSpace vs ScreenSpace
- stable visual layers and scene-node ids
- optional normalized depth on world actors
- node/layer filter and mask metadata
- flat projection remains the default

### 0.49 — 2.5D Stage
- direct front/back dragging in the Stage Editor
- perspective-like depth projection without true 3D meshes
- automatic far-to-near occlusion
- depth motion (for example, a character rapidly fleeing away)
- light camera parallax

### 0.50 — Lighting / Filters / Masks (implemented)
- node, layer, world and final-output effect scopes
- Scene-local ambient/environment lighting with selectable world layers
- world/UI separation: world filters do not touch dialogue UI, output filters intentionally do
- CG circle/rectangle/alpha-image masks with reveal and directional wipe animation
- local spatial point lights remain a later WebGL/Pixi-oriented extension rather than being faked into the Canvas renderer

### 0.51 — Custom Object Interaction (implemented)
- visual hotspot authoring with direct drag/resize and optional per-state scope
- inspect / pan-zoom / stateful / hotspot interaction in Studio playtest and standalone playable web runtime
- hotspot actions: switch state, hide object, show a transient note, or leave interaction to the author
- interaction recording into reusable Takes
- bake Takes into ordinary `/wait` + `/object state|transform|hide` Director rows for deterministic linear replay

### Later — generalized animation editing
- existing custom actions remain the action source
- keyframe/easing visualization and reusable animation curves
- motion-aware onion skin using action/keyframe states


## 0.51 status

Custom Object interaction is active in Studio playtest and the standalone playable runtime. Hotspots are authored visually rather than as numeric rectangles, interaction state persists until the script explicitly changes the object again, and recorded interaction Takes can be baked back into normal linear Director commands. The next major layer is generalized animation/keyframe visualization over the existing custom-action system, including easing and motion-aware onion skin.


## 0.52 — Workbench Layout + Audio Timeline (implemented)
- Program Monitor separated from the scrollable/resizable construction Workbench.
- Performance / Audio / Voice / Animation workbench tabs with collapsed / standard / expanded sizing.
- Dialogue and bound Voice shown as semantic clips sharing the same `lineId`.
- SFX / Ambient / BGM semantic tracks, time ruler, playhead and zoom.
- Voice waveform peak cache in IndexedDB.
- Right Context Inspector split into Properties / Check / Publish.

## 0.53 — Audio Director (implemented)
- first-class Ambient assets/state and `/ambient` director command
- Master / Voice / BGM / Ambient / SFX project mixer
- real BGM crossfade spans
- deterministic Voice ducking of BGM/Ambient
- per-line Voice/SFX gain and stereo pan
- Master limiter shared by realtime preview and offline MP4 mixing
- generated fade/duck envelopes are the first automation layer; arbitrary freehand automation remains later work

The next major unfinished layer remains generalized animation/keyframe visualization over the existing custom-action system.
