import type { ReplayProject } from '../core/types.js';
import type { ReplayTemplate } from './types.js';

export const BUILTIN_TEMPLATES: ReplayTemplate[] = [
  {
    id: 'visual-novel',
    name: 'Visual Novel',
    description: '橙光 / ADV 式对话框，当前发言人突出。',
    settings: { maxOnStage: 3, autoStageMode: 'vn-continuity', speakerFocus: 'subtle', dimOthers: true, showNameTags: true },
    presentation: { dialogueLayout: 'visual-novel', defaultTransition: 'fade', speakingFocus: true, diceStyle: 'card' }
  },
  {
    id: 'yukkuri',
    name: 'Yukkuri TRPG',
    description: '底部字幕、双人同屏、弱镜头聚焦。',
    settings: { maxOnStage: 2, autoStageMode: 'vn-continuity', speakerFocus: 'none', dimOthers: false, showNameTags: true },
    presentation: { dialogueLayout: 'bottom-caption', defaultTransition: 'cut', speakingFocus: false, diceStyle: 'inline' }
  },
  {
    id: 'horror-investigation',
    name: 'Horror Investigation',
    description: '偏暗视觉小说演出，淡入较多，骰点卡片突出。',
    settings: { maxOnStage: 2, autoStageMode: 'vn-continuity', speakerFocus: 'strong', dimOthers: true, showNameTags: true, bgColor: '#0b0d12', bgmVolume: 0.18 },
    presentation: { dialogueLayout: 'visual-novel', defaultTransition: 'fade', speakingFocus: true, diceStyle: 'card' }
  }
];

export function applyTemplate(project: ReplayProject, template: ReplayTemplate): ReplayProject {
  project.settings = { ...project.settings, ...template.settings, templateId: template.id };
  return project;
}
