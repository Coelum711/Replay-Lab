# Engineering + Human-Use Audit — 0.40

Replay Lab 0.40 is a workbench-coordination pass. The goal is not to make the Studio look generically “modern”; it is to borrow interaction patterns that have survived real use in mature authoring tools, while preserving Replay Lab’s text-first product rule.

## External reference review

### Visual Studio Code — views are persistent, panels are optional

VS Code separates the primary editor from auxiliary regions: Activity Bar / Side Bar / Editor / Panel. Side bars and the Panel can be moved, hidden, resized, restored, and remembered between sessions. Its layout customization explicitly treats these regions as task-dependent rather than requiring every tool to remain visible at once.

Reference:
- https://code.visualstudio.com/docs/configure/custom-layout
- https://code.visualstudio.com/docs/editing/getting-started/editor-tutorial

**Replay Lab takeaway:** a low-frequency export/check surface should not permanently consume a third of the window. The default should preserve script + preview, while Output remains one explicit workspace away.

### Godot — stable viewport, contextual Inspector, folded secondary tools

Godot keeps a stable central viewport, puts selected-object properties in a contextual Inspector, and folds secondary bottom panels until invoked. It also exposes task-oriented main screens and a distraction-free mode. Docks are resizable and layouts can be saved/restored.

References:
- https://docs.godotengine.org/en/latest/getting_started/introduction/first_look_at_the_editor.html
- https://docs.godotengine.org/en/latest/tutorials/editor/inspector_dock.html
- https://docs.godotengine.org/en/latest/tutorials/editor/customizing_editor.html

**Replay Lab takeaway:** the current-line Inspector is useful while editing the script, but it is context noise while the creator is editing Characters, Assets, or Styles. Stage-only mode should genuinely remove unrelated editing surfaces.

### Twine — text is primary, structure is visible, build is an action

Twine is explicitly text-focused. Passage editing gives most of the dialog to text, changes autosave, the story map visualizes structure, and broken links are shown as local diagnostics. Search/jump supports passage name and content rather than forcing navigation through the map.

References:
- https://twinery.org/reference/en/
- https://twinery.org/reference/en/editing-stories/editing-passages.html
- https://play.twinery.org/reference/en/editing-stories/navigating.html

**Replay Lab takeaway:** script authoring remains the default working context. Publishing/export is a terminal task, not the default permanent sidebar. Diagnostics should navigate to the thing that needs repair rather than merely report it.

### Inochi Creator — direct manipulation and Inspector precision coexist

Inochi Creator uses a central canvas with visible gizmos/handles while also exposing exact numeric properties in an Inspector. Its model workflow distinguishes editing modes rather than presenting every operation simultaneously.

References:
- https://docs.inochi2d.com/en/latest/creator/first-model/index.html
- https://docs.inochi2d.com/ja/latest/creator/first-model/tutorial02.html
- https://github.com/Inochi2D/inochi-creator

**Replay Lab takeaway:** keep Face Fit and stage direct-manipulation as the normal path; precision values remain secondary. This validates the 0.36–0.39 direction instead of replacing it with a property-table-heavy editor.

### RplGen / 回声工坊 — document-first production and resource side views

RplGen describes its core value as making Replay production closer to writing a document. Its VS Code integration adds outline, character/background/audio side views, hover help, completion, status information, and commands around the script instead of turning the script into a video timeline.

References:
- https://github.com/DanDDXuanX/TRPG-Replay-Generator
- https://marketplace.visualstudio.com/items?itemName=yxChangingSelf.trpg-replay-generator-log

**Replay Lab takeaway:** preserve the script as production truth. Visual controls should shorten repetitive work around the document, not replace the document with a Premiere-like timeline.

## 0.40 engineering review

### Central project normalization

Older project-shape repair previously belonged partly to browser Studio lifecycle. 0.40 exposes one core entry point:

```ts
normalizeReplayProject(project)
```

The same normalization is now available to Studio, tests, CLI adapters, and third-party callers. It fills current defaults for settings, character aliases, Face Fit, Puppet rigs, speech profiles, templates, and line substructures, then stamps the current project version.

This closes one of the explicit 0.39 engineering-debt items: schema compatibility is no longer a page-local concern.

### Workbench state remains UI state

Task layout remains outside `ReplayProject`. `制作 / 舞台 / 输出 / 全部` is a creator preference, not production data. Column widths, active content tab, advanced-mode disclosure, and used-character filters stay in UI preferences.

That separation is important: two people opening the same Replay project may prefer different workbench arrangements without modifying the project file.

## 0.40 human-use changes

### 1. “制作” is the default workspace

The recommended default is now:

```text
工程 / 内容 | 预览 + 当前台词 Inspector
```

The Output rail is hidden.

This reflects actual frequency: creators import, write, arrange, and preview continuously; they export comparatively rarely.

### 2. Output / checks are a real task workspace

Choosing **输出 / 检查**, or pressing the top **检查** / **导出** buttons, switches to:

```text
预览 | 输出 / 工程检查
```

The left authoring rail and current-line Inspector are removed from that task context. The creator can still visually verify the Replay while rendering or repairing project-level issues.

### 3. Stage mode is genuinely distraction-free

**舞台** hides both side rails and the current-line Inspector. It keeps the stage, direct stage controls, playback, seek, and VN playtest entry.

This is closer to Godot’s distraction-free viewport concept than the previous “one column but still a long Inspector below it” behavior.

### 4. The Inspector follows the selected kind of work

When the content tab is **角色**, **素材**, or **样式**, the current-line Inspector is hidden. A short contextual card explains where the current task lives and where to return for per-line binding.

This avoids a common authoring failure mode: changing a visible control while mentally associating it with the object selected in another panel.

### 5. “全部三栏” remains available

Power users can still show project/content, preview/Inspector, and output simultaneously. The feature is retained as a workspace, but no longer presented as the recommended baseline.

## What we deliberately did not copy

- No arbitrary dock drag-and-drop system yet. Replay Lab has only a few stable regions, and a full dock framework would add implementation surface before there is evidence creators need it.
- No permanent Activity Bar clone. Four content types do not justify another navigation layer.
- No timeline-first animation workspace. Replay Lab’s source of truth remains script + performance state.
- No Inspector full-text property search yet. The current Inspector is still small enough that contextual hiding and progressive disclosure produce more value first.
- No fuzzy automatic cross-language identity merge. Mature-tool convenience does not justify ambiguous destructive inference.

## Next human-use priorities

1. **Script writing density:** evaluate whether the current 310 px left script column is still too narrow for long prose; a Twine-like large-text editing focus may be more valuable than another property panel.
2. **Inspector “changed / relevant only” view:** Godot’s non-default-property pattern is a strong candidate once per-line property density grows further.
3. **Command/search navigation:** a lightweight global “go to line / character / Scene / asset” palette could unify navigation without adding a new permanent rail.
4. **Real browser interaction tests:** static tests still cannot prove pointer/scroll/focus behavior. Keep this limitation explicit.

## Product invariant after 0.40

> A creator can paste text, obtain usable placeholder characters, edit the Replay, preview it, and export it without preparing art, learning rigging, opening Output, or understanding the internal project schema.
