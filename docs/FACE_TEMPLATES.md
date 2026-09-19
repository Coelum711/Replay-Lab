# Shared Face Templates (0.29)

Replay Lab 0.29 adds a lightweight reusable-face layer on top of the existing layered-character system.

## What it is

A **face template** stores reusable facial-part assets:

- eyes (open / closed)
- eyelids (open / closed)
- pupils
- brows
- mouth (closed / open / A I U E O / optional English extras)

A character can then reference one shared template through `character.faceFit.templateId`. The character keeps its own base portrait and may still override any matching part locally.

## Face Fit

`character.faceFit` adds a small set of projection controls so a shared template can sit on different faces:

- `orientation`: `front`, `left-3q`, `right-3q`
- `perspective`: 0–1 intensity for the 3/4 squeeze / shift
- per-feature controls for `eyes`, `eyelids`, `pupils`, `brows`, `mouth`
  - `x`, `y` — normalized center on the base portrait
  - `scaleX`, `scaleY`
  - `offsetX`, `offsetY`
  - `rotation`

The current implementation is intentionally light: it projects template parts as separate face overlays and keeps the existing puppet rig / viseme / blink system intact.

## Studio flow

In the character editor:

1. Open **共享脸部模板**.
2. Click **从当前角色新建** to copy the current character's facial slots into a reusable template.
3. Assign that template to any character with the template dropdown.
4. Open **Face Fit / 朝向适配** and tune the per-feature placement until the preview sits correctly on the character's face. You can drag the coloured preview nodes directly, then fine-tune the numeric fields if needed.
5. If a specific character needs a unique brow, mouth, or eye set, bind that part in the character's own layer slots; the character-local layer wins over the template.

## Data model

Project-level:

```ts
project.faceTemplates: FaceTemplate[]
```

Character-level:

```ts
character.faceFit: CharacterFaceFit
```

Compiled performance documents now carry `faceTemplates` as well, so the renderer can resolve template-backed face parts at playback/export time.

## 0.30: split left/right perspective fit

For 3/4 faces a template may optionally bind separate **screen-left** and **screen-right** facial assets. “Left/right” always means the left/right side of the image shown in Studio, not anatomical left/right.

Supported split slots:

- `eyeLeftOpen / eyeLeftClosed`
- `eyeRightOpen / eyeRightClosed`
- `eyelidLeftOpen / eyelidLeftClosed`
- `eyelidRightOpen / eyelidRightClosed`
- `pupilLeft / pupilRight`
- `browLeft / browRight`

Replay Lab only switches a facial group into split mode when both sides can be resolved. If only one side exists, the combined `eyes* / eyelids* / pupils / brows` assets continue to render. This preserves old templates and prevents a half-configured template from deleting one side of the face.

At `left-3q` / `right-3q`, the split far-side feature automatically moves toward the face centre and becomes narrower/slightly smaller. The near side remains fuller. The Studio Face Fit canvas uses the exact same core projection functions as the final Canvas renderer, so drag placement and final playback/export share the same math.

Character-local split slots override the corresponding shared-template split slots, just like the older combined layers.

## Automatic template assembly (0.31)

The character editor can batch-build a shared Face Template from image files before any binding is written. Use **自动装配素材**, drag files into the drop area, or use **选择素材文件夹** when folder structure carries meaning.

Recognized examples:

```text
eyes_left_open.png       -> eyeLeftOpen
eyes/right/closed.png    -> eyeRightClosed
眉毛_左.png              -> browLeft
pupils.png               -> pupils
mouth_A.png              -> mouthA
mouth/AE.png             -> mouthAe
mouth_th.png             -> mouthTh
```

The classifier is conservative: `eye.png` has no open/closed state and is left unbound. If two files resolve to the same slot they are shown as a conflict and the user must choose one. If the target template already has that slot bound, replacement is not pre-selected.

Left/right in filenames follows Replay Lab's Face Template convention: **screen left / screen right**, not anatomical left/right.

## Project-level face package routing (0.32)

The Characters view can import a whole face-art folder at once. Replay Lab runs two independent classifiers for every image:

1. **target routing** — shared template vs. exact existing character vs. unresolved;
2. **part routing** — eyes / eyelids / pupils / brows / mouth slot using the 0.31 filename classifier.

Recommended package shape:

```text
faces/
├─ common/
│  ├─ eyes/left/open.png
│  ├─ eyes/right/open.png
│  └─ mouth/A.png
├─ Arthur/
│  └─ brows/right.png
└─ Francis/
   └─ mouth/closed.png
```

Routing is deliberately conservative:

- `common`, `shared`, `template`, `default`, `通用`, `共享`, `模板` are treated as shared-template directories.
- An exact directory name matching an existing Replay character becomes that character's local override target.
- `Arthur_eye_left_open.png` is also allowed when `Arthur` is an exact existing character name.
- Fuzzy matches are not used. `Arth/...` does **not** silently bind to `Arthur`.
- A path that simultaneously looks shared and character-specific is left unresolved.
- The preview allows unresolved recognized parts to be manually routed before application.
- If multiple selected files still target the same destination slot, application is blocked until only one remains.
- Existing template/character slots are not silently replaced; a protected row must be explicitly re-selected.

By default, shared files create a new Face Template. When the same package also contains character overrides, Replay Lab can assign the new shared template to those touched characters automatically.

## Full character-package initialization (0.33)

The project-level package importer can now initialize complete characters, not only face overrides.

Recognized character-only base-art filenames include `base`, `portrait`, `standing`, `idle`, `立绘`, and `底图`. They bind to `character.layers.base`. A base image under `common/shared/template` is rejected rather than inserted into a shared `FaceTemplate`; shared templates remain face-part-only.

When a package contains a clear directory for a role that does not yet exist, for example:

```text
faces/
├─ common/
│  └─ mouth/A.png
└─ Matthew/
   ├─ base.png
   └─ brows/left.png
```

the preview proposes `Matthew` as a **new character**. Replay Lab creates that character only if the user keeps those rows selected and applies the package. There is no fuzzy name matching. Generic directories such as `misc` remain unresolved.

### Text-only / no-art projects remain supported

This package logic is opt-in and is never called by ordinary Log or story-script import. A text-only import therefore remains valid with:

- zero image/audio assets;
- zero face templates;
- characters with no `layers.base` or legacy `images.idle`;
- procedural placeholder rendering with the existing blink/mouth behaviour.

Art can be added later without changing the imported script or character identities.
