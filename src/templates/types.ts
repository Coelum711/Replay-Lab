import type { ReplaySettings } from '../core/types.js';

export interface ReplayTemplate {
  id: string;
  name: string;
  description: string;
  settings: Partial<ReplaySettings>;
  presentation: {
    dialogueLayout: 'visual-novel' | 'bottom-caption' | 'chat';
    defaultTransition: 'cut' | 'fade';
    speakingFocus: boolean;
    diceStyle: 'card' | 'inline' | 'minimal';
  };
}
