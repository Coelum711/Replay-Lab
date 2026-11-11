/**
 * Hand-off to a video editor: an FCP7 XML timeline (Premiere Pro, DaVinci Resolve, Final Cut 7)
 * plus SRT subtitles. The stage video, the per-line textbox stills and every audio clip are
 * separate files, so an editor can restyle subtitles, re-mix voices and add their own effects.
 */
import type { MediaAsset, PerformanceDocument, PerformanceLine } from '../core/types.js';
import { buildAudioSchedule, type AudioScheduleEvent } from '../renderers/browser-media.js';

export interface EditBundleOptions {
  fps?: number;
  width: number;
  height: number;
  /** Absolute folder of the bundle, used for pathurl; relative paths are written when absent. */
  absoluteRoot?: string | null;
  videoFile?: string;
}

export interface EditBundleFile { path: string; assetId?: string; lineIndex?: number; kind: 'video' | 'overlay' | 'voice' | 'sfx' | 'bgm' | 'ambient'; }

export interface EditBundle {
  xml: string;
  srt: string;
  srtSpoken: string;
  /** Files the timeline expects; the caller writes them (audio copied from assets, stills rendered). */
  files: EditBundleFile[];
  overlays: Array<{ lineIndex: number; path: string; start: number; duration: number }>;
  readme: string;
}

const TRACK_FOLDER: Record<AudioScheduleEvent['kind'], string> = { voice: '音频/配音', sfx: '音频/音效', bgm: '音频/BGM', ambient: '音频/环境声' };
const escapeXml = (value: string) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const safeFileName = (value: string, fallback = 'clip') => (String(value ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback);
const extensionOf = (asset: MediaAsset | undefined, fallback: string) => {
  const fromPath = asset?.sourcePath?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromPath) return fromPath;
  const mime = asset?.mime ?? '';
  return mime.includes('mpeg') ? 'mp3' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('aac') ? 'm4a' : mime.includes('flac') ? 'flac' : mime.includes('png') ? 'png' : fallback;
};
const pad = (n: number, width = 4) => String(n).padStart(width, '0');

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

const isTextLine = (line: PerformanceLine) => line.type !== 'command' && !!String(line.text ?? '').trim() && !['wheel', 'dice', 'hitpoint'].includes(line.type);

