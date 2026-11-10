# Replay Lab 0.51-dev — Custom Object Interaction

## Added

- Direct visual hotspot authoring over Custom Object state art.
- Hotspot drag and lower-right resize handle; no numeric rectangle authoring is required.
- Hotspots can be global or scoped to one object state.
- Hotspot actions: state change, hide/close, transient note, or none.
- Playable interaction modes: inspect, stateful, pan/zoom and hotspots.
- Persistent runtime interaction overrides that yield back to later explicit script commands.
- Studio playtest interaction recording into reusable Custom Object Takes.
- Baking Takes into normal `/wait` and `/object state|transform|hide` Director commands.
- `/object transform` structured command for deterministic recorded playback.
- Standalone playable web runtime uses the same interaction controller.
- AUTO pauses on interactive visible objects.
- Diagnostics for invalid hotspot state references and Takes that reference missing objects.

## Compatibility

- Project schema/version: 0.51.
- Existing 0.50 projects normalize with empty `customObjectTakes` and unchanged object visuals.
- Dice and Wheel remain dedicated System Overlay types.
- Custom Objects remain content-agnostic; evidence/phone/map/document/etc. are not engine-level kinds.
