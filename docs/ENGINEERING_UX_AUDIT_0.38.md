# Replay Lab 0.38 Engineering + Human-Use Audit

This pass reviewed Replay Lab after the face-template, material-package, character-identity, direct-stage, and workspace-conflict work had all landed. The review deliberately prioritized **preserving user work** and **reducing the amount of internal vocabulary a creator must understand** over adding another rendering feature.

## P0 — Published playable runtime manifest drifted behind `dist/`

### Problem

The playable-web exporter copies a curated list from `web/runtime-files.json`. After several new core/editor modules landed, `dist/` contained 93 JavaScript modules while the runtime manifest listed only 84. Missing files included face/identity/stage/re-import/conflict modules. Because the published player loads `dist/index.js`, static ESM resolution can require re-exported modules even if a particular scene never calls those features. A published folder could therefore fail at startup with missing-module requests.

### Fixed in 0.38

`npm run build` now runs:

```text
tsc
→ scripts/update-runtime-manifest.mjs
→ web/runtime-files.json
```

The manifest is generated from the actual compiled `dist/**/*.js` set instead of maintained by hand. A distribution test asserts exact set equality between compiled JavaScript modules and the published-runtime manifest. Adding a new TypeScript module can no longer silently omit it from playable export.


## P0 — Ambiguous aliases could route dialogue by array order

### Problem

The identity system correctly avoided guessing cross-language equivalence, but `ensureCharacter()` still used the first character for which a name-or-alias predicate matched. If two characters accidentally shared one confirmed import alias, a later speaker using that alias could be attached to whichever character happened to appear first in the array.

### Fixed in 0.38

Character resolution now has explicit `primary / alias / ambiguous / none` outcomes. One exact primary display name wins first, then one normalized primary name, then one unique confirmed import alias. Ambiguity never chooses by order: a visible new character is created instead, so the existing duplicate-identity repair flow can resolve it explicitly.

## P0 — Re-importing a script could throw away finished character setup

### Problem

The text-first workflow encourages users to start from a Log, then gradually add art, shared face templates, Face Fit, voices, aliases, and other authoring setup. The ordinary import buttons historically behaved like opening a new project: parsing a revised Log replaced the whole `ReplayProject`.

That creates a bad human workflow:

1. import an early draft;
2. spend time setting up characters and art;
3. receive a corrected / longer Log;
4. import it again;
5. lose the setup unless the user remembered to export and manually reconcile it.

This is especially dangerous because script revision is normal, not exceptional.

### Fixed in 0.38

Replay Lab now has an explicit, default-on import option:

**重新导入时保留角色素材 / 声音 / 模板**

When an existing project already has script lines, Log and story-script re-import can now replace only the script while preserving:

- existing characters and confirmed import aliases;
- character art, Face Fit, puppet rig, and expressions;
- shared face templates;
- assets and media definitions;
- speech / accent / voice configuration;
- project-level settings.

New speaker names still create normal zero-art characters. Ambiguous aliases are never resolved by array order: Replay Lab creates a visible separate character and asks the user to resolve identity later.

The merge is implemented in the core helper:

```text
src/editor/script-reimport.ts
```

so the behavior is testable independently of Studio DOM code.

### Full-replace path remains available

Unchecking the preserve option retains the previous “replace the whole current project” behavior. That path now states explicitly that character art, templates, voice/settings, and current script will be replaced.

## P0 — Character merge impact was hidden inside a blocking confirmation dialog

### Problem

0.37 calculated concrete merge impact before mutation, but the user only saw it inside a browser `confirm()` dialog. That is safe, but poor for comprehension: the user must read a dense transient modal while deciding which identity should survive.

### Fixed in 0.38

Character identity now shows a persistent inline impact preview before the destructive action:

- `source → retained character`;
- dialogue lines reassigned;
- stage-reference groups rewritten;
- art/settings conflict count;
- which character wins conflicts;
- Undo availability.

The final button names the exact merge direction. Suggestions remain non-destructive: clicking a candidate only fills the two selectors and reveals the impact preview.

Cross-language identity is still never guessed automatically.


## P1 — Character merge could leave stale secondary identity state

0.38 also closes several smaller merge gaps. Source `speech.pauseScale` now fills an unset target or appears as a conflict when both differ; generated voice assets whose metadata still names the removed character are rewritten to the retained ID; conflicting explicit stage positions and role/default-stage settings are surfaced in the impact preview. Technical conflict paths are translated into creator-facing labels such as **角色底图**, **Face Fit 五官位置**, **朗读停顿强度**, and **默认站位**.

## P1 — Character identity and face-package DOM lifecycle lived in the main Studio controller

### Problem

`web/studio.js` had already delegated direct-stage editing to a controller, but it still directly owned two substantial UI lifecycles:

- character duplicate/merge UI;
- project-level face-package routing UI.

That made character-page changes unusually risky because import routing, merge previews, and general Studio orchestration were interleaved in one file.

### Fixed in 0.38

Two page controllers now own these DOM surfaces:

```text
web/character-identity-controller.js
web/face-package-controller.js
```

`studio.js` remains responsible for project orchestration, persistence, history, and high-level mutation callbacks. Core matching/merge/routing semantics remain in `src/`.

This follows the same architectural boundary established by the direct-stage editor:

> core modules own project semantics; small page controllers own DOM lifecycle; Studio orchestrates.

## P1 — Internal `alias` terminology leaked into normal status/history text

### Fixed in 0.38

Normal creator-facing text now says **导入别名** or **导入名字有歧义**. The implementation and engineering documentation may still use `alias` as the data-model term.

## Text-only compatibility

The audit re-verified the first-class no-art path:

- plain Log/story import can create characters with no assets;
- placeholders remain playable;
- re-import with setup preservation does not require art;
- face package import remains an explicitly user-triggered optional workflow;
- identity aliases/merge do not require character art.

## Remaining P1 engineering work

### `web/studio.js` is still large

0.38 reduces coupling but does not finish the split. The next low-risk controller extractions are:

1. Face Fit direct-manipulation lifecycle;
2. export/video lifecycle;
3. character speech/accent controls.

These should remain behavior-preserving refactors.

### Studio / Voice conflict handling prevents overwrite but does not merge edits

Optimistic manifest conflict detection remains the correct safety baseline. A revision/patch protocol or a single shared application shell would be needed for automatic reconciliation.

### Browser E2E remains unavailable in the current container

The suite verifies pure project semantics, TypeScript, syntax, and static DOM contracts. It does not prove real file-picker, drag/drop, pointer, or browser navigation behavior. Do not represent these checks as browser E2E coverage.

## Product rules reinforced by this pass

1. A normal script revision must not destroy expensive character setup by default.
2. Destructive actions should show concrete impact persistently before the final click.
3. Ambiguous identity must stay visible rather than being guessed.
4. Technical vocabulary is secondary to creator-facing language.
5. Optional art/voice systems must remain removable from the basic text-first path.
6. DOM lifecycle belongs in small controllers; project semantics belong in testable core modules.
