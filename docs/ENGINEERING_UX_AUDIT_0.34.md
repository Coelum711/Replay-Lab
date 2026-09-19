# Replay Lab 0.34 Engineering + UX Audit

This audit was triggered by a real usability failure: the Studio could be opened in a state where the interface rendered but many controls did not respond.

## Executive finding

The highest-severity issue was distribution/boot behavior, not the face-template feature itself. Replay Studio is an ES-module application. Opening `web/studio.html` directly with `file://` can prevent the module graph from loading, leaving a visually complete HTML shell whose JavaScript controls are inert. The README documented HTTP serving, but only near the bottom, so the product failed silently at the exact point a normal user would try first.

### Fixed in 0.34.1

- Root launchers for Windows / macOS / Linux plus a Python launcher.
- Loopback-only local server (`127.0.0.1`).
- `START_HERE.txt` and `OPEN_REPLAY_LAB.html` at repository root.
- Studio and Voice Workbench now have a classic-script boot sentinel. If ES modules fail to load, or synchronous startup throws before event binding completes, the page shows an explicit blocking diagnostic instead of pretending to be usable.
- Static contract tests require every static button ID to be referenced by its page script.

## Engineering audit

### P0 — Silent boot failure

**Problem:** The HTML shell can render without the ES-module application. Native HTML controls such as `<details>` may still respond, while most buttons and tabs do not. This makes the failure look like random broken controls.

**Decision:** Treat “application booted” as an explicit state. Do not expose an apparently live workspace before module initialization completes.

**Status:** Fixed in 0.34.1.

### P1 — Startup is still structurally brittle

`web/studio.js` binds a large number of controls at module top level. A missing or renamed element can throw and prevent all later bindings from running. Existing DOM-reference tests reduce this risk but are not equivalent to browser execution.

**Mitigation now:** boot sentinel remains visible if synchronous setup does not reach the ready marker; static tests verify all static button IDs are referenced.

**Recommended next refactor:** split bootstrap into explicit phases:

1. resolve required DOM,
2. bind global controls,
3. initialize project state,
4. render first frame,
5. announce ready.

Each phase should return a typed result and report a user-facing failure independently.

### P1 — `studio.js` is too monolithic

The Studio file has accumulated import, editor, renderer-control, Face Fit, package import, identity merge, export and recovery logic. This raises regression risk and makes it difficult to isolate event-lifecycle bugs.

**Recommended modules:**

- `studio/bootstrap.js`
- `studio/views/script-view.js`
- `studio/views/character-view.js`
- `studio/face-fit-controller.js`
- `studio/face-package-controller.js`
- `studio/export-controller.js`
- `studio/recovery-controller.js`

No behavior change is required to make this split.

### P1 — Too much whole-view rerendering

Many small edits call `renderAll()` or rebuild the full character detail DOM. This can reset disclosure state, recreate handlers, lose transient selection, and make pointer interactions feel unstable.

**Recommended rule:**

- data edits that only affect preview: compile + preview only;
- one field/summary changed: patch that field/summary;
- structural changes: rerender the current view;
- project replacement: `renderAll()`.

Face Fit already partly follows the lighter preview path; other controls should follow it.

### P1 — No real browser interaction test in CI/container

Current tests cover TypeScript, pure functions, structural HTML/JS contracts and static UI expectations. They do not prove that a real browser loaded the page, clicked a tab and changed state.

**Recommended acceptance smoke test:** open Studio through the same launcher/server path and verify at minimum:

- boot sentinel disappears;
- Script / Characters / Assets tabs switch;
- New Project works;
- text Log import produces lines;
- character tab opens and one field can be edited;
- VN playtest modal opens/closes.

This should be added when a stable headless-browser environment is available.

### P2 — External runtime dependencies should not be required for core editing

TanStack Virtual and Mediabunny are optional runtime capabilities. Core script/character editing must remain usable if they are unavailable.

**Current design:** long-log virtualization has fallback and video export is secondary, which is correct. Keep this boundary.

## Human-factors audit

### P0 — “Looks usable but is dead” is worse than an error page

A normal user should never have to infer that the wrong launch protocol caused dead buttons. The boot sentinel now blocks the fake-live interface and tells the user how to start correctly.

### P1 — Character page has feature-density creep

The character editor now includes:

- identity,
- standing art,
- shared face templates,
- auto-assembly,
- Face Fit,
- split facial parts,
- visemes,
- expressions,
- puppet parameters,
- lattice deformation,
- legacy whole-frame art.

The functionality is valuable, but the page is approaching “configuration wall” territory.

**Current correction:** alias/identity management is folded; manual character merge is Advanced-only unless a likely duplicate exists.

**Recommended task hierarchy:**

1. **基础** — name, type, stage behavior, base art.
2. **脸部** — shared template + Face Fit.
3. **表情 / 口型** — common authoring workflow.
4. **高级** — puppet/lattice/legacy compatibility.

The user should not need to understand the full rig model to put a character on screen.

### P1 — Destructive merge needs stronger affordance

Character merge removes one character record and rewrites references. It is undoable through project history, but this was not visible enough.

**Current correction:** manual merge is less prominent and the UI explicitly states that Undo is available.

**Recommended later:** show a compact pre-merge summary such as “12 dialogue lines, 3 stage references, 2 asset conflicts” before confirmation.

### P1 — Technical vocabulary should be secondary

Terms such as `Face Fit`, `alias`, `3/4`, `lattice`, and `viseme` are useful internally but should not be the primary recognition cue for casual creators.

Preferred labels:

- “脸部位置 / 透视（Face Fit）”
- “导入别名（alias）”
- “左右朝向 / 3⁄4”
- “网格微调（lattice）”
- “口型（viseme）”

### P1 — Pure-text workflow must remain obvious

Replay Lab’s differentiator is that a user can paste a Log and start immediately without art. Every character-art feature must remain optional.

**Current contract:** text import creates zero media assets and zero face templates when no art is supplied; placeholder characters remain valid for editing/playtest.

### P2 — Mobile/narrow-screen behavior is functional but not optimized

The layout collapses below 900 px, but the Studio is still fundamentally desktop-authoring software. Dense Face Fit/package tables are usable only with additional scrolling on a phone.

**Recommendation:** do not distort desktop authoring around mobile. On narrow screens prioritize review, text editing and simple character setup; mark precision Face Fit/lattice editing as desktop-preferred.

## Product rules after this audit

1. A failed bootstrap must be explicit and blocking.
2. Direct `file://` Studio opening is not a supported launch path unless a future bundled build removes that limitation.
3. Pure-text import must never require art.
4. High-frequency authoring stays visible; identity repair, legacy compatibility and rig internals stay folded.
5. Small edits should not rebuild the entire Studio.
6. Static green tests are not evidence of interactive browser usability.
7. Before adding another major character feature, reduce the character-view controller surface and add a real interaction smoke test.
