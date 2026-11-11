// Line inspector tools for mouth timing: generate from text + audio energy
// (Lip Studio port), import .lab / Rhubarb JSON, clear.
import { alignTextToEnergy, parseLab, phonemesToMouthCues, collapseMouthCues, parseRhubarbJson, resolveCachedSpeech } from '../dist/index.js';

async function decodeMono(blob) {
  const context = new OfflineAudioContext(1, 1, 44100);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const samples = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) samples[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples, sampleRate: buffer.sampleRate };
}

/** Cues from a .lab or Rhubarb JSON file's text. Rhubarb cues are stored un-led (lead is applied at playback). */
export function mouthCuesFromTimingFile(name, text, language) {
  const trimmed = String(text).trim();
  if (/\.json$/i.test(name) || trimmed.startsWith('{')) return parseRhubarbJson(trimmed, 0);
  return collapseMouthCues(phonemesToMouthCues(parseLab(trimmed), { visualLeadMs: 0, language }));
}

export class MouthTimingController {
  constructor({ $, getProject, currentLine, resolveAsset, scheduleSave, onChanged }) {
    Object.assign(this, { $, getProject, currentLine, resolveAsset, scheduleSave, onChanged });
    $('#mouthFromText')?.addEventListener('click', () => void this.generate());
    $('#mouthImportFile')?.addEventListener('click', () => $('#mouthFileInput')?.click());
    $('#mouthFileInput')?.addEventListener('change', event => void this.importFile(event.target));
    $('#mouthClear')?.addEventListener('click', () => this.clear());
  }

  status(message, tone = '') {
    const el = this.$('#mouthTimingStatus');
    if (!el) return;
    el.textContent = message;
    el.className = tone ? `status ${tone}` : 'muted';
  }

  render() {
    const line = this.currentLine();
    const wrap = this.$('#mouthTimingTools');
    if (!wrap) return;
    wrap.hidden = !line || line.type === 'command';
    if (!line) return;
    this.$('#mouthFromText').disabled = !line.audioAssetId;
    this.$('#mouthFromText').title = line.audioAssetId ? '用朗读文本和这句音频的音量起伏，算出每个音节的口型' : '这句还没有音频';
    this.$('#mouthClear').disabled = !line.mouthCues?.length;
    const n = line.mouthCues?.length || 0;
    this.status(n ? `口型时间轴：${n} 段${line.mouth === 'off' ? '（口型已关闭）' : ''}` : (line.audioAssetId ? '没有口型时间轴：按文字节奏开合' : '没有音频：按文字节奏开合'));
  }

  apply(line, cues, label) {
    line.mouthCues = cues;
    if (line.mouth !== 'off') line.mouth = 'timed';
    this.scheduleSave(label, `${line.id}:mouthCues`);
    this.onChanged?.();
  }

  async generate() {
    const project = this.getProject(), line = this.currentLine();
    if (!project || !line?.audioAssetId) return;
    const lineId = line.id;
    this.status('正在分析音频…');
    try {
      let source = await this.resolveAsset(line.audioAssetId);
      if (typeof source === 'string') source = await (await fetch(source)).blob();
      if (!source) throw new Error('找不到这句的音频文件');
      const pcm = await decodeMono(source);
      if (this.currentLine()?.id !== lineId) return;
      const { text, language } = resolveCachedSpeech(project, line);
      const sensitivity = Number(this.$('#mouthSensitivity')?.value) || 5;
      const cues = alignTextToEnergy(text, pcm, { language: language === 'auto' ? undefined : language, sensitivity });
      if (!cues.length) { this.status('没算出口型：音频太安静，或朗读文本里没有可读的字', 'warn'); return; }
      this.apply(line, cues, '按台词生成口型');
      this.status(`已生成 ${cues.length} 段口型`, 'ok');
    } catch (error) {
      this.status(`生成失败：${error?.message || error}`, 'warn');
    }
  }

  async importFile(input) {
    const file = input.files?.[0];
    input.value = '';
    const project = this.getProject(), line = this.currentLine();
    if (!file || !project || !line) return;
    try {
      const cues = mouthCuesFromTimingFile(file.name, await file.text(), resolveCachedSpeech(project, line).language);
      if (!cues.length) { this.status(`${file.name} 里没有可用的口型时间`, 'warn'); return; }
      this.apply(line, cues, '导入口型文件');
      this.status(`已导入 ${cues.length} 段口型（${file.name}）`, 'ok');
    } catch (error) {
      this.status(`导入失败：${error?.message || error}`, 'warn');
    }
  }

  clear() {
    const line = this.currentLine();
    if (!line?.mouthCues?.length) return;
    delete line.mouthCues;
    if (line.mouth === 'timed') line.mouth = 'auto';
    this.scheduleSave('清除口型', `${line.id}:mouthCues`);
    this.onChanged?.();
  }
}
