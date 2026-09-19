# Replay Lab Low-Attention UX Standard

Replay Lab's default interface is designed for a user who may have very little patience, limited working memory, and difficulty sustaining attention. This is a product constraint, not an optional accessibility skin.

## Default-path rules

1. **No memorization required.** If a feature depends on naming, folder structure, syntax, or terminology, show the smallest working example exactly where the action happens.
2. **One decision at a time.** A confirmation screen should surface only the items that need user attention. Correct automatic decisions stay folded.
3. **Failure is repaired in place.** A user should not have to close a dialog, rename files, reread documentation, and restart an import just because auto-detection failed.
4. **Optional means skippable.** Art, voice, advanced rigging, aliases, and compatibility features must never block text-first authoring.
5. **Plain-language recognition comes first.** Technical names such as Face Fit, viseme, lattice, alias, and renderer may appear secondarily, not as the only cue.
6. **Stop when it looks right.** Precision numeric controls belong under Advanced Tools when direct manipulation is sufficient.
7. **Show the next useful action after success.** Do not end a workflow with only counts or internal state.
8. **Protect existing work by default.** Ambiguous guesses, conflicts, and replacements start unchecked and require explicit confirmation.
9. **Never make green paths noisy.** If 20 files are recognized correctly and 2 need attention, the user sees the 2 first.
10. **Pure-text projects remain first-class.** Importing a Log with no art must continue to produce a usable, playable project with placeholders.
11. **Optional stacks need a visible stopping point.** When a workflow can end successfully at multiple levels (placeholder → full standing image → shared face parts → precision fit), the UI must say when the current level is already sufficient instead of implying that every later section is required.

12. **Low-frequency tasks do not own permanent screen space.** Export, diagnostics, compatibility internals, and other terminal tasks should appear as explicit workspaces/panels rather than compete with the main authoring surface all day.
13. **Inspectors follow context.** A property panel should describe the thing the user is currently editing; unrelated inspectors must get out of the way instead of staying visible because their DOM already exists.
14. **Direct manipulation first, exact numbers second.** When a creator can move something visibly (stage position, Face Fit), the canvas/gizmo path is primary and numeric precision is a secondary refinement path.

## Face-material import contract

The face-material workflow must always tell the user that they may simply drag files in without learning naming rules. For users who want reliable auto-detection, show a short recommended six-file naming set next to the picker. Unrecognized files must expose a local “what is this?” selector in the same preview.

The minimum recommended names are:

```text
eyes_open.png
eyes_closed.png
brows.png
pupils.png
mouth_closed.png
mouth_open.png
```

3/4 and extended mouth naming remains optional and folded.
