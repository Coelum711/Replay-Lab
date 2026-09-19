/**
 * RplGen MediaDef compatibility layer.
 *
 * Derived from the GPL-3.0 MediaDef grammar/parameter vocabulary in
 * DanDDXuanX/TRPG-Replay-Generator core/ScriptParser.py at
 * 89e65b63c97a74ebff665be038e6dea2a700ec14.
 * Replay Lab normalizes the supported Text/RichText/Bubble/Balloon/
 * DynamicBubble/ChatWindow subset into its own project model and preserves
 * the original parsed arguments in metadata.rplgen.
 */
import type {
  ReplayBubbleDefinition,
  ReplayChatWindowDefinition,
  ReplayImageDefinition,
  ReplayMediaDefinition,
  ReplayTextDefinition,
  TextAlign,
  VerticalAlign
} from '../core/types.js';

export interface RplGenRef { ref: string }
export type RplGenValue = string | number | boolean | null | RplGenRef | RplGenValue[] | { type: string; args: Record<string, RplGenValue> };

const POSITIONAL: Record<string, string[]> = {
  Text: ['fontfile','fontsize','color','line_limit','label_color'],
  StrokeText: ['fontfile','fontsize','color','line_limit','edge_color','edge_width','projection','label_color'],
  RichText: ['fontfile','fontsize','color','line_limit','scale','sub_key','sub_icon','label_color'],
  Bubble: ['filepath','scale','Main_Text','Header_Text','pos','mt_pos','mt_rotate','ht_pos','ht_rotate','ht_target','align','vertical_align','head_align','line_distance','line_num_est','label_color'],
  Balloon: ['filepath','scale','Main_Text','Header_Text','pos','mt_pos','mt_rotate','ht_pos','ht_rotate','ht_target','align','vertical_align','head_align','line_distance','line_num_est','label_color'],
  DynamicBubble: ['filepath','scale','Main_Text','Header_Text','pos','mt_pos','mt_end','ht_pos','ht_target','fill_mode','fit_axis','line_distance','label_color'],
  ChatWindow: ['filepath','scale','sub_key','sub_Bubble','sub_Anime','sub_align','pos','sub_pos','sub_end','am_left','am_right','sub_distance','label_color'],
  Animation: ['filepath','scale','pos','tick','loop','label_color']
};

const SUPPORTED = new Set(Object.keys(POSITIONAL));

export function rplgenMediaDefinitionId(name: string): string {
  return `rplgen-media:${name.trim()}`;
}

function splitTopLevel(input: string, separator = ','): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (quote) {
      if (c === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) { out.push(input.slice(start, i).trim()); start = i + 1; }
  }
  const tail = input.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function topLevelEquals(input: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (quote) { if (c === quote && input[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === '=' && depth === 0) return i;
  }
  return -1;
}

function unquote(input: string): string {
  const body = input.slice(1, -1);
  return body.replace(/\\([\\'"nrt])/g, (_, c: string) => ({ n:'\n', r:'\r', t:'\t' }[c] ?? c));
}

export function parseRplGenMediaValue(input: string): RplGenValue {
  const value = input.trim();
  if (!value) return '';
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) return unquote(value);
  if (/^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(value)) return Number(value);
  if (value === 'None') return null;
  if (value === 'True') return true;
  if (value === 'False') return false;
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('(') && value.endsWith(')'))) {
    return splitTopLevel(value.slice(1, -1)).map(parseRplGenMediaValue);
  }
  const instance = value.match(/^([A-Za-z_]\w*)\((.*)\)$/s);
  if (instance) return { type: instance[1]!, args: parseArgs(instance[1]!, instance[2]!) };
  return { ref: value };
}

function parseArgs(type: string, input: string): Record<string, RplGenValue> {
  const result: Record<string, RplGenValue> = {};
  let positionalIndex = 0;
  for (const part of splitTopLevel(input)) {
    const eq = topLevelEquals(part);
    if (eq >= 0) result[part.slice(0, eq).trim()] = parseRplGenMediaValue(part.slice(eq + 1));
    else {
      const key = POSITIONAL[type]?.[positionalIndex++] ?? `arg${positionalIndex}`;
      result[key] = parseRplGenMediaValue(part);
    }
  }
  return result;
}

function asNumber(value: RplGenValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: RplGenValue | undefined): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'ref' in value) return value.ref;
  return null;
}

function refName(value: RplGenValue | undefined): string | null {
  const name = asString(value);
  return name && name !== 'None' ? name : null;
}

function pair(value: RplGenValue | undefined, fallback: [number,number]): [number,number] {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') return [value[0], value[1]];
  return fallback;
}

