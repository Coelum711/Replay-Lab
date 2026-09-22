# Bundled SoundTouchJS

Bundled packages: `@soundtouchjs/core@2.1.1` and `@soundtouchjs/interpolation-strategy-lanczos@2.1.1`, under MPL-2.0. Original copyright and license notices are retained in the files and each package's LICENSE.

Source and build instructions: https://github.com/cutterbl/SoundTouchJS . The corresponding source packages are `packages/core` and `packages/interpolation-strategy-lanczos` in the 2.1.1 release. The npm package metadata and source maps are included.

Replay Lab modification (2026-09-14): output files copied out of `.dist` to enable offline relative browser imports; the single package import in `interpolationStrategyRegistry.js` is changed to `./lanczos/index.js`. Audio processing code is unchanged. Full MPL text: https://www.mozilla.org/en-US/MPL/2.0/ .
