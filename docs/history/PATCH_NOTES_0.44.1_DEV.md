# Replay Lab 0.44.1-dev — symmetric facing default

- Character art now defaults to the common one-image, manually mirrorable workflow.
- Studio exposes one human-facing checkbox: **这个角色左右不对称**.
- Only asymmetric characters reveal independent left/right art bindings; those swap assets instead of mirroring pixels.
- The old fixed/flippable/paired terminology is no longer exposed in the normal character UI.
- Legacy `fixed` character settings normalize to the new symmetric workflow; existing `paired` characters remain asymmetric.
- Auto layout still never changes facing on its own. Facing changes remain explicit author actions on the visual stage.
- Project schema stays at 0.44 because the persisted fields are compatible; package/UI version is 0.44.1-dev.
