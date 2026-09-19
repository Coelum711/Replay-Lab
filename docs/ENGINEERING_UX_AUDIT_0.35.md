# Replay Lab 0.35 Engineering + Low-Attention UX Audit

This pass uses a deliberately strict usability target: the default interface must remain learnable by a user with low patience, limited working memory, and substantial attention-switching cost.

## Executive findings

### P0 — Auto-assembly naming was an invisible prerequisite

The face auto-assembly classifier had useful naming rules, but the Studio did not teach those rules at the point of use. A user could choose files, see failed recognition, and reasonably conclude that the feature was broken.

**Fixed in 0.35:**

- The picker now says explicitly that naming rules do not need to be learned first.
- A six-file recommended naming set is visible beside the action.
- The same naming examples live next to the classifier implementation, reducing documentation drift.
- A copy button provides the recommended names without requiring transcription.
- 3/4 and extended mouth naming are secondary and folded.

### P0 — Recognition failure forced restart/rework

Previously, an unrecognized file was effectively a dead end. The natural repair path was to exit the flow, rename the file, and import again.

**Fixed in 0.35:** every imported row has an in-place “what is this?” slot selector. Unrecognized and low-confidence files can be repaired without leaving the preview.

### P0 — Correct automatic results created attention noise

A large import showed every file with equal visual weight, even if most automatic decisions were already safe.

**Fixed in 0.35:** files that require attention are shown first; high-confidence successful matches are folded under “already recognized — usually do not inspect.” Existing bindings, ambiguity, conflicts, and low-confidence guesses remain explicit and unchecked.

### P0 — Speech pause parser had a terminal-punctuation runaway

The sentence-punctuation loop used `String.includes('')`, which is true. At end-of-string this could loop indefinitely and grow a string until `RangeError: Invalid string length`.

**Fixed in 0.35:** the loop checks string bounds before testing the next punctuation character. The full test suite now covers normal sentence-final punctuation.

## Character-page human-factors review

The character page had accumulated identity, speech, stage layout, shared face templates, Face Fit, local face overrides, visemes, expressions, lattice controls, and compatibility art. The feature set is valuable; the default information density was not.

### Changes in 0.35

- Speech / AI voice settings are optional and collapsed by default.
- “Shared Face Template” is presented as “Face art (optional).”
- “Face Fit” is presented as “put the features on the face (position / direction).”
- Direct manipulation is primary; exact numeric Face Fit controls are Advanced-only.
- 3/4 split-part precision controls are Advanced-only.
- Local character face parts are folded under “only if this character differs from the common face.”
- A persistent callout states that characters with no art remain valid and playable placeholders.
- Technical audit documentation is hidden with Advanced Tools instead of competing with authoring tasks.

## Engineering constraints retained

- Pure-text Log/story import creates usable characters without creating face templates or requiring assets.
- Low-confidence filename guesses are never auto-applied.
- Existing slot bindings are never overwritten by default.
- Same-target same-slot conflicts must be resolved before applying.
- Face naming examples and classifier behavior share one source module.
- Static DOM and TypeScript checks remain necessary but are not treated as proof of real browser interaction.

## Remaining P1 work

### Studio controller size

`web/studio.js` is still too large. The next structural refactor should move face-template import, character identity, speech controls, and Face Fit into separate controllers without changing product behavior.

### First-run project/save hierarchy

The left column still shows workspace/save controls before import. This is safe but may imply that a folder must be connected before starting. A later pass should reduce this to a compact “save location — can do later” disclosure for temporary projects.

### Real browser smoke test

The test suite now has strong pure-function and static UI contracts, but not a reliable real-browser click-through in the current container. When browser CI is stable, the minimum smoke path remains: launch → paste Log → Characters → open face import → map one unknown file → apply → playtest.

## Product rule

For every new feature, ask four questions before merging:

1. Does the user need to remember something that could be shown here instead?
2. If automation fails, can they repair it on the same screen?
3. Are we making them inspect successful work unnecessarily?
4. Can they ignore this entire feature and still complete a basic Replay?

If any answer is wrong, the default UI is not finished.
