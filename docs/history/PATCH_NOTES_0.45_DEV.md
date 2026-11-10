# Replay Lab 0.45-dev — Director Beats & persistent visual state

## Why

0.42–0.44 made director commands, direct stage manipulation and camera framing editable, but the authoring model still exposed every command as an isolated row and ordinary imported lines effectively reset expressions to `default`. 0.45 makes the runtime behave more like a mature VN: changes are grouped into readable beats and character visual state persists until explicitly changed.

## Director Beats

- Consecutive `/command` rows derive one `DirectorBeat`.
- Beat derivation does **not** replace or duplicate source rows. Commands remain draggable and editable.
- The Studio timeline shows a collapsible `演出 ×N` row. Collapsing hides only the command details; the following dialogue remains visible.
- Compiled Performance JSON includes `directorBeats` and each line exposes `directorBeatId`.
- VN auto-blocking entries/moves/exits are materialized as `auto-blocking` beat changes so the automatic director is inspectable rather than completely hidden.
- Existing `stageMethod` / RplGen custom actions are surfaced as `motion` beat changes. Replay Lab does not recreate the motion editor.

## Persistent CharacterVisualState

`PerformanceState.characterVisuals` tracks each character independently:

- expression
- semantic stage position
- direct-manipulation transform
- facing
- current/transient motion label

Changing expression no longer replaces placement/facing state, and changing blocking no longer resets the expression.

## Expression inertia

Lines now distinguish:

- `expressionMode: inherit` — keep the character's previous expression;
- `expressionMode: set` — explicitly apply the selected expression, including an intentional reset to `default`.

New/imported ordinary dialogue inherits by default. The Studio expression selector now includes `继承上一表情`. Legacy non-default expressions migrate as explicit settings; legacy default expressions migrate as inherited state.

Reimport and performance copy/paste preserve `expressionMode`, including an explicit `default` reset.

## Compatibility

- Project/performance schema version: `0.45`.
- Existing 0.44 stage/camera transforms, asymmetric left/right art, punctuation timing and director commands remain supported.
- Existing RplGen motion methods remain the motion implementation; 0.45 only makes their orchestration visible to Beats.
