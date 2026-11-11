/**
 * Loads a project's `plugins/*.js` — only after the user approved that exact file content.
 * Approval is remembered by content hash, so editing a plugin asks again.
 */
import { installStagePlugin, removeStagePlugin, listStagePlugins } from '../dist/index.js';

const TRUST_KEY = 'replaylab.pluginTrust';
const loadedIds = new Set();

const readTrust = () => { try { return new Set(JSON.parse(localStorage.getItem(TRUST_KEY) || '[]')); } catch { return new Set(); } };
const writeTrust = set => { try { localStorage.setItem(TRUST_KEY, JSON.stringify([...set].slice(-500))); } catch {} };
const unwrap = result => { if (result && typeof result === 'object' && 'ok' in result) { if (!result.ok) throw new Error(result.error?.message || '插件操作失败'); return result.value; } return result; };
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const headerOf = text => (text.match(/^\s*\/\*\*?([\s\S]*?)\*\//)?.[1] || text.match(/^\s*((?:\/\/.*\n?){1,6})/)?.[1] || '').replace(/^\s*[*/]+ ?/gm, '').trim().slice(0, 400);

/** Every plugin file in the project, with its content hash and leading comment. */
export async function scanProjectPlugins(workspace) {
  if (!workspace) return [];
  const desktop = globalThis.replayDesktop;
  if (desktop?.plugins && workspace.kind === 'filesystem' && workspace.id) return unwrap(await desktop.plugins({ action: 'scan', id: workspace.id })) || [];
  let files = [];
  try { files = (await workspace.list('plugins')).filter(item => /^plugins\/[^/]+\.js$/i.test(item.path)); } catch { return []; }
  const out = [];
  for (const file of files.slice(0, 32)) {
    const blob = await workspace.read(file.path);
    if (blob.size > 512 * 1024) { out.push({ name: file.path.split('/').pop(), size: blob.size, tooLarge: true }); continue; }
    const text = await blob.text();
    out.push({ name: file.path.split('/').pop(), size: blob.size, sha: hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), header: headerOf(text), text });
  }
  return out;
}

/**
 * Loads trusted plugins; asks `confirm(newOnes)` about the rest (it resolves to the names the
 * user approved). Previously loaded project plugins are removed first.
 */
export async function loadProjectPlugins(workspace, { confirm } = {}) {
  for (const id of loadedIds) removeStagePlugin(id);
  loadedIds.clear();
  const scanned = await scanProjectPlugins(workspace);
  const usable = scanned.filter(item => !item.tooLarge && item.sha);
  const trust = readTrust();
  const pending = usable.filter(item => !trust.has(item.sha));
  if (pending.length && confirm) {
    const approved = new Set(await confirm(pending) || []);
    for (const item of pending) if (approved.has(item.name)) trust.add(item.sha);
    writeTrust(trust);
  }
  const chosen = usable.filter(item => trust.has(item.sha));
  const skipped = scanned.filter(item => !chosen.includes(item)).map(item => ({ name: item.name, reason: item.tooLarge ? '超过 512 KB' : '没有启用' }));
  const results = [];
  const desktop = globalThis.replayDesktop;
  const sources = desktop?.plugins && workspace?.kind === 'filesystem' && workspace.id
    ? unwrap(await desktop.plugins({ action: 'load', id: workspace.id, files: chosen.map(({ name, sha }) => ({ name, sha })) })) || []
    : chosen.map(item => ({ name: item.name, url: URL.createObjectURL(new Blob([item.text], { type: 'text/javascript' })) }));
  for (const source of sources) {
    const id = `project:${source.name}`;
    if (source.error) { results.push({ name: source.name, error: source.error }); continue; }
    try {
      const module = await import(source.url);
      const setup = typeof module.default === 'function' ? module.default : module.default?.setup ?? module.setup;
      if (typeof setup !== 'function') throw new Error('没有找到 export default function (api) { … }');
      const label = (chosen.find(item => item.name === source.name)?.header || source.name).split('\n')[0].slice(0, 60);
      const info = installStagePlugin(id, label, setup);
      loadedIds.add(id);
      results.push({ name: source.name, ...info });
    } catch (error) {
      results.push({ name: source.name, error: error?.message || String(error) });
    } finally {
      if (source.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
    }
  }
  return { results, skipped, all: listStagePlugins() };
}

/** Forget every approval (used by the "重新确认插件" button). */
export function forgetPluginApprovals() { writeTrust(new Set()); }

export const STARTER_PLUGIN = `/**
 * 爱心飘落：/hearts [数量] [颜色] [秒数]
 * Replay Lab 示例插件。复制这个文件改一改就是你自己的演出效果。
 */
export default function (api) {
  api.registerCommand({
    name: 'hearts',
    aliases: ['爱心'],
    usage: '/hearts [数量] [颜色] [秒数]，例如 /hearts 30 粉 3',
    template: '/hearts 24 粉 3',
    layer: 'screen',            // world = 和角色一起；screen = 盖在舞台上；top = 盖在所有东西上
    defaultDuration: 3,
    parse(args) {
      const seconds = Number(args[2] ?? 3);
      if (!(seconds > 0 && seconds <= 30)) return { error: '秒数要在 0 到 30 之间' };
      return { duration: seconds };   // 加 blocking: true 会让台本停下来等它播完
    },
    draw(ctx, info) {
      // 只用 info 里的数值和 info.random 画画，同一时刻永远画出同一帧，导出视频才会一致。
      const count = Math.max(1, Math.min(200, Number(info.args[0]) || 24));
      const colors = { 粉: '#ff7aa8', 红: '#ff4d5e', 金: '#ffd166', 白: '#ffffff' };
      const color = colors[info.args[1]] || info.args[1] || '#ff7aa8';
      const fade = Math.min(1, (info.duration - info.time) / 0.5);
      for (let i = 0; i < count; i++) {
        const x = info.random(i) * info.width + Math.sin(info.time * 2 + i) * 18;
        const speed = 60 + info.random(i + 99) * 90;
        const y = ((info.random(i + 7) * info.height + info.time * speed) % (info.height + 40)) - 20;
        const size = 10 + info.random(i + 3) * 16;
        ctx.globalAlpha = 0.85 * fade;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.35);
        ctx.bezierCurveTo(x - size * 0.6, y - size * 0.15, x - size * 0.3, y - size * 0.7, x, y - size * 0.3);
        ctx.bezierCurveTo(x + size * 0.3, y - size * 0.7, x + size * 0.6, y - size * 0.15, x, y + size * 0.35);
        ctx.fill();
      }
    }
  });

  // 也可以注册转场和滤镜：
  api.registerTransition({
    name: 'heart-iris',
    aliases: ['爱心收'],
    cover(ctx, progress, width, height, previous) {
      const r = Math.hypot(width, height) * 0.6 * (1 - api.util.easeInOut(progress));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(width / 2, height / 2 + r * 0.35);
      ctx.bezierCurveTo(width / 2 - r * 0.6, height / 2 - r * 0.15, width / 2 - r * 0.3, height / 2 - r * 0.7, width / 2, height / 2 - r * 0.3);
      ctx.bezierCurveTo(width / 2 + r * 0.3, height / 2 - r * 0.7, width / 2 + r * 0.6, height / 2 - r * 0.15, width / 2, height / 2 + r * 0.35);
      ctx.clip();
      ctx.drawImage(previous, 0, 0, width, height);
      ctx.restore();
    }
  });
  api.registerFilter({ name: '老电视', css: 'contrast(1.25) saturate(0.6) sepia(0.2)', overlay(ctx, width, height, time) {
    ctx.globalAlpha = 0.12;
    for (let y = (time * 40) % 4; y < height; y += 4) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, width, 1); }
  } });
}
`;
