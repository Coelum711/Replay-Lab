// Two silent mono PCM16 samples at 24 kHz. No model output is bundled.
export function mockWav() {
  const bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  bytes.set(new TextEncoder().encode('data'), 36);
  view.setUint32(4, 40, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, 4, true);
  return bytes;
}
