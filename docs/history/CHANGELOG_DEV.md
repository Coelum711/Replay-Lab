# 0.57.0-dev · 角色整理、摄像机视角与施工台

角色名字设最小宽高并可换行，删除 / 合并直接放在角色区；合并补齐导演指令、转盘和图层引用。视角切换放在预览上方；在场人数、角色名单和镜头控制集中在「施工台 → 演出」。批量语音失败原因显示在角色按钮下方，保存失败保留已生成音频供下载。使用方法见 `CAMERA_WORKBENCH_0.57_CN.md`。

# 0.56.0-dev · 单句语调曲线

新增本地音高微调、实验情绪曲线重录、试听候选与采用后保留旧素材。操作说明见 `PROSODY_0.56_CN.md`。

> **桌面测试版：** 包含 Mac 应用、原生文件对话框、最近工程首页、统一导航和设置界面。使用方法与实测限制见 `DESKTOP_README_CN.md`。

> **0.54.3-dev:** 修复语言与声音继承、跨页工程接续、生成结果过期误写、音频保存与播放耦合。完整检查结果与验证范围见 `AUDIT_0.54.3_CN.md`。

> **0.54.2-dev:** 新增独立本机 MLX 克隆情绪桥后端、启动器与能力检查。普通 Voicebox 克隆保留；实验路径需要 MLX 1.7B Base + CustomVoice，尚未完成 Apple Silicon 真机出声验证。先读 `VOICE_BRIDGE_CN.md`。这版纠正了 0.54.1 只有前端字段、没有可执行后端的缺口。

# Replay Lab

Replay Lab is a text-first TRPG replay compiler. It is intended to sit between messy session logs and multiple render/export backends rather than becoming another miniature Premiere timeline.

The current formal codebase is **0.57.0-dev**. The earlier single-file prototype is preserved at `legacy/replay-lab-v0.7.html` and can still be opened directly in a browser.

**0.53-dev Audio Director:** adds a first-class Ambient channel, semantic Dialogue/Voice/SFX/Ambient/BGM tracks, project Mixer controls, real BGM crossfade, deterministic Voice ducking, per-line Voice/SFX gain and stereo pan, and a shared realtime/offline Master limiter. `Dialogue` and `Voice` remain bound by the existing line id rather than becoming independent editor clips. See `AUDIO_WORKBENCH.md` and `PATCH_NOTES_0.53_DEV.md`.

**0.53.1-dev Simpler Audio UX:** keeps the full Audio Director engine, but the default Workbench now exposes only four practical volume controls plus automatic dialogue ducking and BGM fade. Master/limiter/pan/offset/exact timing are available through the existing `高级工具` switch. See `PATCH_NOTES_0.53.1_DEV.md`.

**0.52-dev Workbench layout:** restructures Studio around a fixed Program Monitor, a resizable bottom Workbench (Performance / Audio / Voice / Animation), and a right Context Inspector (Properties / Check / Publish). Voice waveform peaks are cached in IndexedDB and the selected line can be edited without leaving the main Studio. See `PATCH_NOTES_0.52_DEV.md`.

**0.51.2-dev UI patch:** the 2D / 2.5D projection switch now lives directly in the top-right corner of the preview stage so the mode is visible where it acts. Scene-graph schema remains 0.51.

**0.51-dev** turns Custom Objects into playable story-specific interaction surfaces. Authors can draw and resize state-scoped hotspots directly on object art, assign state/hide/note actions, use inspect/stateful/pan-zoom interaction modes, record an interaction take during playtest, and bake the take back into ordinary `/wait` + `/object ...` Director rows for deterministic MP4 replay. The standalone playable web runtime uses the same interaction controller. See `CUSTOM_OBJECT_INTERACTION.md` and `PATCH_NOTES_0.51_DEV.md`.

**0.50-dev** activates the Scene Graph effect scopes prepared in 0.48: Scene-local ambient/environment lighting, WorldSpace-only filters, final-output filters, per-layer filter presets, node effect stacks, and CG masks (circle/rect/alpha image with reveal/wipe animation). Effects reset at Scene boundaries unless inherited from project defaults, so a night scene does not leak into the next scene. See `LIGHTING_FILTERS_MASKS.md` and `PATCH_NOTES_0.50_DEV.md`.
**0.49-dev** activates the optional 2.5D projection reserved by 0.48. Authors can switch a project between Flat and 2.5D, drag a dedicated near/far handle on character cards, and let depth drive apparent size, convergence toward a horizon, painter ordering and light camera parallax. Flat remains the default for compatibility. Existing custom motions also understand transient `retreat_*` / `approach_*` depth gestures. See `2_5D_STAGE.md` and `PATCH_NOTES_0.49_DEV.md`.

**0.43-dev** makes stage blocking human-first: authors drag and resize character art directly on the stage preview, with light composition snapping, copy/paste/inherit/reset controls, and structured transforms saved internally. Character facing is explicit and safe by default: fixed art is never mirrored automatically, and `/move <Character>` acts as the readable Director timeline bridge for a visually authored placement.

