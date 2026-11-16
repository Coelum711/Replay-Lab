/**
 * Dialogue box skin, RPG Maker style: drop images into `assets/system/` and the textbox changes.
 *
 *   assets/system/对话框.png   nine-slice textbox (corners stay crisp at any size)
 *   assets/system/名字框.png   nine-slice name tag, tinted with the speaker's colour
 *   assets/system/Window.png   an RPG Maker MV/MZ window skin (used when there is no 对话框.png)
 *   assets/system/对话框.json  layout: margins, fonts, colours … (Chinese or English keys)
 *
 * Lengths are pixels on a 1280×720 stage and scale with the output size.
 */
import type { WorkspaceFileInfo } from '../workspace/types.js';

export interface DialogueSkinLayout {
  marginX: number; bottom: number; height: number; opacity: number; radius: number;
  boxColor: string; boxAlpha: number; borderColor: string; borderAlpha: number;
  padX: number; padTop: number; padBottom: number;
  fontSize: number; lineHeight: number; textColor: string; fontFamily: string;
  nameX: number; nameY: number; nameHeight: number; nameMinWidth: number; namePadX: number;
  nameFontSize: number; nameColor: string; nameTint: boolean; showName: boolean;
  progress: boolean;
  /** Nine-slice border, in source-image pixels. */
  slice: number; nameSlice: number;
}

export interface DialogueSkin {
  /** Project-relative paths of the skin images (resolved like any other asset). */
  box?: string | null;
  name?: string | null;
  window?: string | null;
  layout?: Partial<DialogueSkinLayout>;
  /** Changes whenever a skin file changes, so cached images are dropped. */
  revision?: string;
}

/** The built-in look, expressed as layout values (unchanged from before skins existed). */
export const DEFAULT_DIALOGUE_LAYOUT: DialogueSkinLayout = {
  marginX: 70.4, bottom: 40.8, height: 201.6, opacity: 1, radius: 18,
  boxColor: '#0a0c11', boxAlpha: 0.89, borderColor: '#ffffff', borderAlpha: 0.12,
  padX: 28, padTop: 40, padBottom: 18,
  fontSize: 23, lineHeight: 1.43, textColor: '#f4f6fb', fontFamily: '',
  nameX: 16, nameY: -17, nameHeight: 34, nameMinWidth: 110, namePadX: 14,
  nameFontSize: 16, nameColor: '#ffffff', nameTint: true, showName: true,
  progress: true,
  slice: 24, nameSlice: 12
};

type Key = keyof DialogueSkinLayout;
/** JSON key (Chinese label first, then the English name) → layout field. */
export const DIALOGUE_LAYOUT_FIELDS: ReadonlyArray<{ key: Key; label: string; min?: number; max?: number; step?: number; hint?: string }> = [
  { key: 'marginX', label: '左右边距', min: 0, max: 400, step: 1 },
  { key: 'bottom', label: '离底部', min: -50, max: 400, step: 1 },
  { key: 'height', label: '高度', min: 60, max: 600, step: 1 },
  { key: 'opacity', label: '不透明度', min: 0, max: 1, step: 0.01 },
  { key: 'radius', label: '圆角', min: 0, max: 60, step: 1, hint: '没有对话框图片时才用' },
  { key: 'boxColor', label: '底色' },
  { key: 'boxAlpha', label: '底色浓度', min: 0, max: 1, step: 0.01 },
  { key: 'borderColor', label: '描边色' },
  { key: 'borderAlpha', label: '描边浓度', min: 0, max: 1, step: 0.01 },
  { key: 'padX', label: '文字左右留白', min: 0, max: 200, step: 1 },
  { key: 'padTop', label: '文字上留白', min: 0, max: 200, step: 1 },
  { key: 'padBottom', label: '文字下留白', min: 0, max: 200, step: 1 },
  { key: 'fontSize', label: '字号', min: 10, max: 60, step: 1 },
  { key: 'lineHeight', label: '行距', min: 1, max: 2.5, step: 0.01 },
  { key: 'textColor', label: '文字颜色' },
  { key: 'fontFamily', label: '字体', hint: '电脑上装了的字体名，例如 Source Han Serif SC' },
  { key: 'showName', label: '显示名字' },
  { key: 'nameX', label: '名字横向位置', min: -100, max: 1200, step: 1 },
  { key: 'nameY', label: '名字纵向位置', min: -150, max: 400, step: 1 },
  { key: 'nameHeight', label: '名字框高度', min: 10, max: 120, step: 1 },
  { key: 'nameMinWidth', label: '名字框最短', min: 0, max: 600, step: 1 },
  { key: 'namePadX', label: '名字左右留白', min: 0, max: 100, step: 1 },
  { key: 'nameFontSize', label: '名字字号', min: 8, max: 60, step: 1 },
  { key: 'nameColor', label: '名字颜色' },
  { key: 'nameTint', label: '名字框用代表色' },
  { key: 'progress', label: '进度条' },
  { key: 'slice', label: '对话框九宫格边', min: 0, max: 400, step: 1, hint: '图片四个角不拉伸的像素宽' },
  { key: 'nameSlice', label: '名字框九宫格边', min: 0, max: 200, step: 1 }
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Reads 对话框.json; unknown keys and bad values are reported, never thrown. */
export function parseDialogueLayout(text: string): { layout: Partial<DialogueSkinLayout>; warnings: string[] } {
  const warnings: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (error) { return { layout: {}, warnings: [`对话框.json 不是有效的 JSON：${(error as Error).message}`] }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { layout: {}, warnings: ['对话框.json 应该是 { "字号": 24, … } 这样的对象'] };
  const layout: Partial<DialogueSkinLayout> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (name.startsWith('_') || name.startsWith('//') || name === '说明') continue;
    const field = DIALOGUE_LAYOUT_FIELDS.find(f => f.label === name || f.key === name);
    if (!field) { warnings.push(`不认识的设置「${name}」`); continue; }
    const fallback = DEFAULT_DIALOGUE_LAYOUT[field.key];
    if (typeof fallback === 'boolean') { if (typeof value === 'boolean') (layout as any)[field.key] = value; else warnings.push(`「${name}」要写 true 或 false`); continue; }
    if (typeof fallback === 'number') {
      const n = Number(value);
      if (typeof value !== 'number' && typeof value !== 'string' || !Number.isFinite(n)) { warnings.push(`「${name}」要写数字`); continue; }
      (layout as any)[field.key] = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, n));
      continue;
    }
    if (typeof value !== 'string') { warnings.push(`「${name}」要写文字`); continue; }
    if (field.key.endsWith('Color') && !HEX.test(value)) { warnings.push(`「${name}」要写 #rrggbb 颜色`); continue; }
    (layout as any)[field.key] = value.trim();
  }
  return { layout, warnings };
}

