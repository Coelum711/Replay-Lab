# Replay Lab 0.28 · 转盘历史 → Wheel Performance

Replay Lab can import the full JSON archive exported by the companion **恋综大逃杀 · 关系与事件模拟器** and append supported history records as `wheel` lines.

## Supported history records

- `single`: ordinary person wheel. Multi-person results become one wheel spin per person, without replacement.
- `draw`: two-slot event. A and B are replayed as separate weighted wheel steps.
- `party`: participants are revealed one by one. The chosen event remains in the imported line title/provenance; Replay Lab does not fabricate a one-option event wheel because the archive does not preserve the exact historical eligible-event pool.
- relation records whose title contains `攻受锁定`: reconstructed as the three-way relationship wheel when enough pair metadata exists.

Other history record types are skipped rather than guessed.

## Historical result vs reconstructed wheel

The **result** is authoritative: Replay Lab always animates to the ids stored in the history record. It never rerolls an imported historical event.

The wheel sectors/weights are reconstructed from the exported archive's current `chars`, `singleWeights`, `events`, `members`, and where available `pairMeta`. The old simulator does not snapshot every candidate weight with every history entry, so if weights/status changed after the historical draw, the reconstructed sector sizes may differ from what was visible at that exact moment. Replay Lab preserves this distinction in source metadata instead of claiming otherwise.

## Runtime semantics

`WheelEvent.mode = "history"` means the result is predetermined and AUTO may continue after the animation. `mode = "interactive"` is reserved for a future player-driven random wheel and blocks AUTO until resolved.