**0.42-dev** adds a scriptable Director Command layer inside the Log timeline. `/expression`, `/enter`, `/dismiss`, `/scene`, `/chapter`, `/bg`, `/cg`, `/bgm`, `/sfx`, `/camera` and `/wait` rows are structured, draggable performance events that bridge the text-first editor to the VN runtime. Director rows survive source-aware Log reimport when their surrounding source lines survive.

**0.41-dev** adds a VN-style Auto Director for stable 1/2/3-person blocking: actors remain in the current Scene, keep left/right continuity, a third entrant prefers center, speaker emphasis is configurable, and the 0.40 recent-speaker algorithm remains available as a compatibility mode.


## Quick start

**Do not open `web/studio.html` directly with `file://`.** Replay Studio uses browser ES modules; many browsers block those imports in direct-file mode, which leaves a page that looks complete but whose JavaScript controls do not work.

Use one of the launchers in the repository root:

- Windows: `START_REPLAY_LAB.bat`
- macOS: `START_REPLAY_LAB.command`
- Linux: `START_REPLAY_LAB.sh`
- Any platform with Python 3: `python3 launch_replay_lab.py`

The launcher serves the project on loopback-only `127.0.0.1` and opens `web/studio.html` over HTTP. `OPEN_REPLAY_LAB.html` and `START_HERE.txt` explain the same requirement if someone opens the archive without reading this README.

Pure-text workflows remain first-class: importing a Log or story script does not require standing art, face templates, or any media assets; characters render as placeholders until art is added.

## Architecture

```text
Log / folder / RGL / Cocofolia
            │
            ▼
       ImporterRegistry
            │
            ▼
       ReplayProject
    ┌───────┼───────────┐
    │       │           │
 assets  characters   lines
            │
            ▼
     PerformanceCompiler
            │
            ▼
   ReplayLabPerformance
       ┌────┼─────────┬──────────┐
       ▼    ▼         ▼          ▼
     VNVE  YMM4    Tyrano     JSON/API
```

The project data model deliberately separates characters, media assets and script lines. This follows the production lesson behind RplGenStudio's MediaDef / CharTable / RplGenLog split, while keeping Replay Lab's own TypeScript format and text-first editing model.

## Implemented now

- **0.53 Audio Director:** Ambient, project mixer, BGM crossfade, deterministic Voice ducking, per-line Voice/SFX gain and pan, Master limiter, and shared realtime/offline audio scheduling. See `AUDIO_WORKBENCH.md`.
- **0.52 Workbench layout:** fixed Program Monitor, collapsible bottom construction Workbench, Dialogue/Voice bound timeline, cached Voice waveforms, inline Voice editing, and Properties/Check/Publish Context Inspector.
- **0.47 visual-presentation foundation:** onion-skin references, fullscreen CG presentation, and reusable stateful Custom Objects.
- **0.48 scene-graph foundation:** compiles all visual presentation into explicit WorldSpace/ScreenSpace layers and stable nodes, reserves normalized depth, and persists future filter/mask scopes while keeping flat rendering compatible.
- **0.51 Custom Object interaction:** direct hotspot authoring, inspect/stateful/pan-zoom playback, state-scoped hotspot actions, interaction takes, and baking takes back to linear Director commands for video replay. See `CUSTOM_OBJECT_INTERACTION.md`.
- **0.50 scoped visual effects:** Scene-local ambient lighting, node/layer/world/output filters, and CG masks/reveals. See `LIGHTING_FILTERS_MASKS.md`.
- **0.49 optional 2.5D stage:** activates depth projection for WorldSpace sprites: direct near/far manipulation, perspective scale/convergence, far-to-near painter ordering and camera parallax while ScreenSpace dialogue/overlays stay fixed. See `2_5D_STAGE.md`.
- **0.36 direct-manipulation + voice-lifecycle pass:** the main stage preview can directly add/remove actors and drag them between left/center/right slots without first translating the task into Inspector fields. Voice model loading/synthesis no longer dies when the normal “return to Studio” action is used; persisted generated audio can be downloaded after session cache loss, and a connection check distinguishes module/model-source failures from local runtime failures. See `docs/ENGINEERING_UX_AUDIT_0.36.md`.
- **0.37 engineering + human-use hardening:** Studio and Voice now use optimistic manifest conflict detection so two windows cannot silently overwrite each other; conflict states pause saving and offer an in-place reload path. Studio demotes workspace setup to an optional save-location disclosure, character merge confirmation previews affected dialogue/stage references/conflicts, and direct stage DOM wiring has moved into its own controller. See `docs/ENGINEERING_UX_AUDIT_0.37.md`.
- **0.38 safe identity + revised-script reimport:** character-name resolution now refuses ambiguous aliases instead of routing dialogue by array order; exact primary names beat aliases. Pasted/story/Log-file reimports default to replacing only the script while preserving existing characters, art, Face Fit/templates, voices, accents, assets and project settings, and remain undoable. Character merge also rewrites generated-voice identity metadata and surfaces pause/role/stage conflicts in creator-facing language. See `docs/ENGINEERING_UX_AUDIT_0.38.md`.
- **0.39 engineering / human-use hardening:** character authoring continues to split large interaction lifecycles into dedicated controllers, while character merge now has a pure `planCharacterMerge()` preview before mutation. Merge previews show dialogue/stage impact, settings that will be filled, and grouped conflicts that keep the target version. Default project diagnostics no longer treat valid no-art placeholder characters as problems, and revised-script reimport explicitly reports old characters retained only to protect their art/voice setup. See `docs/ENGINEERING_UX_AUDIT_0.39.md`.
- **0.39 character-authoring audit + controller split:** the remaining Face Fit direct-manipulation and character speech/accent DOM lifecycles are now isolated in dedicated page controllers instead of living inside the main Studio orchestrator. Character setup also shows state-dependent “stop here if it already looks right” guidance: zero-art characters remain immediately usable, a complete standing image needs no face rig, and Face Fit is only suggested when shared facial parts are actually in use. See `docs/ENGINEERING_UX_AUDIT_0.39.md`.
- **0.40 mature-editor coordination / workbench pass:** review against Inky, Godot, Twine, Yarn Spinner and Ren'Py makes **制作** the default task workspace, keeps **舞台** distraction-free, and moves **输出 / 检查** into an explicit low-frequency workspace. The line Inspector is contextual, concrete diagnostics jump to their repair target, retained production-only characters can be hidden without deletion, and project-shape compatibility is centralized in core `normalizeReplayProject()`. Graph editing is deliberately deferred until real choice/jump/state semantics exist. See `docs/ENGINEERING_UX_AUDIT_0.40.md`.

