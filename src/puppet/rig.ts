/**
 * Lightweight replay puppet evaluation.
 *
 * Architecture is derived from Inochi2D's BSD-2-Clause Parameter/Binding model:
 * a scalar Parameter finds/interpolates keypoints, then applies Bindings to
 * node/part properties or deformation control points. Replay Lab intentionally
 * implements only the small subset useful for TRPG replay characters.
 */
import type {
  CharacterPuppetRig,
  PuppetBindingKeyframe,
  PuppetParameter,
  PuppetPartName,
  PuppetVec2,
  ReplayCharacter,
  Viseme
} from '../core/types.js';

export interface PuppetPartState {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  deform: PuppetVec2[] | null;
}

export interface EvaluatedPuppetState {
  values: Record<string, number>;
  parts: Record<PuppetPartName, PuppetPartState>;
}

const PARTS: PuppetPartName[] = ['base', 'eyes', 'eyelids', 'pupils', 'brows', 'mouth', 'overlay'];

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function blankPartState(): PuppetPartState {
  return { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, deform: null };
}

function vecLerp(a: PuppetVec2, b: PuppetVec2, t: number): PuppetVec2 {
  return { x: lerp(a?.x ?? 0, b?.x ?? 0, t), y: lerp(a?.y ?? 0, b?.y ?? 0, t) };
}

/** Find the lower keyframe and normalized position, matching Inochi2D's Parameter1D idea. */
export function findKeypointAndNormal(points: number[], value: number): { index: number; norm: number } {
  if (!points.length) return { index: -1, norm: 0 };
  if (points.length === 1 || value <= points[0]!) return { index: 0, norm: 0 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    if (value <= b) return { index: i, norm: b === a ? 0 : clamp((value - a) / (b - a), 0, 1) };
  }
  return { index: points.length - 1, norm: 0 };
}

export function interpolateBindingKeyframes(keyframes: PuppetBindingKeyframe[], value: number): number | PuppetVec2[] | null {
  if (!keyframes.length) return null;
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  if (value <= sorted[0]!.at) return structuredClone(sorted[0]!.value);
  if (value >= sorted.at(-1)!.at) return structuredClone(sorted.at(-1)!.value);
  let left = sorted[0]!, right = sorted[1]!;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (value >= sorted[i]!.at && value <= sorted[i + 1]!.at) { left = sorted[i]!; right = sorted[i + 1]!; break; }
  }
  const t = right.at === left.at ? 0 : clamp((value - left.at) / (right.at - left.at), 0, 1);
  if (typeof left.value === 'number' && typeof right.value === 'number') return lerp(left.value, right.value, t);
  if (Array.isArray(left.value) && Array.isArray(right.value)) {
    const lv = left.value as PuppetVec2[];
    const rv = right.value as PuppetVec2[];
    const count = Math.max(lv.length, rv.length);
    return Array.from({ length: count }, (_, i) => vecLerp(lv[i] ?? { x: 0, y: 0 }, rv[i] ?? { x: 0, y: 0 }, t));
  }
  return structuredClone(t < 0.5 ? left.value : right.value);
}

