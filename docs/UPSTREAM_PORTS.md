# Upstream ports and derived components

This file tracks source-level ports/derivations separately from high-level inspiration. Replay Lab is GPL-3.0-only.

## TRPG-Replay-Generator / RplGenStudio

- Upstream: https://github.com/DanDDXuanX/TRPG-Replay-Generator
- License: GPL-3.0
- Revision used for the 0.18–0.21 port passes: `89e65b63c97a74ebff665be038e6dea2a700ec14`

### `src/editor/media-relink.ts`

Derived workflow: `core/GUI_Relocate.py`. RplGen gathers invalid media paths, lets the user choose one directory, walks it recursively, and matches unresolved files by exact filename. Replay Lab ports that workflow into a pure planning/apply layer, then adds explicit `ambiguous` results when duplicate filenames are found instead of silently picking one.

### `src/renderers/easing.ts`

TypeScript adaptation of `core/Formulas.py`: `linear`, `quadratic`, `quadraticR`, `sigmoid`, `right`, `left`, and `sincurve`. Replay Lab evaluates normalized progress directly instead of producing NumPy frame arrays.

### `src/importers/rplgen.ts`

RGL compatibility was already derived from the public grammar/lexer. In 0.18 it additionally maps `<set:tx_method_default>:<...>` and `<set:formula>:...` into Replay Lab text-effect and animation-curve fields. RplGen method durations are frame-oriented; the importer converts text-method frame counts to approximate seconds at 30 fps for Replay Lab's time-based renderer.

No RplGen icons, mascot artwork, bundled fonts, sample media, voice assets, or Steam-only assets are copied.

### `src/renderers/rplgen-motion.ts`

0.19 TypeScript/continuous-time adaptation of `core/Motion.py`. Replay Lab preserves the upstream compound method vocabulary (`replace/delay/cross/black`, `pass/leap/circular/shake*`, direction, scale, and `in/out/both`) while evaluating seconds instead of NumPy frame arrays.

### 0.19 background / Dice / HitPoint compatibility

`src/importers/rplgen.ts`, `src/core/types.ts`, `src/core/compiler.ts`, and `src/renderers/canvas-stage.ts` now preserve and render additional RGL semantics:

- `<background><method=frames>:...` maps to structured background switch method + duration. Replay Lab implements `replace`, `delay`, `cross`, `black`, `white`, `push`, and `cover` in its Canvas renderer.
- Dialogue-leading animation/bubble method tokens such as `[A]<black_pass_up_minor=30>:` map to a structured stage method evaluated by the `Motion.py` port.
- `<dice>:(content,dicemax,check,face),...` maps to structured Dice rolls; `NA` checks remain null.
- `<hitpoint>:(content,hp_max,hp_begin,hp_end)` maps to a structured HP-change event.

The Canvas presentation is Replay Lab's own UI rather than a pixel-for-pixel copy of RplGen built-in animation artwork. No RplGen bundled media are copied.

### 0.20–0.21 MediaDef / Bubble / ChatWindow compatibility

`src/importers/rplgen-mediadef.ts` is derived from the `MediaDef` grammar, media-type parameter tables, and value/instance parsing semantics in upstream `core/ScriptParser.py`. The port normalizes the subset currently useful to Replay Lab (`Text`, `StrokeText`, `RichText`, `Bubble`, `Balloon`, `DynamicBubble`, and `ChatWindow`) into Replay Lab `mediaDefinitions`. Unsupported or not-yet-rendered upstream arguments are preserved in `metadata.rplgen` together with the upstream revision/source line.

`src/importers/rplgen.ts` also maps RGL `<bubble>` commands to structured Bubble events that can reference imported MediaDef definitions. `src/renderers/canvas-stage.ts` implements Replay Lab-owned Canvas presentation for those definitions, scaling RplGen's 1920×1080 coordinate convention into the active canvas. It does **not** copy RplGen visual assets.

0.21 additionally derives the DynamicBubble nine-slice geometry and stretch/collage fit behavior plus ChatWindow rolling-history/sub-bubble/avatar layout from upstream `core/Medias.py`. `Animation` objects referenced by ChatWindow are normalized as Replay Lab image definitions; RichText icon/rich-label behavior and Balloon multi-header targets are mapped into Canvas-native structures. Replay Lab evaluates these semantics with browser Canvas rather than pygame surfaces, and keeps all raw RplGen arguments in `metadata.rplgen` for unsupported edge cases.


## Inochi2D / Inochi Creator

- Upstream: https://github.com/Inochi2D/inochi2d
- License: BSD-2-Clause
- Core revision inspected for the 0.25 port: `ec702261dd6428141bfd0b174a015f8af872d3ed`

### `src/puppet/rig.ts`

0.25 derives the small Replay-specific `Parameter -> Binding -> Part` model from Inochi2D's `Parameter1D` and `ParameterBinding` architecture. Replay Lab keeps continuous scalar parameter values, ordered keyframes and linear interpolation, then applies each binding to a character-part transform, opacity, or deformation field. The port deliberately omits Inochi's full registry/serialization/physics/driver stack.

### `src/puppet/lattice.ts` + Canvas lattice rendering

The regular control-lattice idea is derived from upstream `nodes/deformer/latticedeformer.d`. Replay Lab stores normalized 2D point deltas instead of D/numem vertex buffers, and the browser renderer maps the deformed lattice into affine Canvas triangles. The renderer estimates the non-transparent bounds of each face-part image so mouth/eyebrow deformation operates around the actual part instead of the entire transparent character canvas.

### Studio expression warp editor

The Studio's 3x3 drag grid is Replay Lab UI built on the derived lattice/binding model. An expression warp is represented as a 0..1 parameter with a zero-deformation keypoint and a user-authored deformation keypoint; the expression preset activates that parameter only while the expression is active.


## Replay-owned universal viseme policy (0.27)

`src/lipsync/viseme.ts` keeps the 0.26 English ARPABET table ported from the user's earlier LipSync Studio, then adds a Replay Lab-owned language-agnostic articulatory fallback for IPA/phoneme timing. The universal table is not copied from a new third-party project; it reuses Replay Lab's existing viseme inventory by visible lip/tongue class before the legacy five-vowel/open-closed fallback.