- **0.35 low-attention UX pass:** face-material import now teaches the minimum working names in place, lets unrecognized files be repaired without restarting, hides already-correct auto-bind results, folds technical numeric controls and optional voice/rig detail, and keeps pure-text placeholder authoring explicitly first-class. See `docs/LOW_ATTENTION_UX_STANDARD.md`.

- Plain / QQ-style text log importer.
- Cocofolia HTML importer, including the semantic `.speaker-text` + `.player-message` structure used by ccfolia-chatlog-formatter.
- RplGen `.rgl` compatibility importer for dialogue plus common scene commands such as background, BGM and dice.
- Generic JSON chat-log importer.
- Virtual-folder importer that creates chapters per log file and indexes image/audio assets.
- Scene-state compiler: inherited background / CG / BGM, character enter/exit, expressions, stage positions, camera and transitions.
- LAB parser and sentence segmentation.
- A/I/U/E/O + open/closed consonant mapping adapted from KuchiPaku.
- Rhubarb mouth-cue JSON parser.
- RMS/VAD fallback mouth cues from the legacy Replay Lab lip-sync prototype.
- Visual lead/"mouth ahead" support; default 66 ms.
- Built-in presentation templates: Visual Novel, Yukkuri TRPG and Horror Investigation.
- YMM4-style dialogue text, CSV, TyranoScript and compiled Performance JSON exporters.
- Translation provider, TTS provider and plugin registries.
- Built-in `replaylab-free` TTS provider backed by local Kokoro (`kokoro-js`) for the currently supported browser voices: WebGPU when available, WASM fallback, exportable WAV output.
- Modular Voice Workbench: explicit model-load button/progress, free voice picker, per-voice preview, current-line synth/play/download, one-click per-character speech generation, and optional persistence into a real project workspace.
- Structure-safe Chapter/Scene editing: effective group rename, split-at-line, merge-with-previous, cross-Chapter Scene moves, and marker-safe line drag/delete/duplicate so document reordering cannot silently destroy outline boundaries.
- **0.18 structural completion:** whole Scene/Chapter duplicate/delete, plus RplGen-style bulk missing-media relocation from one recursively searched folder with duplicate-filename conflict reporting.
- **0.18 directing port:** RplGen-compatible text reveal modes (`all/w2w/l2l/run`) and the upstream animation curve family (`linear/quadratic/quadraticR/sigmoid/right/left/sincurve`) are represented in ReplayProject/PerformanceDocument and rendered by the Canvas stage. RGL `<set:tx_method_default>` and `<set:formula>` import into these fields.
- **0.19 motion/event port:** RplGen background switch methods (`replace/delay/cross/black/white/push/cover`), compound `MotionMethod` stage transitions (`pass/leap/shake/circular`, directions, scales, in/out/both), and structured `<dice>` / `<hitpoint>` events now survive import, compile into PerformanceDocument, and render in the Canvas stage.
- **0.20 MediaDef/Bubble port:** RplGen `MediaObject.txt` files are detected as media-definition sources rather than ordinary logs. `Text`, `StrokeText`, `RichText`, `Bubble`, `Balloon`, `DynamicBubble`, and `ChatWindow` definitions are normalized into reusable `mediaDefinitions`; RGL `<bubble>` commands and ordinary dialogue can reference those definitions, and the Canvas renderer provides a compatible dialogue/bubble presentation with raw upstream parameters preserved for later fidelity upgrades.
- **0.21 MediaDef fidelity pass:** RplGen `Animation` avatar definitions used by ChatWindow are imported as image media definitions; ChatWindow now keeps `sub_key → sub_Bubble / sub_Anime / sub_align`, renders same-scene history bottom-up with avatar lanes, and clips older records when the message region fills. DynamicBubble uses the upstream 9-slice `mt_pos/mt_end` model with stretch/collage and fit-axis behavior. Balloon multi-header targets and RichText `[key]` icon substitution plus core rich labels render through the main Canvas path.
- **0.22 human-factors / progressive-disclosure pass:** Studio now starts empty instead of silently parsing demo content, exposes an explicit first-task path, hides irrelevant Bubble/Dice/HP editors by line type, moves asset importing back into the Asset view, turns multi-select checkboxes into an explicit batch mode, folds scene/stage/structure/display controls with recognition-oriented summaries, hides MediaDef/debug internals behind an Advanced Tools switch, protects project-replacing imports, and removes developer-roadmap/compiled-JSON noise from the default editing surface. Voice Workbench is likewise task-focused: no auto demo, accents are per-character disclosures, test Log/workspace/translation/debug JSON are secondary. See `docs/UX_AUDIT.md`.
- **0.23 interaction + long-project pass:** desktop columns are resizable and remember their widths; Edit Focus and Stage Focus modes reduce competing panels; the character editor is master-detail with name/type filtering; long scripts switch to a TanStack Virtual Core adapter instead of creating every line DOM node. Static/offline builds retain a full-DOM fallback.
- **0.23 fast video export:** the primary browser render path is now deterministic offline MP4 via Mediabunny + WebCodecs (H.264/AAC), with selectable bitrate presets, estimated output size, progress, cancellation, 10-second offline audio-mix chunks, and direct streaming to a connected workspace / File System Access writable. The older Canvas captureStream + MediaRecorder WebM path remains as a real-time compatibility fallback. See `docs/VIDEO_EXPORT.md`.
- **0.24 content navigation + layered characters:** the Script / Characters / Assets / Styles tabs now share one explicit view state machine and tear down long-Log virtualization when leaving Script, fixing hidden-viewport tab failures. Characters can be authored as composable base / eyes / mouth / expression-overlay layers, with per-expression layer inheritance. Characters with no art automatically render as named rectangular placeholders with procedural blinking and mouth movement, so Log import never depends on finished art. Legacy whole-frame IDLE / OPEN / BLINK slots remain available under advanced compatibility UI.
- **0.25 lightweight puppet rig:** portrait, bust, half-body and full-body art now share one normalized puppet canvas with stage anchor / scale / offset controls. Layered characters can split eyelids, pupils, brows and mouth, and use an Inochi2D-inspired `Parameter → Binding → Part` rig with expression presets. A minimal 3×3 lattice deformation path lets an expression pull mouth / eyes / brows / eyelids / pupils / overlays without requiring a separate full replacement image; automatic blink and viseme drivers feed the same parameter system. Legacy whole-frame sprites and zero-art placeholders remain compatible.
- **0.26 English phoneme mouths:** Replay Lab ports the compact English viseme inventory from the user’s earlier LipSync Studio: A/I/U/E/O plus optional `ə / æ / ʊ / ɔ / w / f-v / th-dh / m-b-p`. ARPABET stress-marked tokens map directly into timed mouth cues; dedicated English mouth layers are optional and preserve the old tool’s nearest-base fallback when absent. TTS providers that return phoneme timing now automatically populate `line.mouthCues` using the resolved spoken language.
- **0.27 universal phoneme fallback:** when a spoken language has no dedicated mouth resolver, IPA / phoneme timing is first classified by visible articulation into the same compact extended visemes (`M/B/P`, `F/V`, `TH/DH`, `W`, `SCHWA`, `AE`, `UU`, `OO`) before falling back to A/I/U/E/O and finally OPEN/CLOSED. This does not pronounce text "as English"; it only reuses the closest available mouth artwork. Language-less legacy LAB files keep their previous mapping unless a token is unambiguously IPA. See `docs/LIPSYNC_UNIVERSAL.md`.
- **0.28 playable VN runtime:** Studio can play the compiled Replay directly from the current line, current Scene, or beginning with manual advance, AUTO, SKIP, backlog and restart. The playtest and the published web player use the same `CanvasStageRenderer` / Puppet path as video rendering rather than a second VN renderer. Connected filesystem projects can publish a self-contained static-web folder under `exports/`. See `docs/VN_RUNTIME.md`.
- **0.28 story-script + wheel history interoperability:** prose/VN-like scripts can declare `当前场景：` and `角色：` while keeping bare narration and `【动作】` lines; the importer converts them without forcing authors into chat-log syntax first. Full JSON archives from the companion relationship/event wheel can be appended as deterministic `wheel` performances: recorded single, pair, party and relation-wheel results animate back to the historical result, with multi-person draws revealed one by one. See `docs/WHEEL_HISTORY.md`.
- **0.29 shared face templates + Face Fit:** character editing can now split reusable eyes / eyelids / pupils / brows / mouth art away from any one base portrait. A shared face template can be created directly from a character, referenced by multiple characters, and lightly projected with per-feature Face Fit controls plus front / left-3/4 / right-3/4 orientation presets. Characters still keep their own override layers, so a template can provide the common face language while each role selectively replaces parts. See `docs/FACE_TEMPLATES.md`.
- **0.30 split-face perspective fit:** shared templates may optionally provide separate screen-left / screen-right eye, eyelid, pupil and brow assets. When both sides exist, Face Fit projects them independently and applies a light 3/4 preset: the far side moves toward the face centre and compresses while the near side remains fuller. Combined two-eye/two-brow assets remain the fallback, so old templates do not need rebuilding. The Studio preview exposes separate draggable left/right nodes and character-local side overrides.
- **0.31 face-template auto assembly:** shared face art can be selected or dropped in batches and classified from flat filenames or folder structure into eyes / eyelids / pupils / brows / A-I-U-E-O and extended mouth slots, including split screen-left/right parts. The Studio previews every proposed binding first; same-slot conflicts require an explicit choice, unknown files are skipped, and an existing template slot is never pre-selected for replacement. Folder selection preserves relative paths for conventions such as `eyes/left/open.png`. See `docs/FACE_TEMPLATES.md`.
- **0.32 project-level face package routing:** an entire face-art package can be imported from the Characters view and routed in one preview: `common/shared/template` directories become shared-template candidates, exact existing-character directory names (or exact `CharacterName_...` filename prefixes) become character-local overrides, and anything ambiguous remains unresolved until the user chooses a target. Shared art defaults to a new template, existing slots are protected from silent replacement, and the resulting template can be assigned automatically to the characters touched by the same package. See `docs/FACE_TEMPLATES.md`.
- **0.33 full character-package initialization + no-art compatibility:** project-level character packages can now recognize role standing/base art (`base`, `portrait`, `standing`, `idle`, `立绘`, `底图`) in addition to facial parts. Explicit new role directories such as `faces/Matthew/base.png` are proposed as new characters and are only created when the user applies that package. Base art never enters a shared face template. Text/QQ/RGL/story-script imports remain completely art-optional: they still create zero-asset characters and render procedural placeholders until art is added later. See `docs/FACE_TEMPLATES.md`.
- Spoken-language policy: per-line override > character default language > Log language.
- Searchable Accent Catalog under each character language slot, including region aliases (e.g. London/伦敦, Texas/德州, India/印度).
- Accent profiles carry collapsible pronunciation, prosody and optional regional-vocabulary rules; they are descriptive tendencies, not stereotypes or deterministic rewrites.
- Accent intent can be resolved independently from TTS voice support, with native / approximate / locale-fallback matching semantics.
- Translation cache keeps visible Log text untouched while storing a separate spoken text.
- Batch `prepareProjectSpeech()` for one-click translate → TTS preparation with bounded concurrency.
- Deterministic audio priority: imported line audio > explicitly bound external TTS voice > Replay Lab Free.
- LibreTranslate-compatible translation adapter (endpoint is configurable; no public server/key is hard-coded).
- VNVE adapter against the public `Creator / Scene / Img / Text / Sound` API. VNVE itself is not bundled.
- v0.7 project migration helper.
- Asset-binding suggestions for numbered voice files and character `idle/open/blink` assets.
- Canonical project workspace with `project.replaylab.json` plus real `assets/`, `cache/` and `exports/` directories. Chrome/Edge can use the File System Access API to write directly to a chosen folder.
- Generated TTS can be persisted as a real voice `MediaAsset` under `assets/voice/generated/<character>/<lineId>.wav`; regeneration overwrites the same generated asset while user-imported audio still wins.
- New modular **Replay Studio** page for the product core: Log/folder import, script list/editing, character visual slots, asset library, scene state editing, compiled stage preview and YMM/CSV/Tyrano/Performance export.
- **0.14 real Canvas stage renderer:** directly renders `PerformanceDocument` state with background/CG, 1–3 actors, inherited expressions, left/center/right staging, speaker focus/dimming, IDLE/OPEN/BLINK and optional A/I/U/E/O mouth frames, dice cards, narration/system cards, push/shake/focus camera effects and fade transitions.
- Browser playback uses the same renderer plus decoded project voice/SFX/BGM assets. `play line`, `play all`, seek and stop are wired into Studio.
- Fast MP4 final render uses the same Canvas renderer but advances it deterministically off the wall clock, feeds frames to Mediabunny/WebCodecs, and muxes H.264/AAC to MP4. Connected workspaces can stream bytes directly to `exports/` instead of accumulating the final movie in RAM. Real-time MediaRecorder WebM remains available as a compatibility fallback.
- Studio scene inspector now exposes expression, mouth mode, duration, SFX, inherited/set/clear BG/CG/BGM, manual roster, per-actor positions and explicit enter/exit events.
- Character editor now exposes IDLE/OPEN/BLINK, optional A/I/U/E/O, and named expression image sets.
- **0.15 long-project editing baseline:** undo/redo history with typing coalescing, script search, multi-select, batch speaker/type changes, Chapter/Scene folding, performance-setting copy/paste, reusable directing presets, and project diagnostics.
- **0.16 document reordering + crash recovery:** draggable single/multi-line script rows, Alt+Arrow keyboard moves, Scene/Chapter block moves, a framework-neutral `ScriptRenderRow` layer ready for a real virtualizer, and IndexedDB project-JSON recovery for temporary sessions.
- Asset library now supports explicit relinking/removal; choosing a workspace after a temporary import migrates in-memory asset files into the canonical project material directories.
- Long scripts are flattened into framework-neutral `ScriptRenderRow` data and, from 0.23, rendered through a thin TanStack Virtual Core adapter once the visible row count crosses the long-Log threshold. This keeps Chapter/Scene folding, search, selection and drag semantics in Replay Lab core while delegating viewport virtualization to the upstream library. If the static CDN dependency is unavailable, Studio falls back to the full DOM plus `content-visibility`.

