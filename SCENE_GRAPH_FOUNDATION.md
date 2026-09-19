# Replay Lab Scene Graph Foundation

Replay Lab keeps its text-first project model as the authoring source of truth. The scene graph is derived at compile time so Studio, importers and exporters do not need to maintain a second copy of the project.

```text
SCREEN
├─ WorldSpace (camera affected)
│  ├─ world.background
│  ├─ world.cg
│  ├─ world.characters
│  └─ world.front-fx
├─ ScreenSpace
│  ├─ screen.presentation   (Custom Objects, Dice, Wheel, HP)
│  ├─ screen.dialogue       (textbox/namebox/text)
│  └─ screen.fx             (whole-screen transition/effects)
```

Stable scene node ids are used for future overrides, for example:

```text
background
cg
character:<characterId>
custom-object:<objectId>
system:dice
system:wheel
ui:dialogue
fx:transition
```

`SceneGraphSettings.nodeOverrides` is the future-safe place for per-node layer/space/effect changes. `layerEffects` does the same for a whole layer. Both already normalize and survive project persistence, while 0.48 deliberately leaves visual filter/mask execution for the later GPU renderer.

## Depth convention

World depth is normalized:

```text
0.0 = nearest / foreground
1.0 = farther / background
```

Flat mode ignores depth visually. In 2.5D mode, farther world nodes will be projected smaller/higher and painted before nearer nodes. A separate `zBias` remains available for deliberate artistic overlap corrections.
