# Character Identity and Aliases (0.34)

Replay Lab keeps character identity explicit. It does not automatically assume that translated, transliterated, or nickname-like strings refer to the same person.

## Aliases

Each character may store:

```ts
aliases?: string[]
```

Aliases are confirmed alternative/imported names. Name matching normalizes Unicode width, case, whitespace and common punctuation. It does **not** translate between languages.

Examples:

- `Arthur`, `arthur`, `Ａｒｔｈｕｒ` can be suggested as duplicates by normalization.
- `Matthew` and `马修` are not auto-matched. The user confirms that relationship once, after which the removed name is stored as an alias.

## Merge semantics

Studio's **角色身份 / 合并** control asks which character to keep and which character to merge into it. A confirmed merge:

- reassigns `line.speakerId`;
- rewrites manual stage rosters and position keys;
- rewrites Scene enter/exit character ids;
- preserves the removed character name and aliases on the retained character;
- keeps retained-character art/settings when both sides already define the same slot;
- fills empty image/layer/expression/voice slots from the removed character;
- reports conflicts rather than silently overwriting them.

`line.sourceSpeaker` remains the original imported speaker spelling for provenance.

## Face-package routing

Confirmed aliases participate in face-package routing. After merging `Matthew` into `马修`, a future folder named `Matthew/` can resolve to the retained `马修` character. If the same alias belongs to multiple characters, routing becomes unresolved and requires manual correction.

## Text-only projects

Aliases and merging do not require art. Text-only Log/story-script import still creates zero-art characters and can use procedural placeholders exactly as before.