## MediaDef / dialogue presentation (0.21–0.22)

RplGen projects can keep reusable presentation objects separate from the Log. Replay Lab now mirrors that production model with a `mediaDefinitions` collection instead of copying Bubble/Text settings onto every line. Folder import recognizes a RplGen-style `MediaObject.txt`, imports supported definitions, then allows RGL `<bubble>` commands or ordinary dialogue lines to reference them by id.

Current normalized types are `Text`, `StrokeText`, `RichText`, `Bubble`, `Balloon`, `DynamicBubble`, and `ChatWindow`. RplGen's 1920×1080 coordinates are scaled to the active Replay Lab canvas. When a referenced Bubble background image is unavailable, the renderer falls back to a neutral panel while retaining the original path/arguments for relinking.

0.21 substantially closes the previous fidelity gap: RichText understands the core RplGen rich labels and `[key]` icon substitution, Balloon preserves and renders multiple header slots/targets, DynamicBubble uses the upstream nine-slice geometry with `stretch` or `collage` fill and free/vertical/horizontal fit axes, and ChatWindow renders rolling same-scene history using participant-specific sub-bubbles, avatars and left/right alignment. Remaining differences are deliberate browser/Canvas adaptations rather than a claim of pixel-identical pygame output; unsupported raw arguments remain in `metadata.rplgen`. No RplGen fonts, icons, sample PNGs, or other artwork are bundled.

