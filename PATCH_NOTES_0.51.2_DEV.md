# Replay Lab 0.51.2-dev

## Stage mini preview UX

- Keeps the existing Director Command editor unchanged.
- Adds an automatic read-only mini stage preview in the upper-right when the main preview canvas scrolls out of the visible area.
- The mini preview mirrors the real stage canvas, including playback, 2D/2.5D projection, CG, masks, filters and character state.
- The floating window is resizable with the browser-native bottom-right resize handle.
- It is intentionally read-only: character/camera drag editing remains available only on the main stage.
- The mini preview disappears automatically as soon as the main stage is visible again.

## Director command names

- Added regression coverage confirming character and expression names may be Chinese, e.g. `/expression 王耀 生气` and `/dismiss 王耀`.
- Names containing whitespace still need quotes.
