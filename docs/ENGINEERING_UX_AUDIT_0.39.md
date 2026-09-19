# Engineering + Human-Use Audit — 0.39

Replay Lab 0.39 is a hardening pass rather than a new media-format pass. The review focuses on the areas that grew fastest in 0.29–0.38: character art, Face Template / Face Fit, material-package import, character identity, revised-script reimport, and creator diagnostics.

## Product invariant

The central product rule still holds:

> A creator must be able to import text, edit the Replay, play it, and export it without preparing character art. Art, voice, face templates, puppet deformation, and material packages are optional upgrades.

The no-art placeholder path remains a first-class runtime path, not an error fallback.

## Engineering review

### What is structurally healthy

- `ReplayProject` remains the authoring source of truth; `PerformanceDocument` is compiled output.
- Studio playtest, published player, and video export continue to share the same Canvas/Puppet rendering path.
- Face-template filename classification and mixed-package routing live in core modules rather than DOM handlers.
- Face Fit projection math is shared by Studio preview and final rendering rather than duplicated.
- Recent high-state UI lifecycles have been separated from `studio.js` into focused controllers (`FaceFitController`, `CharacterSpeechController`, `CharacterIdentityController`, `FacePackageController`, `StageDirectEditorController`).
- Workspace writes use manifest conflict detection; ambiguous character aliases refuse silent resolution.

### 0.39 change: character merge is now plan → apply

Previously the Studio preview obtained an exact merge impact by cloning the whole project and calling the mutating `mergeCharacters()` function on the clone. That was safe for data, but it made the UI depend directly on mutation semantics and obscured the distinction between preview and commit.

0.39 adds:

```ts
planCharacterMerge(project, keepId, mergeId)
```

The function is pure from the caller's perspective and returns the exact impact that `mergeCharacters()` will apply:

- dialogue references reassigned
- stage references reassigned
- generated-voice identity metadata reassigned
- target-empty settings that will be filled from the source
- conflicting fields that will keep the target value
- conflicts grouped into creator-level areas: identity/default behaviour, stage, appearance/Face Fit, speech, other
- source names that will become import aliases

The mutating operation remains a separate explicit apply step.

### Remaining engineering debt

There is no P0 structural blocker in the current codebase. The highest-value next refactors are:

1. **Character art/expression authoring remains the largest coherent block inside `studio.js`.** Template slot wiring, single-template autobind, expression components, and lattice editing can become one or two dedicated controllers without changing the data model.
2. **Schema normalization is still partly browser-oriented.** Studio defensively normalizes older project shapes on load; a future version should expose one central core `normalizeProject()` / schema migration entry point for Studio, CLI, tests, and third-party callers.
3. **Human labels for low-level merge paths still live partly in browser code.** 0.39 groups conflicts in core, but detailed presentation labels could eventually be represented as structured domain metadata rather than string-path interpretation.

These are maintainability issues, not correctness failures.

## Human-use review

### What is working

- A pasted Log can still create zero-art characters and immediately produce a playable Replay.
- The character page explicitly tells creators when the placeholder is already sufficient.
- Face art is progressive: no art → base art → shared face template → Face Fit → split 3/4 parts → puppet/lattice refinement.
- Advanced numeric rig controls remain behind progressive disclosure.
- Material-package import shows uncertain items instead of requiring users to understand filename-classifier internals.
- Character aliases are conservative: confirmed aliases are reusable, but cross-language names such as `Matthew` / `马修` are never guessed automatically.
- Revised-script reimport preserves existing art/voice/template work by default instead of treating a new text file as a new production project.

### 0.39 change: no-art is no longer a diagnostic problem

Project diagnostics previously emitted one `character-without-idle` information item per no-art character. In a deliberately text-first project, that could fill the diagnostics panel with non-actionable information and visually bury real broken references or alias warnings.

`diagnoseProject()` now omits placeholder-art information by default. A caller that explicitly wants a completeness report can request:

```ts
diagnoseProject(project, { includePlaceholderArtInfo: true })
```

The character editor itself continues to explain the placeholder state where the information is actually useful.

### 0.39 change: merge preview is expressed in consequences

The merge UI now answers four creator questions before the destructive button is enabled:

- How many dialogue lines move?
- How many stage references change?
- What missing settings/art will be brought over?
- What conflicts exist, and which side wins?

Conflicting target settings are explicitly described as **not being overwritten**. The source display name is explicitly described as becoming an import alias after merge. Undo remains available.

### 0.39 change: revised-script reimport explains retained old characters

Preserving an existing production setup means a character that disappeared from the newest script should not automatically lose its art, voice, or Face Fit. That is the correct data policy, but without an explanation the extra character can look like a failed import.

The reimport report now separately counts characters retained from the old setup that are not referenced by the new script and says their production data was intentionally kept.

## Human-use priorities after 0.39

The next UX gains should come from reducing decisions, not adding more knobs:

1. Extract the remaining art/expression authoring block without changing its visible workflow.
2. Add optional "show only characters used by current script" filtering rather than deleting retained characters.
3. Keep face-template auto-binding conservative; improve repair suggestions before adding fuzzy automatic classification.
4. Preserve the rule that a creator can stop at any stage once the Replay looks good enough.

## Regression rules

Future versions should keep tests for these invariants:

- text-only import creates no required assets or face templates;
- default diagnostics do not classify placeholder characters as problems;
- character merge preview does not mutate the project;
- merge preview and merge apply report the same impact/conflicts;
- ambiguous aliases never silently steal imported dialogue;
- revised-script reimport preserves existing production setup and reports intentionally retained old characters.