## Build and tests

```bash
npm install
npm run build
npm test
```

The core can still parse/compile without browser media or TTS runtimes. `kokoro-js`, `@tanstack/virtual-core`, and `mediabunny` are optional runtime dependencies used respectively by local TTS, long-Log virtualization, and fast MP4 export. The static workbench loads published ESM builds on demand; a bundled app should install/pin them normally. TypeScript is the dev dependency. The VNVE renderer remains an optional adapter; install/provide `@vnve/core` when using it.

## Minimal API

```ts
import {
  TextImporter,
  compilePerformance,
  exportYmmScript
} from 'replay-lab';

const project = TextImporter.parse(`Arthur: Hello\nKP: Roll Spot Hidden.`);
const performance = compilePerformance(project);
console.log(exportYmmScript(project));
```


## Replay Studio renderer (0.14–0.16)

The modular Studio no longer uses placeholder actor boxes. `compilePerformance(project)` is the single source of truth for both preview and finished WebM rendering.

```text
ReplayProject
   ↓ compile
PerformanceDocument
   ├─ CanvasStageRenderer → interactive preview
   └─ BrowserReplayPlayer → audio scheduling + WebM capture
```

The renderer resolves asset ids through the active project workspace/session files. Character frame selection is deterministic: precise A/I/U/E/O when available, otherwise OPEN, otherwise IDLE; BLINK can override the current expression set. A timed mouth cue has priority, with lightweight pseudo-mouth animation as the visual fallback when no cue exists.

