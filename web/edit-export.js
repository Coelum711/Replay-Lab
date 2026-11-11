/**
 * "导出给 AE / PR": writes an editor hand-off folder into the project's exports/ —
 * audio stems, one transparent textbox still per line, SRT subtitles, an FCP7 XML timeline,
 * and finally the stage video without the textbox (streamed, so long episodes don't sit in memory).
 */
import { buildEditBundle } from '../dist/index.js';

const unwrap = result => { if (result && typeof result === 'object' && 'ok' in result) { if (!result.ok) throw new Error(result.error?.message || '读取工程路径失败'); return result.value; } return result; };
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const toBlob = async source => typeof source === 'string' ? await (await fetch(source)).blob() : source;

export async function exportForEditors({ session, workspace, preset, moduleSpecifier, signal, onProgress = () => {} }) {
  if (!workspace?.createWritable) throw new Error('请先连接工程文件夹：素材包会写进工程的 exports 文件夹。');
  const performance = session.performance;
  const safe = String(session.title || 'replay').replace(/[^\w㐀-鿿-]+/g, '_').slice(0, 40);
  const dir = `exports/AEPR_${safe}_${stamp()}`;
  let absoluteRoot = null;
  try {
    const desktop = globalThis.replayDesktop;
    if (desktop?.workspace && workspace.kind === 'filesystem' && workspace.id) absoluteRoot = `${unwrap(await desktop.workspace({ action: 'root', id: workspace.id }))}/${dir}`;
  } catch { absoluteRoot = null; }
  const { width, height } = { width: session.renderer.canvas?.width ?? 1280, height: session.renderer.canvas?.height ?? 720 };
  const bundle = buildEditBundle(performance, { fps: 30, width, height, absoluteRoot });
  const write = (path, data, mime) => workspace.write(`${dir}/${path}`, data, mime);
  const missing = [];

  const audio = bundle.files.filter(file => ['voice', 'sfx', 'bgm', 'ambient'].includes(file.kind));
  for (let i = 0; i < audio.length; i++) {
    signal?.throwIfAborted();
    onProgress(`复制音频 ${i + 1} / ${audio.length}`, 0.02 + 0.08 * i / Math.max(1, audio.length));
    const blob = await toBlob(await session.resolveAsset(audio[i].assetId)).catch(() => null);
    if (!blob) { missing.push(audio[i].path); continue; }
    await write(audio[i].path, blob);
  }

  const canvas = document.createElement('canvas');
  for (let i = 0; i < bundle.overlays.length; i++) {
    signal?.throwIfAborted();
    if (i % 10 === 0) onProgress(`渲染对话框 ${i + 1} / ${bundle.overlays.length}`, 0.1 + 0.1 * i / Math.max(1, bundle.overlays.length));
    const overlay = bundle.overlays[i];
    if (!await session.renderer.renderDialogueOverlay(overlay.lineIndex, canvas)) continue;
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (png) await write(overlay.path, png, 'image/png');
  }

  const text = value => new Blob([value], { type: 'text/plain;charset=utf-8' });
  await write('时间轴.xml', text(bundle.xml), 'application/xml');
  await write('字幕.srt', text('﻿' + bundle.srt));
  await write('字幕_朗读.srt', text('﻿' + bundle.srtSpoken));
  await write('说明.txt', text(bundle.readme + (missing.length ? `\n\n以下音频读取失败，没有复制：\n${missing.join('\n')}` : '')));

  signal?.throwIfAborted();
  session.renderer.hideDialogue = true;
  const writable = await workspace.createWritable(`${dir}/${bundle.files[0].path}`);
  const phase = { loading: '加载编码器', audio: '混合音频', video: '编码画面', finalizing: '封装 MP4' };
  try {
    await session.player.exportMp4Fast({ fps: 30, videoBitsPerSecond: preset.video, audioBitsPerSecond: preset.audio, chunkSeconds: 10, moduleSpecifier, writable, signal,
      onProgress: (progress, step) => onProgress(`画面视频 · ${phase[step] || step} · ${(progress * 100).toFixed(1)}%`, 0.2 + 0.8 * progress) });
  } catch (error) { try { await writable.abort?.(); } catch {} throw error; }
  return { dir, overlays: bundle.overlays.length, audio: audio.length - missing.length, missing, absolute: !!absoluteRoot };
}