export function buildEditBundle(performance: PerformanceDocument, options: EditBundleOptions): EditBundle {
  const fps = Math.max(1, Math.round(options.fps ?? 30));
  const frames = (seconds: number) => Math.max(0, Math.round(seconds * fps));
  const assets = new Map(performance.assets.map(asset => [asset.id, asset]));
  const total = Math.max(1, frames(performance.duration));
  const videoFile = options.videoFile ?? '画面_无对话框.mp4';
  const url = (relative: string) => options.absoluteRoot
    ? `file://localhost${encodeURI(`${options.absoluteRoot.replace(/\/+$/, '')}/${relative}`)}`
    : encodeURI(relative);
  const files: EditBundleFile[] = [{ path: videoFile, kind: 'video' }];

  // Textbox stills: one per visible line, shown for the line's whole length.
  const overlays = performance.lines.map((line, index) => ({ line, index })).filter(({ line }) => isTextLine(line))
    .map(({ line, index }) => ({ lineIndex: index, path: `对话框/${pad(index + 1)}_${safeFileName(line.speakerName, '旁白')}.png`, start: line.start, duration: Math.max(1 / fps, line.duration) }));
  for (const overlay of overlays) files.push({ path: overlay.path, kind: 'overlay', lineIndex: overlay.lineIndex });

  // Audio: every scheduled clip on its own track; looping beds are cut into back-to-back clips.
  const lineIndex = new Map(performance.lines.map((line, index) => [line.lineId, index]));
  const audioFiles = new Map<string, string>();
  const fileFor = (event: AudioScheduleEvent) => {
    const asset = assets.get(event.assetId);
    if (event.kind === 'voice') {
      const index = lineIndex.get(event.lineId ?? '') ?? 0;
      const line = performance.lines[index];
      const path = `${TRACK_FOLDER.voice}/${pad(index + 1)}_${safeFileName(line?.speakerName ?? 'voice')}.${extensionOf(asset, 'wav')}`;
      return path;
    }
    const key = `${event.kind}:${event.assetId}`;
    if (!audioFiles.has(key)) {
      let base = safeFileName(asset?.name?.replace(/\.[a-z0-9]{2,5}$/i, '') ?? event.assetId, event.kind), path = `${TRACK_FOLDER[event.kind]}/${base}.${extensionOf(asset, 'wav')}`, n = 2;
      while ([...audioFiles.values()].includes(path)) path = `${TRACK_FOLDER[event.kind]}/${base}_${n++}.${extensionOf(asset, 'wav')}`;
      audioFiles.set(key, path);
    }
    return audioFiles.get(key)!;
  };
  type Clip = { path: string; start: number; end: number; in: number; name: string; volume: number; assetDuration: number };
  const tracks: Record<AudioScheduleEvent['kind'], Clip[]> = { voice: [], sfx: [], bgm: [], ambient: [] };
  const seen = new Set<string>();
  for (const event of buildAudioSchedule(performance)) {
    if (event.synthetic) continue;
    const asset = assets.get(event.assetId);
    if (!asset) continue;
    const path = fileFor(event);
    if (!seen.has(path)) { seen.add(path); files.push({ path, kind: event.kind, assetId: event.assetId, ...(event.kind === 'voice' ? { lineIndex: lineIndex.get(event.lineId ?? '') } : {}) }); }
    const assetDuration = Number(asset.metadata?.duration) || 0;
    const end = Math.min(performance.duration, event.end ?? (assetDuration ? event.start + assetDuration : performance.duration));
    if (end <= event.start) continue;
    const name = path.split('/').pop()!;
    if (event.loop && assetDuration > 0.05) {
      for (let at = event.start; at < end - 1e-6; at += assetDuration) tracks[event.kind].push({ path, start: at, end: Math.min(end, at + assetDuration), in: 0, name, volume: event.volume, assetDuration });
    } else tracks[event.kind].push({ path, start: event.start, end, in: 0, name, volume: event.volume, assetDuration: assetDuration || end - event.start });
  }

  // ---- FCP7 XML (xmeml v4)
  let clipId = 0;
  const fileIds = new Map<string, string>();
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const fileElement = (path: string, kind: 'video' | 'still' | 'audio', durationFrames: number) => {
    if (fileIds.has(path)) return `<file id="${fileIds.get(path)}"/>`;
    const id = `file-${fileIds.size + 1}`; fileIds.set(path, id);
    const media = kind === 'audio'
      ? `<media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media>`
      : `<media><video><samplecharacteristics>${rate}<width>${options.width}</width><height>${options.height}</height></samplecharacteristics></video>${kind === 'video' ? '<audio><channelcount>2</channelcount></audio>' : ''}</media>`;
    return `<file id="${id}"><name>${escapeXml(path.split('/').pop()!)}</name><pathurl>${escapeXml(url(path))}</pathurl>${rate}<duration>${durationFrames}</duration>${media}</file>`;
  };
  const clipItem = (name: string, file: string, start: number, end: number, inFrame: number, extra = '') =>
    `<clipitem id="clip-${++clipId}"><name>${escapeXml(name)}</name><enabled>TRUE</enabled>${rate}<start>${start}</start><end>${end}</end><in>${inFrame}</in><out>${inFrame + end - start}</out>${file}${extra}</clipitem>`;

  const videoTrack = `<track>${clipItem(videoFile, fileElement(videoFile, 'video', total), 0, total, 0)}</track>`;
  const overlayTrack = `<track>${overlays.map(overlay => {
    const start = frames(overlay.start), end = Math.max(start + 1, frames(overlay.start + overlay.duration));
    return clipItem(overlay.path.split('/').pop()!, fileElement(overlay.path, 'still', end - start), start, end, 0);
  }).join('')}</track>`;
  const audioTrack = (kind: AudioScheduleEvent['kind']) => `<track>${tracks[kind].map(clip => {
    const start = frames(clip.start), end = Math.max(start + 1, frames(clip.end));
    const level = Math.max(0, clip.volume);
    const gain = Math.abs(level - 1) > 0.01 ? `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><value>${level.toFixed(3)}</value></parameter></effect></filter>` : '';
    return clipItem(clip.name, fileElement(clip.path, 'audio', Math.max(1, frames(clip.assetDuration))), start, end, frames(clip.in), `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>${gain}`);
  }).join('')}</track>`;
  const title = escapeXml(performance.title || 'Replay Lab');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>${title}</name><duration>${total}</duration>${rate}`
    + `<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`
    + `<media><video><format><samplecharacteristics>${rate}<width>${options.width}</width><height>${options.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${videoTrack}${overlayTrack}</video>`
    + `<audio>${audioTrack('voice')}${audioTrack('sfx')}${audioTrack('bgm')}${audioTrack('ambient')}</audio></media></sequence></xmeml>\n`;

  // ---- subtitles
  const subtitleLines = performance.lines.filter(isTextLine);
  const srtOf = (pick: (line: PerformanceLine) => string) => subtitleLines.map((line, i) => `${i + 1}\n${srtTime(line.start)} --> ${srtTime(line.start + line.duration)}\n${line.type === 'dialogue' ? `${line.speakerName}：` : ''}${pick(line).replace(/\n+/g, ' ')}\n`).join('\n');
  const srt = srtOf(line => line.text);
  const srtSpoken = srtOf(line => line.speechText || line.text);

  const readme = [
    `${performance.title || 'Replay Lab'} · 剪辑素材包（Replay Lab 导出）`, '',
    '时间轴.xml（Final Cut Pro 7 XML）：',
    '  · Premiere Pro：文件 → 导入，选 时间轴.xml，会得到一个排好的序列。',
    '  · DaVinci Resolve：文件 → 导入 → 时间线，选 时间轴.xml。',
    '  · After Effects：先在 Premiere 导入，再用 Dynamic Link 或「导入 Premiere Pro 项目」带进 AE。',
    '', '轨道：',
    '  V1 画面_无对话框.mp4：舞台、角色和演出，不含对话框。（视频里也带一份混好的音轨，可以静音。）',
    '  V2 对话框/*.png：每句一张透明对话框，可以整轨替换成自己的字幕样式。',
    '  A1 配音（每句一段）  A2 音效  A3 BGM  A4 环境声',
    '', '字幕.srt 是显示文字，字幕_朗读.srt 是实际念的文字（表里双语时两者不同）。',
    options.absoluteRoot ? '' : '注意：这份时间轴里的素材路径是相对路径，导入后如果提示找不到媒体，把搜索位置指向这个文件夹即可。',
    '打字音和插件画面已经烧进画面视频，没有单独的轨道。'
  ].filter(line => line !== null).join('\n');

  return { xml, srt, srtSpoken, files, overlays, readme };
}
