# Replay Lab core product audit — 0.28

Replay Lab spent 0.8–0.12 deepening infrastructure (importers, speech policy, translation, accents, TTS and lip sync). 0.13–0.16 deliberately pulled development back to the actual Replay-making loop.

## The actual product loop

```text
Import session Log / project folder
        ↓
Resolve characters + assets
        ↓
Edit script / chapters / scene actions
        ↓
Stage characters + expressions + dice + sound
        ↓
Generate/import speech and lip sync
        ↓
Preview the replay
        ↓
Render/export a finished video or editable downstream project
```

## Status by core area

| Area | Current state | Priority |
| --- | --- | --- |
| Log / folder import | Strong foundation: plain/QQ, Cocofolia, JSON, RGL, folder chapters | Maintain |
| Project workspace / material persistence | Canonical filesystem workspace, generated voice assets, exports folder, relink baseline | P0 baseline done |
| Script editing | Undo/redo, search, multi-select, batch edits, folding, **plus 0.16 drag/keyboard reorder and Scene/Chapter block moves** | P1 iterate |
| Character visual setup | IDLE/OPEN/BLINK, A-I-U-E-O and named expression image sets | P0 baseline done |
| Asset library | Classification/autobind, filesystem persistence, relink/remove and diagnostics baseline | P1 |
| Scene/directing editor | BG/CG/BGM, SFX, expression, roster, positions, enter/exit, camera, transition + reusable directing presets | P0 baseline done |
| Replay-specific dice presentation | Parsing and renderer card exist; richer presets/effects remain shallow | P1 |
| Speech/TTS/language/accent | More mature than the rest of the editor | Freeze / maintain |
| Lip sync | Tiered architecture and renderer integration exist | Maintain |
| Preview renderer | Canvas renderer uses compiled Performance state | P0 baseline done |
| Finished video export | Real-time WebM fallback works; long-form WebCodecs/VNVE remains unvalidated | P0 long-form |
| YMM/Tyrano/JSON interoperability | Functional baseline | P1 |
| Long-project ergonomics | History/search/batch/folding and reorder now exist; **true DOM virtualization remains** | P1 |
| Templates/plugins | Architecture exists; community packaging/UI later | P2 |

## 0.16 editor findings

The previous 8,000-line benchmark showed the pure data operations were not the bottleneck. After introducing the 0.16 flattened `ScriptRenderRow` model, a 20,000-line Node benchmark built the complete row model in ~12 ms and searched it in ~17 ms on this environment. The remaining long-project bottleneck is still DOM volume and browser rendering, not Replay semantics.

Therefore:

- do not over-optimize `ReplayProject` search/index code prematurely;
- use TanStack Virtual when Studio gains a bundler;
- keep CSS `content-visibility` only as an interim static-page optimization;
- keep project history independent from DOM/framework state.

## Development order after 0.16

1. **True large-Log UI:** bundled Studio + TanStack Virtual, then test 8k/20k/50k lines interactively. The 0.16 `ScriptRenderRow` layer is already the adapter seam.
2. Better tree operations: cross-Chapter Scene moves, split/merge Scene, insert Scene/Chapter before/after, and safer marker semantics.
3. Promote the standards-only recovery store to Dexie once the Studio bundle exists; optionally persist lightweight UI state and generated-preview caches, while filesystem workspaces remain canonical.
4. Reliable long-form final render: validate WebCodecs/VNVE against the Canvas/MediaRecorder reference renderer.
5. Replay-specific automation: richer dice effects, bot semantics and community directing presets.
6. Only then return to secondary voice/accent sophistication.

See `docs/SHOULDERS.md` for the open-source infrastructure decisions behind this roadmap.

The core principle remains: users edit a Replay script and performance state, not a Premiere-like timeline.


## 0.28 playable-preview closure

The preview loop is now VN-capable rather than export-dependent. A compiled Performance can be played from the current line, current Scene or beginning with manual advance, AUTO, SKIP, backlog and restart. The same Canvas/Puppet renderer is packaged into playable static-web output, keeping preview/publish/video visually aligned.

The story importer also accepts prose/VN-like source material (`当前场景：`, `角色：`, bare narration, bracketed actions), and the companion roulette simulator's exported JSON history can be appended as deterministic wheel performances. Recorded wheel results are replayed, not rerolled.
