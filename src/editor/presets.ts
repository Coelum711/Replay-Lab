import type { PerformanceClipboard } from './batch.js';

export interface PerformancePreset {
  id: string;
  label: string;
  description: string;
  patch: PerformanceClipboard;
}

export const BUILTIN_PERFORMANCE_PRESETS: PerformancePreset[] = [
  {
    id: 'auto-dialogue',
    label: '自动对话',
    description: '自动上镜、自动口型、无镜头特效。',
    patch: { mouth: 'auto', stageMode: 'auto', scene: { camera: 'none', transition: 'cut' } }
  },
  {
    id: 'focus-speaker',
    label: '聚焦说话人',
    description: '保留当前场景，只给本句增加说话人聚焦。',
    patch: { scene: { camera: 'focus-speaker' } }
  },
  {
    id: 'impact-shake',
    label: '震动强调',
    description: '适合重击、惊吓、失败等强调句。',
    patch: { scene: { camera: 'shake' } }
  },
  {
    id: 'slow-push',
    label: '缓慢推进',
    description: '给当前句增加镜头推进。',
    patch: { scene: { camera: 'push' } }
  },
  {
    id: 'fade-entry',
    label: '淡入场景',
    description: '当前句使用 Fade 转场。',
    patch: { scene: { transition: 'fade' } }
  }
];

export function getPerformancePreset(id: string): PerformancePreset | undefined {
  return BUILTIN_PERFORMANCE_PRESETS.find(p => p.id === id);
}
