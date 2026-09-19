# Replay Lab 0.53.2-dev — Voicebox Local Bridge

## What changed

- Added optional `Voicebox Local` as a real Replay Lab TTS provider.
- Voicebox remains a separate install; Replay Lab does not bundle Voicebox or its models.
- Character voice slots can choose a Voicebox Profile and use it for single-line or batch synthesis.
- Voicebox Profiles are never hard-filtered by their stored language; matching language is only ranked first.
- The browser adapter explicitly binds native `fetch`, fixing `Failed to execute 'fetch' on 'Window': Illegal invocation`.

## CORS / launcher fix

The launcher now exposes only these same-origin proxy routes:

- `GET /__voicebox/health`
- `GET /__voicebox/profiles`
- `POST /__voicebox/generate`
- `GET /__voicebox/history/<generation-id>`
- `GET /__voicebox/audio/<generation-id>`

They are forwarded to the local Voicebox service at `127.0.0.1:17493`. Replay Lab may therefore continue using any free local port; browser CORS no longer depends on Voicebox allowing that Replay Lab port. Destructive Voicebox endpoints are deliberately not proxied.

## Generation flow

Replay Lab submits `/generate`, polls the read-only generation record until `completed` / `failed`, then downloads `/audio/<id>` and persists the resulting audio exactly like any other generated Voice asset. First-use model downloads are still owned by Voicebox.