function colorCss(value: RplGenValue | undefined, fallback = '#f4f6fb'): string {
  if (typeof value === 'string' && /^#/.test(value)) return value;
  if (Array.isArray(value) && value.length >= 3) {
    const [r,g,b,a=255] = value.map(v => typeof v === 'number' ? v : 0) as number[];
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0,Math.min(255,a))/255})`;
  }
  return fallback;
}

function align(value: RplGenValue | undefined, fallback: TextAlign = 'left'): TextAlign {
  const v = asString(value)?.toLowerCase();
  return v === 'center' || v === 'right' || v === 'left' ? v : fallback;
}

function verticalAlign(value: RplGenValue | undefined): VerticalAlign {
  const v = asString(value)?.toLowerCase();
  return v === 'center' || v === 'bottom' || v === 'top' ? v : 'top';
}

function cleanSourcePath(value: string | null): string | null {
  if (!value || value === 'None') return null;
  return value.replace(/^@\//,'').replace(/^\.\//,'');
}

function rawMeta(type: string, args: Record<string,RplGenValue>, sourceLine: string): Record<string,unknown> {
  return { rplgen: { type, args, sourceLine, revision: '89e65b63c97a74ebff665be038e6dea2a700ec14' } };
}

function textDefinition(name: string, type: string, args: Record<string,RplGenValue>, sourceLine: string): ReplayTextDefinition {
  const rich = type === 'RichText';
  const keys = Array.isArray(args.sub_key) ? args.sub_key.map(asString) : [];
  const icons = Array.isArray(args.sub_icon) ? args.sub_icon.map(asString) : [];
  const iconMap: Record<string,string> = {};
  keys.forEach((key,index) => { const icon = cleanSourcePath(icons[index] ?? null); if (key && icon) iconMap[key] = icon; });
  return {
    id: rplgenMediaDefinitionId(name), name, type: rich ? 'richtext' : 'text',
    fontFamily: asString(args.fontfile),
    fontSize: asNumber(args.fontsize, 40),
    color: colorCss(args.color, '#f4f6fb'),
    align: 'left', lineHeight: 1.3,
    maxCharsPerLine: asNumber(args.line_limit, 20),
    strokeColor: type === 'StrokeText' ? colorCss(args.edge_color, 'rgba(0,0,0,.8)') : null,
    strokeWidth: type === 'StrokeText' ? asNumber(args.edge_width, 1) : null,
    iconMap: Object.keys(iconMap).length ? iconMap : undefined,
    metadata: rawMeta(type,args,sourceLine)
  };
}

function imageDefinition(name:string,args:Record<string,RplGenValue>,sourceLine:string):ReplayImageDefinition {
  const pos=pair(args.pos,[0,0]);
  return {
    id:rplgenMediaDefinitionId(name), name, type:'image',
    source:cleanSourcePath(refName(args.filepath)), assetId:null,
    x:pos[0], y:pos[1], scale:asNumber(args.scale,1),
    metadata:rawMeta('Animation',args,sourceLine)
  };
}

function bubbleDefinition(name: string, type: string, args: Record<string,RplGenValue>, sourceLine: string): ReplayBubbleDefinition {
  const pos = pair(args.pos,[0,0]), mt = pair(args.mt_pos,[50,100]);
  const headerRaw = Array.isArray(args.Header_Text) ? args.Header_Text[0] : args.Header_Text;
  const hp = Array.isArray(args.ht_pos) ? (Array.isArray(args.ht_pos[0]) ? args.ht_pos[0] : args.ht_pos) : args.ht_pos;
  const ht = pair(hp,[0,0]);
  const dynamic = type === 'DynamicBubble';
  const mtEnd = pair(args.mt_end,[86,129]);
  const width = dynamic ? Math.max(320, 640 + Math.max(0,mtEnd[0]-mt[0])*2) : 760;
  const height = dynamic ? Math.max(140, 140 + Math.max(0,mtEnd[1]-mt[1])*2) : 240;
  const headerStyles = Array.isArray(args.Header_Text) ? args.Header_Text : [args.Header_Text];
  const headerPositions = Array.isArray(args.ht_pos) && Array.isArray(args.ht_pos[0]) ? args.ht_pos : [args.ht_pos];
  const headerTargets = Array.isArray(args.ht_target) ? args.ht_target : [args.ht_target];
  const headerAligns = Array.isArray(args.head_align) ? args.head_align : [args.head_align];
  const headers = headerStyles.map((style,index) => ({
    textStyleId: refName(style) ? rplgenMediaDefinitionId(refName(style)!) : null,
    x: pair(headerPositions[index],[0,0])[0], y: pair(headerPositions[index],[0,0])[1],
    target: asString(headerTargets[index]), align: align(headerAligns[index],'left')
  }));
  return {
    id:rplgenMediaDefinitionId(name), name,
    type: type === 'Balloon' ? 'balloon' : dynamic ? 'dynamic-bubble' : 'bubble',
    backgroundSource: cleanSourcePath(refName(args.filepath)), backgroundAssetId:null,
    x:pos[0], y:pos[1], width, height, scale:asNumber(args.scale,1),
    mainTextStyleId: refName(args.Main_Text) ? rplgenMediaDefinitionId(refName(args.Main_Text)!) : null,
    headerTextStyleId: refName(headerRaw) ? rplgenMediaDefinitionId(refName(headerRaw)!) : null,
    mainTextX:mt[0], mainTextY:mt[1], headerTextX:ht[0], headerTextY:ht[1],
    align:align(args.align,'left'), verticalAlign:verticalAlign(args.vertical_align), headerAlign:align(args.head_align,'left'),
    lineDistance:asNumber(args.line_distance,1.3), lineCountEstimate:asNumber(args.line_num_est,4),
    fillMode:asString(args.fill_mode), fitAxis:(asString(args.fit_axis) as 'free'|'vertical'|'horizontal'|null) ?? null,
    mainTextEndX: dynamic ? mtEnd[0] : null, mainTextEndY: dynamic ? mtEnd[1] : null,
    headers: headers.length ? headers : undefined,
    metadata:rawMeta(type,args,sourceLine)
  };
}

function chatDefinition(name:string,args:Record<string,RplGenValue>,sourceLine:string):ReplayChatWindowDefinition {
  const pos=pair(args.pos,[0,0]), start=pair(args.sub_pos,[100,100]), end=pair(args.sub_end,[1200,800]);
  const keys = Array.isArray(args.sub_key) ? args.sub_key.map(asString) : [];
  const bubbles = Array.isArray(args.sub_Bubble) ? args.sub_Bubble : [];
  const avatars = Array.isArray(args.sub_Anime) ? args.sub_Anime : [];
  const aligns = Array.isArray(args.sub_align) ? args.sub_align.map(asString) : [];
  const participants = keys.filter((key):key is string=>Boolean(key)).map((key,index)=>({
    key,
    bubbleDefinitionId:refName(bubbles[index]) ? rplgenMediaDefinitionId(refName(bubbles[index])!) : null,
    avatarDefinitionId:refName(avatars[index]) ? rplgenMediaDefinitionId(refName(avatars[index])!) : null,
    align: aligns[index] === 'right' ? 'right' as const : 'left' as const
  }));
  return {
    id:rplgenMediaDefinitionId(name), name, type:'chat-window',
    backgroundSource:cleanSourcePath(refName(args.filepath)), backgroundAssetId:null,
    x:pos[0], y:pos[1], width:Math.max(320,end[0]-start[0]), height:Math.max(180,end[1]-start[1]), scale:asNumber(args.scale,1),
    subX:start[0], subY:start[1], subWidth:Math.max(1,end[0]-start[0]), subHeight:Math.max(1,end[1]-start[1]),
    avatarLeft:asNumber(args.am_left,0), avatarRight:asNumber(args.am_right,1920),
    messageGap:asNumber(args.sub_distance,0), align:(aligns[0] as TextAlign) ?? 'left', participants,
    metadata:rawMeta('ChatWindow',args,sourceLine)
  };
}

export function looksLikeRplGenMediaDef(input: string): boolean {
  return /^\s*[^#\r\n=]+\s*=\s*(?:Text|StrokeText|RichText|Bubble|Balloon|DynamicBubble|ChatWindow|Animation)\s*\(/m.test(input);
}

export function parseRplGenMediaDef(input: string): ReplayMediaDefinition[] {
  const out: ReplayMediaDefinition[] = [];
  for (const sourceLine of input.replace(/\r/g,'').split('\n')) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(.+?)\s*=\s*([A-Za-z_]\w*)\((.*)\)\s*$/s);
    if (!m || !SUPPORTED.has(m[2]!)) continue;
    const [,rawName,type,argText] = m;
    const name = rawName!.trim();
    const args = parseArgs(type!,argText!);
    if (type === 'Text' || type === 'StrokeText' || type === 'RichText') out.push(textDefinition(name,type,args,sourceLine));
    else if (type === 'Animation') out.push(imageDefinition(name,args,sourceLine));
    else if (type === 'ChatWindow') out.push(chatDefinition(name,args,sourceLine));
    else out.push(bubbleDefinition(name,type!,args,sourceLine));
  }
  return out;
}
