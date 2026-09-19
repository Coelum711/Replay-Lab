# Replay Lab 0.36 Engineering + Human-Use Audit

This pass reviews Replay Lab as an editor used by a person, not as a collection of available fields. The primary question is: **when the user can already see the thing they want to change, can they change it there without translating the task into internal state?**

## P0 — Stage preview was display-only

### Problem

The Canvas showed the visible actors, but changing that exact arrangement required leaving the preview and translating the visual task into Inspector concepts: manual roster, stage IDs, and left/center/right selects.

That breaks direct manipulation and creates unnecessary working-memory load.

### Fixed in 0.36

The main preview now has an explicit **编排角色** mode:

- visible actors become draggable chips directly over the preview;
- drag to **左 / 中 / 右** to move an actor;
- dropping onto an occupied slot swaps the two actors;
- an empty slot exposes **＋ 添加角色**;
- each visible actor has **×** to remove it from the current line;
- merely opening edit mode does not change the project;
- the first actual edit materializes the currently compiled automatic roster into a custom roster, so the picture does not jump when manual editing begins.

The underlying edit operations live in `src/editor/stage.ts` rather than being hidden inside DOM handlers.

### Deliberate limit

The direct editor is slot-based, matching Replay Lab's existing left/center/right staging model. Arbitrary continuous X/Y placement is not introduced yet; adding it now would create a second positioning model and complicate RplGen/YMM interoperability. If continuous positioning is added later, it should be a single normalized coordinate model shared by compiler, preview, exports, and drag editing.

## P0 — Voice long-running work was tied to page navigation

### Problem

Replay Lab Free downloads/initializes inside a page-owned Worker. The Voice page's “← Replay Studio” link previously navigated the same page away. That destroys the page and therefore the Worker, so model download or synthesis dies as a side effect of ordinary navigation.

This is a lifecycle bug, not a user mistake.

### Fixed in 0.36

- Studio and Voice now use stable named windows (`replaylab-studio` / `replaylab-voice`).
- Opening Voice from Studio no longer unloads Studio.
- “← Replay Studio” opens/focuses the Studio window while leaving Voice alive, so an active model download or synthesis can continue.
- Closing/navigating away from the Voice page while a model load or synthesis is active now triggers the browser's unload protection.
- The UI explicitly explains the lifecycle: returning to Studio is safe; closing the Voice page still terminates page-owned local work.

This is a pragmatic browser solution. A truly page-independent TTS job manager would require a SharedWorker/service-worker or a single-shell application architecture.

## P0 — Audio download depended too heavily on a session `blob:` URL

### Problem

The “下载当前音频” path only used the current in-memory object URL. After reload/reopen, a generated voice asset could exist in the workspace but the button was disabled because the session cache was gone.

### Fixed in 0.36

Audio download now resolves in this order:

1. current in-memory generated Blob;
2. persisted workspace voice asset;
3. readable external/data/blob asset URI.

Saving prefers the File System Access save picker when available, then falls back to a temporary download URL. This makes a persisted generated voice downloadable after the session cache is gone.

## P0 — “model download failed” was too opaque

A failed first-run local model load can come from at least three different classes of failure: the `kokoro-js` module source, the Hugging Face model source, or local WebGPU/WASM initialization.

0.36 adds **检查下载连接**, which probes the small module/config endpoints and the Q8 model file endpoint without starting synthesis, then reports which leg is inaccessible. Failure also retains the last model file reported by the loader and exposes both normal retry and forced-WASM retry.

## Engineering findings not fully closed

### P1 — Studio controller size

`web/studio.js` remains an oversized controller. Direct-stage editing is implemented through core pure functions, but the DOM wiring should later move into a dedicated `stage-editor-controller.js`. The same applies to face-package import and character identity.

### P1 — Studio / Voice concurrent project writes

Studio and Voice are separate browser contexts. Keeping both alive fixes task cancellation, but it also makes stale-manifest writes more important: a Voice workspace save and a Studio workspace save can race if both pages hold different in-memory project revisions.

The next engineering step should be one of:

- a BroadcastChannel-based project patch protocol for speech updates; or
- a single application shell hosting Studio and Voice; or
- revisioned workspace saves with conflict detection.

Until that exists, Voice should be treated primarily as a speech worker/editor for the same project, not as an independent second full project editor.

### P1 — Direct stage editing only covers the main three slots

This is intentional for now. If Replay Lab later supports 4+ simultaneously visible actors or free positioning, the interaction must remain visible and spatial rather than falling back to a table of coordinates.

## Human-use rules reinforced by this pass

1. **Manipulate visible objects where they are visible.**
2. **Opening an editor mode must not silently mutate project semantics.**
3. **Navigation should not cancel unrelated long-running work.**
4. **A persisted asset must remain usable after ephemeral session caches disappear.**
5. **When a network-heavy feature fails, distinguish network source failure from runtime failure.**
6. **Pure-text / no-art Replay authoring remains first-class and unchanged.**
