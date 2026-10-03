# Replay Lab 0.53.2-dev — Unified Speech Language + Voicebox Local

- Added project-wide spoken/TTS language independent from imported Log language.
- Precedence: line override → character default → project speech language → Log language → auto.
- Old projects migrate by inheriting their previous Log language, preserving TTS behavior.
- Added optional Voicebox Local TTS provider at `http://127.0.0.1:17493`.
- Voicebox profiles are never hidden solely for language mismatch; matching sample languages sort first and mismatches remain selectable.
- Voicebox generation explicitly sends the resolved target language. Locale codes are reduced to base codes for Voicebox (`zh-CN` → `zh`, `en-GB` → `en`).
- Replay Lab never downloads Voicebox itself. Voicebox may download the selected engine/model on first generation.
