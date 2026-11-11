# ag-psd 34.1.0

- Source: https://github.com/Agamnentzar/ag-psd (npm `ag-psd@34.1.0`), MIT License (see LICENSE).
- `bundle.js` is copied unmodified from the package's `dist/bundle.js` (UMD; sets `window.agPsd`). It inlines pako (MIT) and base64-js (MIT).
- Replay Lab only reads PSD files, to import a character's outfit / pose layers (`web/psd-body-import.js`). Nothing is written back to PSD.
