# Replay Lab — shoulders worth standing on

## 0. Reuse policy: depend, vendor, or port instead of reimplementing

Replay Lab is GPL-3.0-only, so the project should be deliberately aggressive about reusing compatible open-source infrastructure. The engineering rule is not “rewrite it so it feels original”; it is:

1. **Install as a dependency** when a mature library already exposes the needed public API and we do not need to modify its internals. This is preferred for TanStack Virtual, Dexie and CodeMirror because updates and bug fixes remain upstream.
2. **Vendor source** when offline distribution, deep modification or browser packaging genuinely requires it. Keep the upstream copyright/license notice next to the vendored code and record the exact upstream revision.
3. **Port/derive GPL domain code directly** when it already solves a TRPG-Replay-specific problem better than a fresh implementation. RplGen GPL-3.0 code is compatible with Replay Lab's GPL-3.0-only distribution, provided source/license obligations and attribution are preserved.
4. **Do not copy assets merely because the code repository is open.** Fonts, voices, icons, mascots, sample media, Steam Workshop content and model weights can have separate licenses.
5. **Review non-whitelisted licenses before copying.** MIT/BSD/Apache-2.0/GPL-3.0 are straightforward for our current project policy; AGPL, MPL, LGPL, source-available/custom licenses and datasets/models need case-by-case treatment.

So the default question is now: “what can we reuse safely?” before “how do we implement this ourselves?”. Product semantics and integration tests remain Replay Lab's responsibility.

This document records mature open-source work that should reduce the amount of editor infrastructure Replay Lab invents itself. It is an engineering decision log, not a claim that all listed source code is copied into Replay Lab.

## 1. RplGenStudio / TRPG-Replay-Generator — Replay-specific editor UX

Source: https://github.com/DanDDXuanX/TRPG-Replay-Generator  
License: GPL-3.0

Useful production lessons:

- Its RGL editor exposes normal Undo / Redo instead of treating generated Replay text as disposable.
- Its snippet menus expose common Replay commands and directing patterns (`background`, `BGM`, `dice`, `wait`, transition/effect snippets) rather than forcing users to construct every command from primitives.
- Its UI explicitly supports collapsible lists/sections.
- Its architecture separates media definitions, character data and Replay log/script state.

Replay Lab adoption:

- 0.16 has an independent project history layer, Chapter/Scene folding, and document/block reordering.
- “Performance presets” are the structured-editor equivalent of RGL command snippets.
- Replay Lab keeps a visual/script-first interface instead of copying RGL's code-editor-first UX.

## 2. VNVE — browser editor state and persistence separation

Source: https://github.com/vnve/vnve  
License: MIT

VNVE's editor currently uses Zustand + Immer for state, Dexie for IndexedDB persistence, and Slate/Slate History for rich-text history. Its renderer/editor state is kept separate from view-facing reactive copies.

Replay Lab adoption:

- Keep `ReplayProject`, compiler, renderer, project history and DOM UI as separate layers.
- Do not make Canvas renderer objects the canonical editor state.
- When temporary-project crash recovery is added, use an IndexedDB layer rather than stuffing binary data into project JSON.
- Replay Lab currently stays framework-light; migrating to React/Zustand is not justified only to gain Undo/Redo.

## 3. TanStack Virtual — long Log virtualization

Source: https://github.com/TanStack/virtual  
Docs: https://tanstack.com/virtual/latest/docs/introduction  
License: MIT

TanStack Virtual is headless and framework-agnostic, supports dynamic measurement and large lists, and lets Replay Lab keep its own markup.

Decision:

- Use `@tanstack/virtual-core` when Studio moves to a bundled app shell.
- Do not write a home-grown scroll-height/overscan engine.
- 0.16 introduces a framework-neutral `ScriptRenderRow` flattening layer specifically so TanStack can own viewport/range calculation later.
- The current environment can read GitHub but cannot install npm/raw package files into the container, so 0.16 deliberately does **not** fake or partially reimplement TanStack Virtual; CSS `content-visibility` remains the fallback.

## 4. CodeMirror 6 — optional source/script mode

Source/docs: https://codemirror.net/  
License: MIT

CodeMirror already provides mature search, find-next/find-previous, goto-line, multiple-selection commands and history infrastructure.

Decision:

- Keep the primary Replay Lab editor structured and Orange-game/VN-editor-like.
- If an advanced raw script/RGL/source mode is added, embed CodeMirror instead of making a custom textarea editor.
- Do not force ordinary users into source mode.

## 5. Dexie — temporary project recovery

Source/docs: https://dexie.org/  
License: Apache-2.0 (current Dexie package; verify at integration time)

Dexie is a mature IndexedDB wrapper and VNVE already demonstrates that this pattern works in a browser VN editor.

Decision:

- Real project folders remain the preferred durable workspace.
- 0.16 already implements the persistence boundary plus a tiny standards-only IndexedDB recovery backend for project JSON.
- Replace that backend with Dexie when the Studio becomes bundled; Dexie should then own autosaved temporary-project recovery, generated-preview caches and interrupted-session recovery.
- Verify exact package/license version again when it is actually added; this document is not a bundled third-party notice.

## What Replay Lab should still own

These are domain-specific enough that a generic editor library should not define them:

- Log importer normalization and TRPG bot semantics.
- Character staging inheritance.
- Scene/BG/CG/BGM state compilation.
- Dialogue/dice/system/narration semantics.
- Speech language/translation/TTS policy.
- Replay-specific performance presets.
- `ReplayProject → PerformanceDocument` compilation.

The rule is: borrow mature infrastructure; keep Replay semantics ours.


## 6. WebGAL + Monogatari — VN player UX/runtime separation

Studied sources:

- WebGAL / WebGAL Terre — MPL-2.0
- Monogatari — MIT

Replay Lab 0.28 studies their mature VN workflow concepts: in-editor play, AUTO, SKIP, backlog, restart and publishable web output. No WebGAL or Monogatari renderer/source file is vendored in 0.28. Replay Lab keeps its own `PerformanceDocument → CanvasStageRenderer` path as the single visual source of truth, so Studio playtest, published web playback and video export do not diverge.

The important borrowed architectural lesson is the separation of player state from rendering: `VNReplayRuntime` controls advance/auto/skip/backlog while the existing renderer owns pixels and the existing media player owns audio.
