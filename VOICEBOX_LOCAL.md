# Voicebox Local integration (0.53.2-dev)

0.54.2 adds an **optional, separate** MLX clone/instruct companion that runs on a separate local address.
See `VOICE_BRIDGE_CN.md`. It reads Voicebox profiles but never patches Voicebox.
The stable path below remains unchanged. Experimental fields are NOT sent to stock `/generate`.

Replay Lab can optionally use a separately installed Voicebox instance as a local TTS backend.

## Connection

Default endpoint: (local address)

Replay Lab does **not** install Voicebox and does **not** download Voicebox models itself. When a generation selects an engine/model that Voicebox has not cached yet, Voicebox may download it on first use.

## Language policy

Spoken language is independent from Log/source language.

Resolution order:

1. line speech-language override
2. character default spoken language
3. project-wide spoken language
4. imported Log language
5. `auto`

Replay Lab sends the resolved language explicitly to Voicebox. Locale codes are reduced to the base language expected by Voicebox (`zh-CN` → `zh`, `en-GB` → `en`).

Voicebox profiles are not hard-filtered by reference/sample language. Matching-language profiles are ranked first, while mismatches remain selectable because some engines support cross-lingual cloning. The UI marks them so the author can make that trade-off knowingly.

## Generation flow

Replay Lab uses Voicebox as a thin local service:

1. `GET /profiles`
2. `POST /generate`
3. poll `GET /history/{generation_id}` until completed/failed
4. `GET /audio/{generation_id}`
5. import the returned audio into the existing Replay Lab line/Voice asset flow

Dialogue/Voice timing and export therefore remain Replay Lab data; Voicebox is only the synthesis backend.

## Security

Keep Voicebox on localhost unless you intentionally configure a trusted remote deployment. The Voicebox local API is not an authenticated public-service API, so Replay Lab defaults to a local address.
