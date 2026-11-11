# Third-party notices

Replay Lab is licensed under GPL-3.0-only.

The project intentionally interoperates with and/or adapts ideas or small implementation fragments from these projects:

1. **TRPG-Replay-Generator / RplGenStudio** — DanDDXuanX — GPL-3.0.
   - Source: https://github.com/DanDDXuanX/TRPG-Replay-Generator
   - Upstream revision used for the 0.18–0.21 ports: `89e65b63c97a74ebff665be038e6dea2a700ec14`.
   - `src/importers/rplgen.ts` derives from the public RGL grammar/lexer and now also maps RplGen `tx_method_default` (`all/w2w/l2l/run`) plus animation `formula` settings into Replay Lab's structured data.
   - `src/editor/media-relink.ts` adapts the bulk missing-media relocation workflow from `core/GUI_Relocate.py`: choose one directory, recursively match original filenames, and update unresolved media. Replay Lab adds explicit ambiguity handling for duplicate filenames.
   - `src/renderers/easing.ts` is a TypeScript adaptation of the animation curves in `core/Formulas.py` (`linear`, `quadratic`, `quadraticR`, `sigmoid`, `right`, `left`, `sincurve`).
   - `src/renderers/rplgen-motion.ts` is a TypeScript continuous-time adaptation of `core/Motion.py`, retaining RplGen compound alpha/motion/direction/scale/cut semantics.
   - 0.19 also maps RGL background switch methods and structured Dice/HitPoint command fields into Replay Lab data and renders them with Replay Lab-owned Canvas presentation code.
   - `src/importers/rplgen-mediadef.ts` is a GPL-derived TypeScript compatibility parser based on the `MediaDef` grammar/parameter tables in `core/ScriptParser.py`; it normalizes Text/RichText/Bubble/Balloon/DynamicBubble/ChatWindow definitions while retaining raw upstream arguments for not-yet-implemented details.
   - 0.20–0.21 map RGL `<bubble>` commands and MediaDef dialogue presentation into Replay Lab data. 0.21 further adapts DynamicBubble nine-slice stretch/collage behavior and ChatWindow rolling-history/sub-bubble/avatar semantics from `core/Medias.py`, plus RichText icon/rich-label and Balloon multi-header structures. The Canvas presentation is Replay Lab-owned; no RplGen fonts, bubble images, icons, sample media, or other artwork are copied.
   - The GPL-3.0 text used by both projects is reproduced as `licenses/RplGen-GPL-3.0.txt`.
   - Do not reuse RplGenStudio icons, mascot, name, or other third-party artwork.

2. **KuchiPaku** — Copyright (c) 2022 InuInu — MIT.
   - Source: https://github.com/InuInu2022/KuchiPaku
   - `src/lipsync/viseme.ts` adapts KuchiPaku's phoneme grouping for A/I/U/E/O and open/closed consonants.
   - `src/lipsync/lab.ts` follows its LAB timing model (100 ns ticks and phoneme intervals).
   - Original MIT license is reproduced in `licenses/KuchiPaku-MIT.txt`.

3. **ccfolia-chatlog-formatter** — y-8-m — MIT.
   - Source: https://github.com/y-8-m/ccfolia-chatlog-formatter
   - `src/importers/ccfolia.ts` supports the semantic structure used by the formatter (`.player`, `.speaker-text`, `.player-message`) and classic Cocofolia HTML logs.

4. **VNVE** — Copyright (c) 2023 vnve — MIT.
   - Source: https://github.com/vnve/vnve
   - `src/renderers/vnve.ts` is an adapter against VNVE's public Creator/Scene/Img/Text/Sound API. No VNVE source code is copied into Replay Lab.
   - Original MIT license is reproduced in `licenses/VNVE-MIT.txt`.

5. **Kokoro / kokoro-js** — hexgrad / contributors — Apache-2.0.
   - Source: https://github.com/hexgrad/kokoro
   - Model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
   - `src/tts/kokoro.ts` is an adapter around the public `KokoroTTS.from_pretrained()` / `generate()` / voice catalog API. Replay Lab does not bundle Kokoro model weights in this repository.
   - Kokoro and the published model are Apache-2.0 licensed; downstream app distributions that bundle them must preserve their applicable notices/license terms.

6. **TanStack Virtual Core** — Tanner Linsley / contributors — MIT.
   - Source: https://github.com/TanStack/virtual
   - Version targeted by the 0.23 Studio adapter: `@tanstack/virtual-core` 3.17.9.
   - `web/virtual-script-list.js` is Replay Lab-owned adapter code around TanStack Virtual's public headless API. The static Studio loads the published ESM package on demand for long Logs; bundled applications should install the package normally.
   - Original MIT license is reproduced in `licenses/TanStack-Virtual-MIT.txt`.

