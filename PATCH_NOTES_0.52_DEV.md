# Replay Lab 0.52-dev — Workbench Layout + Audio Timeline

- Replaces the long centre-column stack with a Program Monitor plus a resizable bottom Workbench.
- Workbench tabs: Performance / Audio / Voice / Animation.
- Collapsed, standard and expanded Workbench sizes.
- Moves the existing stage/camera/playback controls into the Performance workbench instead of stacking them beneath the preview.
- Moves the line/Beat Inspector into the right Context Inspector.
- Right column now separates Properties / Check / Publish.
- Adds a semantic audio timeline with Dialogue / Voice / SFX / Ambient / BGM track groups.
- Dialogue and Voice clips are visibly bound by the existing line id.
- Clicking a dialogue/voice/line-bound-SFX clip selects the corresponding script row and seeks to it.
- Adds a timeline playhead, time ruler and zoom.
- Adds on-demand Voice waveforms backed by an IndexedDB peak cache.
- Adds an inline selected-line Voice panel so normal narration work does not require repeatedly switching to the full AI Voice page.
