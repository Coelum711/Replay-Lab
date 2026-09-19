# Replay Lab 0.37 Engineering + Human-Use Audit

This pass reviewed Replay Lab against two questions at the same time:

1. **Engineering:** can independent parts of the editor mutate shared project state without corrupting or silently overwriting it?
2. **Human use:** can a creator complete the common text-first workflow without learning storage, rigging, or internal data-model concepts first?

## P0 — Studio and Voice could overwrite each other's project manifest

### Problem

Studio and Voice are intentionally separate browser contexts so local TTS work can continue while the user returns to Studio. Before 0.37, both contexts could hold different in-memory copies of `project.replaylab.json` and save them independently. The last writer won.

That means a normal sequence such as:

1. open a project in Studio;
2. open Voice;
3. edit dialogue in Studio;
4. generate/persist speech in Voice;
5. let Studio autosave;

could silently remove the Voice-side manifest changes, or vice versa.

### Fixed in 0.37

Workspace implementations now keep a fingerprint of the exact manifest text last loaded or saved in that context. Before saving, Replay Lab re-reads the current manifest and compares it with that fingerprint.

If it changed:

- the save is rejected with `WorkspaceConflictError`;
- Studio pauses autosave instead of retrying destructively;
- Voice stops project writes;
- both pages expose **重新载入目录版本**;
- the UI tells the user to export Project JSON first if the current page contains edits they want to preserve.

Generated speech and persisted asset helpers also preflight the same check before writing their asset payload.

### Deliberate limit

Browser File System Access does not provide a multi-file transaction. There is still a very narrow race between the preflight check and a later asset write/save pair. The manifest can no longer be silently overwritten, but a conflict in that tiny interval can leave an unreferenced asset file. That is preferable to project-state loss. A future single-shell or revisioned asset transaction model would close this completely.

## P0 — Save setup competed with the first authoring action

### Problem

The left column showed project-folder controls as a full card before import. The text said temporary editing was allowed, but the visual hierarchy still implied “connect a folder first”.

That contradicted Replay Lab's main product rule: paste a Log and start immediately, with no art and no workspace required.

### Fixed in 0.37

The full workspace block is now a collapsed **保存位置** disclosure with the explicit summary **可稍后 · 临时工程会自动恢复**.

The body now says plainly that the user can start by importing a Log and only needs a folder later for persistent images/audio/long-term storage.

Pure-text import behavior is unchanged.

## P0 — Character merge asked for confirmation before showing impact

### Problem

Character merge is intentionally manual and undoable, but the confirmation previously described semantics rather than concrete impact. A user had to approve before knowing how many dialogue lines or stage references would be rewritten, or whether art/settings conflicts existed.

### Fixed in 0.37

Before confirmation, Studio performs the merge against a cloned project and shows:

- number of dialogue lines reassigned;
- number of stage-reference groups rewritten;
- number of art/settings conflicts;
- which character wins conflicts;
- explicit Undo availability.

The real project is only mutated after confirmation.

## P1 — Direct stage DOM wiring lived inside the main Studio controller

### Problem

`web/studio.js` had accumulated direct-stage drag/drop lifecycle code on top of import, character editing, Face Fit, identity, export, recovery, and playback. The stage state mutations themselves were already pure functions in `src/editor/stage.ts`, but their DOM lifecycle was still coupled to the monolithic controller.

### Fixed in 0.37

Direct stage interaction now lives in:

```text
web/stage-editor-controller.js
```

The controller owns:

- edit-mode lifecycle;
- slot DOM rendering;
- drag/drop handlers;
- add/remove controls.

It receives project/line/performance state and mutation callbacks from Studio. Core stage semantics remain in `src/editor/stage.ts`.

This is the pattern future extractions should follow: **pure project mutations in `src/`, page lifecycle in a small web controller, orchestration in `studio.js`.**

## Human-use findings retained

The audit did not find a reason to change these existing product constraints:

- no-art characters remain valid playable placeholders;
- shared face templates and Face Fit stay optional;
- technical controls remain progressively disclosed;
- ambiguous asset guesses do not overwrite existing work;
- cross-language character identity is never guessed automatically;
- the main preview should support direct manipulation where a visible object can reasonably be edited in place.

## Remaining P1 engineering work

### Studio controller is still large

The stage extraction reduces one lifecycle surface, but `web/studio.js` still owns too much. The next safe extractions are:

1. face-package import controller;
2. character identity controller;
3. Face Fit controller;
4. export controller.

These should be behavior-preserving refactors, not simultaneous feature rewrites.

### Manifest conflict detection is prevention, not merge

0.37 prevents silent last-writer-wins. It does not merge two divergent project manifests. A future patch protocol or single application shell could make Studio and Voice share one authoritative in-memory project.

### Real browser smoke testing remains unavailable in the current container

Static DOM contracts, TypeScript tests, and syntax checks are strong regression guards, but they are not proof of real pointer/drag/file-picker behavior. Do not claim browser E2E coverage until a stable headless-browser path exists.

## Product rules reinforced by this pass

1. **Prevent silent data loss before adding convenience.**
2. **Storage is secondary to the first creative action.**
3. **High-consequence actions show impact before confirmation.**
4. **Page controllers own DOM lifecycle; core modules own state semantics.**
5. **A conflict must stop writes and offer recovery in the same screen.**
6. **Pure-text authoring remains the baseline that all optional systems must preserve.**