7. **Mediabunny** — Vanilagy / contributors — MPL-2.0.
   - Source: https://github.com/Vanilagy/mediabunny
   - Version targeted by the 0.23 browser exporter: `mediabunny` 1.56.0.
   - Replay Lab uses the unmodified public `Output`, `Mp4OutputFormat`, `CanvasSource`, `AudioBufferSource`, `Quality`, `BufferTarget`, and `StreamTarget` APIs for WebCodecs-backed H.264/AAC MP4 creation. No Mediabunny source file is copied or modified in Replay Lab.
   - The MPL-2.0 text is reproduced in `licenses/Mediabunny-MPL-2.0.txt`. If Mediabunny itself is modified in a distributed build, those modified covered files remain subject to MPL-2.0.

8. **Inochi2D / Inochi Creator** — Inochi2D Project / Kitsunebi Games — BSD-2-Clause.
   - Source: https://github.com/Inochi2D/inochi2d and https://github.com/Inochi2D/inochi-creator
   - Revision inspected for the 0.25 puppet port: `ec702261dd6428141bfd0b174a015f8af872d3ed` (core) and current Creator sources inspected alongside it.
   - `src/puppet/rig.ts` adapts the upstream `Parameter1D` / Parameter-Binding architecture into Replay Lab's scalar replay parameters and part-property/deformation bindings.
   - `src/puppet/lattice.ts` and the Canvas puppet renderer adapt the upstream `LatticeDeformer` concept into a normalized regular lattice suitable for transparent browser character layers.
   - Replay Lab does not bundle Inochi models, sample puppets, textures, icons, branding, or other artwork.
   - Original BSD-2-Clause license is reproduced in `licenses/Inochi2D-BSD-2-Clause.txt`.

Keep this file and the relevant license notices when redistributing derived builds.

## Optional MLX clone/instruct companion (0.54.2)

- **mlx-audio** (MIT): https://github.com/Blaizzy/mlx-audio . Installed separately at commit `04839707811dbe2d5cc61e2a425909eb8399dc59`. The new adapter calls its input-assembly and generation methods via a read-through speaker-injection view. No MLX source or weights are bundled in this ZIP.
- **Qwen3-TTS** (Apache-2.0): https://github.com/QwenLM/Qwen3-TTS . Users explicitly download the MLX Community 1.7B Base/CustomVoice conversions. Preserve upstream notices if distributing model weights separately.
- **Voicebox**: https://github.com/jamiepine/voicebox . The companion reads profile metadata and exported sample ZIPs via HTTP; it does not copy or patch Voicebox source.
- The previously discussed third-party C Qwen engine is not included or used by this MLX implementation.


## Desktop runtime (0.55.0)

The desktop distribution bundles Electron 44.3.0 (MIT) and Chromium third-party components. The unmodified runtime LICENSE and LICENSES.chromium.html accompany the Mac application. Build tooling uses @electron/packager 20.3.0. The Replay Lab application and its full corresponding source remain GPL-3.0-only.

## SoundTouchJS 2.1.1

本地语调微调使用 @soundtouchjs/core 2.1.1 与 @soundtouchjs/interpolation-strategy-lanczos 2.1.1（MPL-2.0）。可读 JavaScript、包说明及许可声明位于 web/vendor/soundtouch；来源与唯一导入路径修改见其中 REPLAYLAB-NOTICE.md。

## wasm-media-encoders 0.7.0

导出给 RPG Maker 的 Ogg Vorbis 编码使用 [wasm-media-encoders](https://github.com/arseneyr/wasm-media-encoders) 0.7.0（MIT），其中以 WebAssembly 形式包含 libvorbis / libogg（BSD-3-Clause，Xiph.Org）与 LAME（LGPL，本项目不调用）。未修改的文件与许可证位于 web/vendor/wasm-media-encoders，说明见其中 REPLAYLAB-NOTICE.md。

## 文本 + 能量口型（src/lipsync/text-energy.ts、syllables.ts）

算法移植自用户自己的 Lip Studio（对口型1.0.html）：analyzeAudio（20 ms 窗 / 10 ms 步长 RMS、中位数 × 灵敏度阈值）与 generateTimeline（按有声段时长分配音节、最后一段吃掉剩余音节）。

`src/lipsync/data/zh-vowels.ts` 是每个汉字（U+4E00–U+9FFF）韵母元音的离线表，由 `scripts/lipsync/dump-pinyin.swift`（macOS 自带 ICU 的 Han-Latin/Mandarin 转写）和 `scripts/lipsync/build-zh-vowel-table.mjs` 生成。ICU 的转写数据来自 Unicode Unihan，适用 Unicode License v3（允许再分发，需保留版权声明：Copyright © 1991-2025 Unicode, Inc.）。表里只存每字一个元音字母和一个唇音标记，约 42 KB。