/** 对话框.json content for a layout: only values that differ from the default, with Chinese keys. */
export function formatDialogueLayout(layout: Partial<DialogueSkinLayout>): string {
  const out: Record<string, unknown> = {};
  for (const field of DIALOGUE_LAYOUT_FIELDS) {
    const value = layout[field.key];
    if (value === undefined || value === DEFAULT_DIALOGUE_LAYOUT[field.key]) continue;
    out[field.label] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
  }
  return JSON.stringify(out, null, 2) + '\n';
}

export function resolveDialogueLayout(skin: DialogueSkin | null | undefined): DialogueSkinLayout {
  return { ...DEFAULT_DIALOGUE_LAYOUT, ...(skin?.layout ?? {}) };
}

/** True when the skin changes anything; an empty skin keeps the original drawing code path. */
export function dialogueSkinActive(skin: DialogueSkin | null | undefined): boolean {
  return !!skin && !!(skin.box || skin.name || skin.window || Object.keys(skin.layout ?? {}).length);
}

const SYSTEM_DIR = 'assets/system/';
const BOX_NAMES = ['对话框', 'textbox', 'dialog', 'dialogue', 'messagebox'];
const NAME_NAMES = ['名字框', 'namebox', 'nametag', 'name'];
const WINDOW_NAMES = ['window'];
const LAYOUT_NAMES = ['对话框.json', 'dialog.json', 'dialogue.json', 'textbox.json'];
const IMAGE_EXT = /\.(png|webp|jpe?g|gif|avif)$/i;

export const DIALOGUE_SKIN_FOLDER = SYSTEM_DIR.slice(0, -1);

/** Which files in assets/system make up the skin. `layoutPath` still has to be read by the caller. */
export function findDialogueSkinFiles(files: readonly WorkspaceFileInfo[]): { box: string | null; name: string | null; window: string | null; layoutPath: string | null; revision: string } {
  const system = files.map(f => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\.?\//, '') })).filter(f => f.path.startsWith(SYSTEM_DIR) && !f.path.slice(SYSTEM_DIR.length).includes('/'));
  const pick = (names: string[]) => system.find(f => IMAGE_EXT.test(f.path) && names.includes(f.path.slice(SYSTEM_DIR.length).replace(IMAGE_EXT, '').toLowerCase()))?.path ?? null;
  const layoutPath = system.find(f => LAYOUT_NAMES.includes(f.path.slice(SYSTEM_DIR.length).toLowerCase()))?.path ?? null;
  const box = pick(BOX_NAMES), name = pick(NAME_NAMES), window = pick(WINDOW_NAMES);
  const used = new Set([box, name, window, layoutPath].filter(Boolean));
  const revision = system.filter(f => used.has(f.path)).map(f => `${f.path}:${f.size ?? ''}:${f.modifiedAt ?? ''}`).sort().join('|');
  return { box, name, window, layoutPath, revision };
}