export function defaultPuppetRig(): CharacterPuppetRig {
  const property = (id: string, name: string, min: number, max: number, def: number, bindings: PuppetParameter['bindings']): PuppetParameter => ({
    id, name, min, max, defaultValue: def, points: [min, def, max].filter((v, i, a) => i === 0 || v !== a[i - 1]), bindings
  });
  return {
    layout: { framing: 'auto', anchorX: 0.5, anchorY: 1, scale: 1, offsetX: 0, offsetY: 0 },
    parts: {},
    parameters: [
      property('eyeOpen', '眼睛开合', 0, 1, 1, [
        { part: 'eyes', property: 'scaleY', keyframes: [{ at: 0, value: 0.10 }, { at: 1, value: 1 }] },
        { part: 'pupils', property: 'scaleY', keyframes: [{ at: 0, value: 0.10 }, { at: 1, value: 1 }] },
        { part: 'eyelids', property: 'opacity', keyframes: [{ at: 0, value: 1 }, { at: 1, value: 0 }] }
      ]),
      property('mouthOpen', '嘴巴开合', 0, 1, 0, [
        { part: 'mouth', property: 'scaleY', keyframes: [{ at: 0, value: 0.72 }, { at: 1, value: 1.28 }] }
      ]),
      property('mouthWide', '嘴巴宽窄', -1, 1, 0, [
        { part: 'mouth', property: 'scaleX', keyframes: [{ at: -1, value: 0.76 }, { at: 0, value: 1 }, { at: 1, value: 1.30 }] }
      ]),
      property('browY', '眉毛高度', -1, 1, 0, [
        { part: 'brows', property: 'translateY', keyframes: [{ at: -1, value: 0.025 }, { at: 0, value: 0 }, { at: 1, value: -0.025 }] }
      ]),
      property('browAngle', '眉毛角度', -1, 1, 0, [
        { part: 'brows', property: 'rotation', keyframes: [{ at: -1, value: -0.16 }, { at: 0, value: 0 }, { at: 1, value: 0.16 }] }
      ]),
      property('eyeSquash', '眼睛压扁', 0.6, 1.25, 1, [
        { part: 'eyes', property: 'scaleY', keyframes: [{ at: 0.6, value: 0.6 }, { at: 1, value: 1 }, { at: 1.25, value: 1.25 }] },
        { part: 'pupils', property: 'scaleY', keyframes: [{ at: 0.6, value: 0.6 }, { at: 1, value: 1 }, { at: 1.25, value: 1.25 }] }
      ]),
      property('mouthY', '嘴巴高度', -1, 1, 0, [
        { part: 'mouth', property: 'translateY', keyframes: [{ at: -1, value: 0.025 }, { at: 0, value: 0 }, { at: 1, value: -0.025 }] }
      ]),
      property('mouthTilt', '嘴巴倾斜', -1, 1, 0, [
        { part: 'mouth', property: 'rotation', keyframes: [{ at: -1, value: -0.14 }, { at: 0, value: 0 }, { at: 1, value: 0.14 }] }
      ]),
      // Gaze: moves only the pupil layer(s). -1 = image left / up, 1 = image right / down.
      property('lookX', '视线左右', -1, 1, 0, [
        { part: 'pupils', property: 'translateX', keyframes: [{ at: -1, value: -0.03 }, { at: 0, value: 0 }, { at: 1, value: 0.03 }] }
      ]),
      property('lookY', '视线上下', -1, 1, 0, [
        { part: 'pupils', property: 'translateY', keyframes: [{ at: -1, value: -0.018 }, { at: 0, value: 0 }, { at: 1, value: 0.018 }] }
      ])
    ],
    expressionPresets: {}
  };
}

export function normalizePuppetRig(input?: Partial<CharacterPuppetRig> | null): CharacterPuppetRig {
  const base = defaultPuppetRig();
  if (!input) return base;
  const byId = new Map(base.parameters.map(p => [p.id, p]));
  for (const p of input.parameters ?? []) byId.set(p.id, { ...p, points: [...(p.points ?? [p.min, p.max])], bindings: (p.bindings ?? []).map(b => ({ ...b, keyframes: (b.keyframes ?? []).map(k => ({ at: k.at, value: structuredClone(k.value) })) })) });
  return {
    layout: { ...base.layout, ...(input.layout ?? {}) },
    parts: { ...base.parts, ...(input.parts ?? {}) },
    parameters: [...byId.values()],
    expressionPresets: Object.fromEntries(Object.entries(input.expressionPresets ?? {}).map(([k, v]) => [k, { ...v }]))
  };
}

function visemeParameters(viseme: Viseme): Pick<Record<string, number>, 'mouthOpen' | 'mouthWide'> {
  switch (viseme) {
    case 'A': return { mouthOpen: 1, mouthWide: 0.25 };
    case 'AE': return { mouthOpen: 1, mouthWide: 0.25 }; // old LipSync Studio fallback → A
    case 'I': return { mouthOpen: 0.55, mouthWide: 1 };
    case 'U': return { mouthOpen: 0.62, mouthWide: -0.75 };
    case 'UU': return { mouthOpen: 0.62, mouthWide: -0.75 }; // fallback → U
    case 'W': return { mouthOpen: 0.62, mouthWide: -0.75 };  // fallback → U
    case 'E': return { mouthOpen: 0.62, mouthWide: 0.75 };
    case 'O': return { mouthOpen: 0.92, mouthWide: -0.45 };
    case 'OO': return { mouthOpen: 0.92, mouthWide: -0.45 }; // fallback → O
    case 'OPEN': return { mouthOpen: 0.78, mouthWide: 0 };
    // The old tool fell schwa/f/th/m back to idle when no dedicated English
    // mouth asset existed; schwa now opens slightly instead.
    case 'SCHWA': return { mouthOpen: 0.35, mouthWide: 0 };
    case 'F': case 'TH': case 'M':
    default: return { mouthOpen: 0, mouthWide: 0 };
  }
}