Generated/imported voice asset duration metadata is now used by the compiler when a line has automatic duration, so rendered timing follows persisted speech instead of always using text-length estimation.

Current WebM export is intentionally a compatibility fallback rather than the final long-project architecture: it records in real time through MediaRecorder. VNVE/WebCodecs remains the candidate for faster deterministic long-form rendering after real-world validation.

## Script ordering and crash recovery (0.16)

Replay Lab treats script ordering as document editing, not timeline editing. Rows can be dragged before another line; dragging a member of a multi-selection moves the selection as one packed block. `Alt+ArrowUp/Down` performs one-row keyboard moves, while `Alt+Shift+ArrowUp/Down` moves the current Scene among sibling Scenes. Chapter/Scene headers also expose explicit block up/down controls.

Temporary-project recovery uses a small standards-only IndexedDB store for `ReplayProject` JSON snapshots. It deliberately does **not** duplicate image/audio/video blobs into IndexedDB. Canonical directory projects remain `project.replaylab.json + assets/`; a recovered temporary project may therefore require reconnecting its original project folder or relinking session-only files. This persistence interface is intentionally isolated so the browser app can move to Dexie when the bundled Studio shell is introduced.

The script UI now consumes `buildScriptRenderRows()` rather than rebuilding Chapter/Scene grouping directly in DOM code. That row model is the seam for `@tanstack/virtual-core`; until the dependency can be installed/bundled, `content-visibility` remains the fallback rather than shipping an imitation virtualizer.

