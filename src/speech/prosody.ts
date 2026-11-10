import type { ReplayProject, ReplayLine, ProsodyPoint } from '../core/types.js';
import { resolveSpeechPolicy } from './policy.js';

export const PROSODY_LIMIT = 4;
export function normalizeProsodyCurve(input?: readonly ProsodyPoint[]): ProsodyPoint[] {
  if (!input?.length) return [{position:0,semitones:0},{position:1,semitones:0}];
  if (input.length > 33) throw new Error('语调曲线最多支持 33 个控制点。');
  const points = input.map(p => {
    if (!Number.isFinite(p.position) || !Number.isFinite(p.semitones)) throw new Error('语调曲线包含无效数值。');
    return {position:Math.max(0,Math.min(1,p.position)),semitones:Math.max(-PROSODY_LIMIT,Math.min(PROSODY_LIMIT,p.semitones))};
  }).sort((a,b)=>a.position-b.position);
  const unique = points.filter((p,i)=>i===points.length-1 || p.position!==points[i+1].position);
  if (unique[0].position!==0) unique.unshift({position:0,semitones:unique[0].semitones});
  if (unique.at(-1)!.position!==1) unique.push({position:1,semitones:unique.at(-1)!.semitones});
  return unique;
}
export function prosodyIsFlat(curve?: readonly ProsodyPoint[]): boolean {
  return normalizeProsodyCurve(curve).every(p=>Math.abs(p.semitones)<0.001);
}
/** Linear offset envelope in semitones; zero preserves the existing natural contour. */
export function prosodyOffsetAt(curve: readonly ProsodyPoint[], position: number): number {
  if (position<=curve[0].position) return curve[0].semitones;
  for(let i=1;i<curve.length;i++) if(position<=curve[i].position){
    const a=curve[i-1],b=curve[i],ratio=(position-a.position)/(b.position-a.position);
    return a.semitones+(b.semitones-a.semitones)*ratio;
  }
  return curve.at(-1)!.semitones;
}
/** Approximate anchors refer to the actual spoken text, never untranslated subtitles. */
export function prosodyInstruction(input: readonly ProsodyPoint[] | undefined, text: string): string {
  const curve=normalizeProsodyCurve(input);
  if(prosodyIsFlat(curve))return '';
  const units=Array.from(text.trim());
  const directions=curve.map(({position,semitones:shift})=>{
    const start=Math.max(0,Math.min(units.length-14,Math.round(position*units.length)-6));
    const anchor=units.slice(start,start+14).join('').replace(/[\r\n]/g,' ');
    return `${Math.round(position*100)}%${anchor?` (approximate text anchor ${JSON.stringify(anchor)})`:''}: ${Math.abs(shift)<0.15?'natural pitch':`${shift>0?'raise':'lower'} ${Math.abs(shift).toFixed(1)} semitones from natural pitch`}`;
  });
  return 'Intonation direction, not spoken dialogue. Preserve the requested emotion and accent. Follow these approximate pitch offsets smoothly, retaining natural within-word inflections: '+directions.join('; ')+'. Keep the dialogue unchanged; do not read these directions aloud. These are delivery targets, not exact timing constraints.';
}
export function assertProsodyReenactment(project:ReplayProject,line:ReplayLine):void {
  const policy=resolveSpeechPolicy(project,line);
  if(policy.ttsProvider!=='voicebox-local'||policy.voice.mode!=='experimental-clone-instruct'||policy.voice.modelSize!=='1.7B'){
    throw new Error('按曲线重录需要角色选择 Voicebox 的「实验：克隆 + 情绪」及 1.7B。普通克隆可以使用本地微调。');
  }
}
