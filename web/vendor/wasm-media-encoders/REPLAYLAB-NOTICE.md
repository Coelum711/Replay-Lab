# wasm-media-encoders 0.7.0

- Source: https://github.com/arseneyr/wasm-media-encoders (npm `wasm-media-encoders@0.7.0`), MIT License (see LICENSE).
- Bundles libvorbis/libogg (BSD-3-Clause, Xiph.Org) and LAME (LGPL) compiled to WebAssembly, inlined in `index.mjs`.
- Copied unmodified from `dist/esnext/index.mjs` (renamed to `index.js` so every local server serves it as JavaScript). Replay Lab only uses the Ogg Vorbis encoder, to export voice takes that RPG Maker MZ's `vorbisdecoder.js` can play.