## Display text vs spoken text

Replay Lab treats the imported Log as the canonical visible script. Translation never overwrites `ReplayLine.text`.

Language resolution is deterministic:

```text
per-line speech.languageOverride
        ↓ if empty
character speech.defaultLanguage
        ↓ if empty
project settings.logLanguage
```

Example: a Chinese Log may stay on screen while Arthur speaks English and Francis speaks French. A single Arthur line can override to Japanese without changing either the character default or the subtitle.

```ts
project.settings.logLanguage = 'zh-CN';
arthur.speech.defaultLanguage = 'en-GB';
francis.speech.defaultLanguage = 'fr-FR';
project.lines[12].speech.languageOverride = 'ja-JP';
```

The asynchronous speech pipeline is:

```text
visible Log text
   ↓
resolve target language
   ↓
translate only when needed
   ↓
cache spoken text separately
   ↓
TtsProvider
   ↓
audio + optional phoneme timing
   ↓
viseme mapper / lip sync
```

If a line has a manual `speech.textOverride`, it is treated as the final spoken text and automatic translation is bypassed. Translation caches are keyed by source text + source language + target language + translation-style fingerprint. Editing the Log, changing target language, or enabling accent-specific regional vocabulary invalidates the cache automatically.

`LibreTranslateProvider` supports any LibreTranslate-compatible endpoint, including a local/self-hosted server. The core deliberately does not hard-code a third-party public endpoint.

## Built-in free TTS and voice override priority

Replay Lab 0.14 defaults new projects to `replaylab-free`, a local Kokoro-backed TTS provider. It is intended to make a complete replay possible without requiring a paid TTS account.

Audio-source priority is explicit:

```text
line.audioAssetId (user-imported/generated audio)
        >
voice preset with an external provider id
        >
character-level external TTS provider
        >
Replay Lab Free (`replaylab-free`)
```

Replay Lab never silently falls back from an explicitly configured external voice to another voice. If a user bound `provider=elevenlabs, voiceId=arthur-v3` and that provider is unavailable, synthesis fails visibly. Silent fallback is only used when no external voice was requested.

### Replay Lab Free

`ReplayLabFreeTtsProvider` uses Kokoro through the optional `kokoro-js` package. The provider:

- runs on the user's device;
- prefers WebGPU when available and falls back to WASM;
- produces exportable WAV audio rather than preview-only browser speech;
- loads the model lazily on first synthesis;
- can enumerate the voices exposed by the installed Kokoro model;
- chooses a voice matching the requested spoken language when no voice id is pinned;
- accepts a user-selected built-in `voiceId` when the user wants a specific free voice.

**Current browser-engine coverage:** the upstream `kokoro-js` voice catalog currently exposes American and British English voices (`en-US` / `en-GB`) in its working browser phonemizer path. Replay Lab therefore declares only those locales as supported by this specific built-in engine. Other languages must use another local/external provider until an additional free engine is installed/implemented. The intended architecture is a Replay Lab Free engine pool, not "Kokoro for every language".

The next free-engine candidate is sherpa-onnx WebAssembly: its TTS runtime can be compiled for the browser and its published VITS/Piper model catalog covers many languages, including Chinese. It should be added as a separate engine/provider rather than pretending unsupported Kokoro voices work.

App distributions that expose the built-in provider should bundle/install the optional dependency:

```bash
npm install kokoro-js
```

The Kokoro model artifacts are not embedded in Replay Lab source. A normal web build downloads model/voice files on first use and lets the browser/runtime cache them. Applications may later ship their own model cache or offline installer.

### External / user-owned TTS

External voices are bindings, not a Replay Lab voice marketplace. A language slot can store:

```ts
character.speech.voices['en-GB'] = {
  provider: 'my-tts-provider',
  voiceId: 'arthur-v3',
  rate: 1.02
};
```

The provider can be a community plugin, a local HTTP service, or a paid cloud adapter. Replay Lab does not require the provider to support the Accent Catalog. Accent metadata remains a separate character-language intent and is passed to providers only when they can use it.

### Imported audio

Imported/generated audio is the highest-priority source. A user can synthesize a character in any other application and bind the resulting file to a line or import a numbered voice folder. Once `line.audioAssetId` exists, `prepareLineSpeech(..., { synthesize: true })` does not call any TTS provider for that line.


## Project workspace and material directory

0.13 introduced a canonical on-disk project workspace instead of serializing large media as base64 inside project JSON.

```text
MyReplay/
├─ project.replaylab.json
├─ assets/
│  ├─ characters/
│  ├─ backgrounds/
│  ├─ cg/
│  ├─ bgm/
│  ├─ sfx/
│  └─ voice/
│     ├─ imported/
│     └─ generated/
├─ cache/
└─ exports/
```