export function evaluatePuppet(character: ReplayCharacter, expression: string, viseme: Viseme, blinking: boolean, overrides?: Record<string, number>): EvaluatedPuppetState {
  const rig = normalizePuppetRig(character.puppet);
  const values: Record<string, number> = {};
  for (const parameter of rig.parameters) values[parameter.id] = parameter.defaultValue;
  Object.assign(values, rig.expressionPresets[expression] ?? {});
  // Per-line overrides (gaze, brows, …) sit on top of the expression.
  if (overrides) Object.assign(values, overrides);
  // Automatic replay drivers intentionally override expression values only for
  // transient speech/blink parameters; expressions still own brows/custom params.
  values.eyeOpen = blinking ? 0 : 1;
  Object.assign(values, visemeParameters(viseme));

  const parts = Object.fromEntries(PARTS.map(part => [part, blankPartState()])) as Record<PuppetPartName, PuppetPartState>;
  for (const parameter of rig.parameters) {
    const value = clamp(values[parameter.id] ?? parameter.defaultValue, parameter.min, parameter.max);
    values[parameter.id] = value;
    for (const binding of parameter.bindings) {
      const result = interpolateBindingKeyframes(binding.keyframes, value);
      if (result == null) continue;
      const state = parts[binding.part];
      if (binding.property === 'deform') {
        if (!Array.isArray(result)) continue;
        if (!state.deform) state.deform = result.map(v => ({ ...v }));
        else {
          const count = Math.max(state.deform.length, result.length);
          state.deform = Array.from({ length: count }, (_, i) => ({
            x: (state.deform?.[i]?.x ?? 0) + (result[i]?.x ?? 0),
            y: (state.deform?.[i]?.y ?? 0) + (result[i]?.y ?? 0)
          }));
        }
      } else if (typeof result === 'number') {
        if (binding.property === 'translateX' || binding.property === 'translateY' || binding.property === 'rotation') state[binding.property] += result;
        else if (binding.property === 'scaleX' || binding.property === 'scaleY' || binding.property === 'opacity') state[binding.property] *= result;
      }
    }
  }
  return { values, parts };
}


/**
 * Creates/updates a 0..1 expression parameter whose value=1 applies the given
 * lattice offsets. This is the small Replay-oriented equivalent of authoring a
 * deformation binding keypoint in Inochi Creator.
 */
export function setExpressionLatticeWarp(
  rigInput: CharacterPuppetRig,
  expression: string,
  part: PuppetPartName,
  offsets: PuppetVec2[],
  columns = 3,
  rows = 3
): CharacterPuppetRig {
  const rig=normalizePuppetRig(rigInput);
  rig.parts[part]={...(rig.parts[part]??{name:part}),name:part,lattice:{columns:Math.max(2,columns),rows:Math.max(2,rows)}};
  const id=`exprWarp:${expression}:${part}`;
  const zero=offsets.map(()=>({x:0,y:0}));
  let parameter=rig.parameters.find(p=>p.id===id);
  const binding={part,property:'deform' as const,keyframes:[{at:0,value:zero},{at:1,value:offsets.map(v=>({...v}))}]};
  if(parameter){parameter.bindings=[binding];parameter.min=0;parameter.max=1;parameter.defaultValue=0;parameter.points=[0,1];}
  else rig.parameters.push({id,name:`${expression} · ${part} 形变`,min:0,max:1,defaultValue:0,points:[0,1],bindings:[binding]});
  rig.expressionPresets[expression]={...(rig.expressionPresets[expression]??{}),[id]:1};
  return rig;
}

export function expressionLatticeWarp(rigInput: CharacterPuppetRig, expression: string, part: PuppetPartName): PuppetVec2[] | null {
  const rig=normalizePuppetRig(rigInput);const id=`exprWarp:${expression}:${part}`;const p=rig.parameters.find(v=>v.id===id);const b=p?.bindings.find(v=>v.part===part&&v.property==='deform');const end=b?.keyframes.slice().sort((a,b)=>a.at-b.at).at(-1)?.value;
  return Array.isArray(end)?end.map(v=>({...v})):null;
}

/**
 * Effective per-line overrides at `localTime`: eases (smoothstep) from the
 * previous line's overrides to this line's over `seconds`. Parameters missing
 * on one side use the expression's value, so pure function of time.
 */
export function linePuppetOverridesAt(
  character: ReplayCharacter,
  expression: string,
  to: Record<string, number> | undefined,
  from: Record<string, number> | undefined,
  localTime: number,
  seconds = 0.3
): Record<string, number> | undefined {
  if (!from) return to && Object.keys(to).length ? to : undefined;
  const span = Math.max(0, Number(seconds) || 0);
  const t = span <= 0 ? 1 : Math.max(0, Math.min(1, localTime / span));
  const k = t * t * (3 - 2 * t);
  if (k >= 1) return to && Object.keys(to).length ? to : undefined;
  const rig = normalizePuppetRig(character.puppet);
  const base = (id: string) => rig.expressionPresets[expression]?.[id] ?? rig.parameters.find(p => p.id === id)?.defaultValue ?? 0;
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(from), ...Object.keys(to ?? {})])) {
    const a = from[id] ?? base(id), b = to?.[id] ?? base(id);
    out[id] = a + (b - a) * k;
  }
  return out;
}
