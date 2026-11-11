// Import a character's outfit × pose body art from a PSD by layer / group names.
// .procreate files are not readable here: export a PSD from Procreate first.
import { planBodyImport, bodyKey } from '../dist/index.js';

async function agPsd() {
  // The bundle is UMD (not strict-mode safe), so load it as a classic script.
  if (!globalThis.agPsd) await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/ag-psd/bundle.js', import.meta.url).href;
    script.onload = resolve; script.onerror = () => reject(new Error('PSD 读取库加载失败'));
    document.head.append(script);
  });
  if (!globalThis.agPsd?.readPsd) throw new Error('PSD 读取库没有加载');
  return globalThis.agPsd;
}

function toNodes(layers) {
  return (layers || []).map(layer => ({
    name: layer.name,
    hidden: !!layer.hidden,
    blendMode: layer.blendMode,
    opacity: layer.opacity,
    clipping: !!layer.clipping,
    ...(layer.children ? { children: toNodes(layer.children) } : { ref: layer.canvas ? layer : null })
  }));
}

export async function readPsdBodyPlan(file) {
  if (/\.procreate$/i.test(file.name)) throw new Error('.procreate 文件不能直接读取：请在 Procreate 里「分享 → PSD」导出后再导入。');
  const { readPsd } = await agPsd();
  const psd = readPsd(await file.arrayBuffer(), { skipCompositeImageData: true, skipThumbnail: true });
  const plan = planBodyImport(toNodes(psd.children));
  return { psd, plan };
}

function flatten(slice, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  for (const source of slice.sources) {
    const layer = source.ref;
    if (!layer?.canvas) continue;
    ctx.globalAlpha = source.opacity;
    ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export function describePlan(plan) {
  const combos = Object.keys(plan.bodies);
  const lines = [`会生成 ${combos.length} 个组合：${combos.join('、')}`, `合并成 ${plan.slices.length} 张图层（连续的普通图层会压成一张）`];
  const front = plan.slices.filter(s => s.front).length, multiply = plan.slices.filter(s => s.blend !== 'normal').length;
  if (front) lines.push(`${front} 张画在脸前面`);
  if (multiply) lines.push(`${multiply} 张保留混合方式（阴影 / 高光 / 剪切）`);
  if (plan.skippedFace.length) lines.push(`跳过脸部图层 ${plan.skippedFace.length} 个（表情照旧管）：${plan.skippedFace.slice(0, 6).join('、')}${plan.skippedFace.length > 6 ? '…' : ''}`);
  if (plan.approximated.length) lines.push(`这些图层的混合方式不支持，按普通图层导入：${plan.approximated.slice(0, 6).join('、')}`);
  return lines;
}

/** Writes each slice as a PNG asset and sets character.bodies for every planned combination (same keys are replaced). */
export async function applyPsdBodyPlan({ psd, plan }, character, addImageAsset, onProgress) {
  const assetIds = [];
  for (const [index, slice] of plan.slices.entries()) {
    onProgress?.(index, plan.slices.length);
    const blob = await flatten(slice, psd.width, psd.height);
    if (!blob) throw new Error(`第 ${index + 1} 张图层没能生成 PNG`);
    const safe = String(slice.label || `layer${index + 1}`).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    assetIds.push(await addImageAsset(blob, `${character.name}_身体_${String(index + 1).padStart(2, '0')}_${safe}.png`));
  }
  const bodies = { ...(character.bodies || {}) };
  for (const outfit of plan.outfits) for (const pose of plan.poses[outfit]) {
    const key = bodyKey(outfit, pose);
    bodies[key] = { layers: plan.bodies[key].map(i => {
      const slice = plan.slices[i];
      return { asset: assetIds[i], name: slice.label, ...(slice.blend !== 'normal' ? { blend: slice.blend } : {}), ...(slice.opacity < 1 ? { opacity: +slice.opacity.toFixed(3) } : {}), ...(slice.front ? { front: true } : {}) };
    }) };
  }
  character.bodies = bodies;
  return Object.keys(plan.bodies);
}