`ProjectWorkspace` is an abstraction. `BrowserFileSystemWorkspace` writes to a user-selected local directory through the File System Access API, while `MemoryProjectWorkspace` provides a deterministic implementation for tests and non-persistent runtimes.

When TTS is generated with a connected workspace, `persistGeneratedSpeech()` writes the WAV/audio file into `assets/voice/generated/`, creates or updates the matching `MediaAsset`, sets `line.audioAssetId`, and saves `project.replaylab.json`. Regenerating Replay-Lab-generated audio overwrites the same line asset. User-imported audio remains protected by the normal audio-priority rule.

Media records use `project://...` URIs plus `sourcePath`, so core project data stays portable and renderers can resolve the actual bytes through the workspace rather than depending on absolute machine paths.

## Accent identity

Accent is a layer below language and above provider-specific voice selection. A character may have an accent intent per spoken language:

```ts
arthur.speech.defaultLanguage = 'en-GB';
arthur.speech.accents = {
  'en-GB': {
    accentId: 'en-gb-southern-british',
    query: 'London',
    strength: 'natural',
    useRegionalVocabulary: false
  }
};
```

The built-in catalog currently seeds a set of English profiles such as Southern British/London-adjacent, RP, Estuary, Cockney, General American, NYC, Southern US, Texas, Boston, Indian English, Australian, Canadian, Irish and Singapore English. Search uses human aliases and region tags, including Chinese aliases. The catalog is intentionally extensible rather than exhaustive.

Each profile separates:

- pronunciation tendencies;
- prosody intent;
- optional regional lexical preferences.

The advanced rules are primarily machine/provider hints and expert-facing documentation. They are not applied as caricatured spelling replacements. Native or region-tagged voices should take precedence whenever available.

`matchVoiceAccent()` distinguishes exact catalog support, approximate tag support and locale fallback. `TtsRequest.accent` carries the resolved intent to providers that can use it. Providers that cannot use accent metadata may ignore it safely.

Regional vocabulary is opt-in because it changes wording rather than merely pronunciation. When enabled, compatible translation providers receive an accent translation hint; literal providers such as LibreTranslate may ignore it.

## Workbench voice generation

The modular browser workbench now keeps model loading explicit. It does not silently download TTS assets when the page opens.

```text
Load Replay Lab Free
    ↓
model/runtime progress
    ↓
list free voices for the character language
    ↓
preview voice
    ↓
generate current line OR generate all lines for one character
```

Generated audio can still be previewed in a browser-session cache, but when a project workspace is connected it is persisted as a real `MediaAsset` under `assets/voice/generated/` and referenced by `audioAssetId`. It is never serialized as giant base64 audio inside project JSON. Changing the line text, language, accent, translation style or voice invalidates the relevant generated result.

If a character binds an external provider id, the workbench will not silently fall back to Replay Lab Free when that provider is unavailable. External provider plugins/connectors must actually be registered before synthesis.

## Lip sync tiers

Replay Lab treats mouth animation as derived data, never as the primary editing timeline.

1. TTS provider returns phoneme timing → map directly to visemes.
2. Uploaded audio + external forced alignment → import LAB/Rhubarb timing.
3. Audio only → RMS/VAD OPEN/CLOSED fallback.
4. No audio → renderer may use a lightweight pseudo-mouth preview.

Characters can provide only `idle + open`, five-vowel A/I/U/E/O images, or a later full viseme set without changing the script model.

## Licensing

Replay Lab is **GPL-3.0-only**. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

This choice is intentional: the project may directly interoperate with or adapt GPL-licensed RplGen work while remaining free for the TRPG community. MIT-derived parts retain their attribution notices.

Do not copy RplGenStudio commercial artwork, icon, mascot, Steam Workshop assets, proprietary voice resources, or other assets that are not covered by the source license.

## Next engineering milestones

The detailed product audit is in `docs/CORE_PRODUCT_AUDIT.md`; the interface/human-factors review is in `docs/UX_AUDIT.md`. After 0.23, development remains focused to the Replay-making core rather than expanding voice/accent features.

1. Move the Studio to a bundled application shell and replace the interim script DOM with `@tanstack/virtual-core` for truly large Logs. Use the upstream package directly rather than reproducing its virtualizer.
2. Deepen the now-structure-safe outline editor with explicit Scene insertion position, Chapter creation without an existing line, and stronger tree-level batch operations.
3. Replace the small standards-only recovery backend with Dexie once bundling is available; keep the real filesystem workspace as the durable project model.
4. Validate a reliable finished-video render path (VNVE/WebCodecs first, Canvas/MediaRecorder fallback) on hour-scale Replay projects.
5. Deepen Replay-specific automation: richer dice presentation, common bot/log semantics and community directing presets. Return to extra voice/accent work only after that.

## Modular browser workbench

After building, serve the repository root over HTTP:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/web/studio.html` for the Replay Studio, or `http://localhost:8080/web/` for the Voice Workbench. Studio is now the main product surface; Voice Workbench is intentionally an advanced subsystem page.
