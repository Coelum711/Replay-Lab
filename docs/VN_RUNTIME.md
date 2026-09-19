# Replay Lab 0.28 · Playable VN Runtime

0.28 adds a player layer around the existing Replay renderer. It does **not** introduce a second visual-novel renderer.

```text
ReplayProject
    ↓ compile
PerformanceDocument
    ↓
VNReplayRuntime ── manual / AUTO / SKIP / LOG / RESTART
    ↓
CanvasStageRenderer + BrowserReplayPlayer
    ├─ Studio playtest
    ├─ published web player
    └─ video rendering uses the same visual state
```

## Studio playtest

The center preview exposes:

- 从这里试玩
- 从本 Scene
- 从头

The full-screen playtest supports previous/next, AUTO, SKIP, backlog and restart. AUTO advances after the current compiled line duration plus a small reading gap. `WheelEvent.mode === "interactive"` or `blockingAuto === true` blocks automatic advance; imported historical wheel performances do not block because their result is already known.

## Publishable web folder

When a File System Access project directory is connected, **导出可玩网页文件夹** writes:

```text
exports/<project>-playable/
├─ index.html
├─ player.js
├─ performance.json
├─ dist/                 # Replay Lab browser runtime modules
├─ assets/               # resolved local assets used by the Performance
└─ README.txt
```

The output is a static web app. Serve it over HTTP (for example GitHub Pages, Netlify, or a local static server); direct `file://` loading of ES modules may be blocked by browser security policy.

## Scope of 0.28

Included: linear VN playback, AUTO, SKIP, backlog, restart, play-from-current/Scene/start, static-web publishing, historical wheel performances.

Not yet included: player choices, variables/conditions, save slots, rollback state snapshots, or true interactive random wheels. Those require a branching/state layer rather than only a linear Performance cursor.
