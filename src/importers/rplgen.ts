/*
 * RGL compatibility importer.
 * Grammar/semantics are derived from TRPG-Replay-Generator (GPL-3.0),
 * upstream revision 89e65b63c97a74ebff665be038e6dea2a700ec14.
 * This TypeScript port keeps Replay Lab's own project model rather than
 * reproducing RplGen's Python object graph.
 */
import { createLine, createProject, ensureCharacter } from '../core/project.js';
import type { ReplayImporter } from './types.js';
import type {
  AnimationCurve,
  BackgroundMethod,
  DiceRoll,
  RplGenMethodSpec,
  TextEffect
} from '../core/types.js';
import { parseRplGenMethodToken } from '../renderers/rplgen-motion.js';
import { rplgenMediaDefinitionId } from './rplgen-mediadef.js';

function stripRglMarkup(input: string): string {
  return input
    .replace(/\{\*\}/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\[(?:\/\w{1,2}|fs:\d+|(?:bg|fg):#[\da-fA-F]{6,8}|\w+|\^|#)\]/g, '')
    .replace(/\^/g, '\n')
    .trim();
}

interface RglCharacterToken { name: string; alpha: number | null; subtype: string; }

function parseCharacterToken(input: string): RglCharacterToken {
  const clean = input.trim();
  const match = clean.match(/^(.+?)(?:\((\d+)\))?(?:\.([^\s]+))?$/);
  return {
    name: (match?.[1] ?? clean).trim() || 'Unknown',
    alpha: match?.[2] ? Number(match[2]) : null,
    subtype: (match?.[3] ?? 'default').trim() || 'default'
  };
}

function parseCharacterSet(input: string): RglCharacterToken[] {
  return input.split(/[;,]/).map(parseCharacterToken).filter(token => token.name).slice(0, 3);
}

function cleanCharacterToken(input: string): string { return parseCharacterSet(input)[0]?.name ?? 'Unknown'; }

function methodSeconds(frames: number | null | undefined, fallbackFrames: number): number {
  const f = frames == null ? fallbackFrames : frames;
  return Math.max(0, f / 30);
}

function parseMethodWithDefault(token: string | null | undefined, fallback: RplGenMethodSpec): RplGenMethodSpec {
  return parseRplGenMethodToken(token, fallback.duration) ?? { ...fallback };
}

function asBackgroundMethod(name: string): BackgroundMethod {
  const key = name.split('_')[0]!.toLowerCase();
  return (['replace','delay','cross','black','white','push','cover'] as BackgroundMethod[]).includes(key as BackgroundMethod)
    ? key as BackgroundMethod
    : 'replace';
}

function parseDiceRolls(input: string): DiceRoll[] {
  const rolls: DiceRoll[] = [];
  const re = /\((.+?),(\d+),([\d]+|NA),(\d+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    rolls.push({
      label: stripRglMarkup(match[1] ?? '').trim(),
      sides: Number(match[2]),
      check: /^NA$/i.test(match[3] ?? '') ? null : Number(match[3]),
      result: Number(match[4])
    });
  }
  return rolls;
}

function parseInlineTextMethod(body: string): { text: string; effect?: TextEffect; frames?: number } {
  // RGL order: content + optional <text_method> + optional {sound} blocks.
  const match = body.match(/<(all|w2w|l2l|run)(?:=(\d+(?:\.\d+)?))?>(?=(?:\{[^}]*\})*$)/i);
  if (!match || match.index == null) return { text: body };
  const text = body.slice(0, match.index) + body.slice(match.index + match[0].length);
  return {
    text,
    effect: match[1]!.toLowerCase() as TextEffect,
    frames: match[2] ? Number(match[2]) : undefined
  };
}

function splitBubbleArgs(input: string): string[] {
  const out: string[] = []; let quote: string | null = null, depth = 0, start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (quote) { if (c === quote && input[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') depth += 1; else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { out.push(input.slice(start,i).trim()); start = i + 1; }
  }
  out.push(input.slice(start).trim()); return out.filter(Boolean);
}

function unquoteBubbleText(value: string | undefined): string {
  if (!value) return ''; const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1,-1).replace(/\\n/g,'\n').replace(/\\([\\'"])/g,'$1');
  return v;
}

function parseBubblePayload(payload: string): { definitionId: string | null; headerText: string; mainText: string; effect?: TextEffect; frames?: number; rawDefinition: string } {
  const clean = payload.trim();
  if (/^(?:NA|None)$/i.test(clean)) return { definitionId:null, headerText:'', mainText:'', rawDefinition:clean };
  const call = clean.match(/^(.+?)\((.*)\)$/s);
  if (!call) return { definitionId:rplgenMediaDefinitionId(clean), headerText:'', mainText:'', rawDefinition:clean };
  const defName = call[1]!.trim();
  const args = splitBubbleArgs(call[2]!);
  const headerText = unquoteBubbleText(args[0]);
  const mainText = unquoteBubbleText(args[1]);
  const method = args[2]?.match(/^<(all|w2w|l2l|run)(?:=(\d+(?:\.\d+)?))?>$/i);
  return {
    definitionId:rplgenMediaDefinitionId(defName), headerText, mainText,
    effect: method?.[1]?.toLowerCase() as TextEffect | undefined,
    frames: method?.[2] ? Number(method[2]) : undefined, rawDefinition:defName
  };
}


export const RplGenImporter: ReplayImporter = {
  id: 'rplgen-rgl',
  label: 'RplGen / RGL script',
  extensions: ['.rgl'],
  sniff(input) {
    if (/^\[[\p{L}\p{N}_ .;,()]+\]/mu.test(input) && /^<(?:background|animation|bubble|clear|dice|hitpoint|wait|bgm|BGM)>/m.test(input)) return 0.98;
    if (/^\[[\p{L}\p{N}_ .;,()]+\]\s*(?:<[^>]+>\s*)?[:：]/mu.test(input)) return 0.9;
    if (/^\[[\p{L}\p{N}_ .;,()]+\]/mu.test(input)) return 0.72;
    return 0;
  },
  parse(input, context) {
    const project = createProject(context?.title ?? context?.sourceName ?? 'RplGen script');
    let defaultCurve: AnimationCurve = 'linear';
    let defaultTextEffect: TextEffect = 'all';
    let defaultTextMethodFrames = 0;
    let defaultBgMethod: RplGenMethodSpec = { name: 'replace', duration: 30 / 30 };
    let defaultStageMethod: RplGenMethodSpec = { name: 'replace', duration: 30 / 30 };

    const freshScene = (): NonNullable<ReturnType<typeof createLine>['scene']> => ({
      camera: 'none',
      transition: 'cut',
      cameraCurve: defaultCurve,
      transitionCurve: defaultCurve,
      backgroundMethod: 'replace',
      backgroundMethodDuration: null,
      enterIds: [],
      exitIds: []
    });
    let pendingScene = freshScene();

    for (const raw of input.replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      // [A,B(30).happy]<black_pass_up_minor=30>:text<w2w=2>{SE}
      const dialogue = line.match(/^\[([^\]]+)\]\s*(<[^>]+>)?\s*[:：]?\s*(.*)$/);
      if (dialogue) {
        const characterSet = parseCharacterSet(dialogue[1]!);
        const speaker = characterSet[0]?.name ?? 'Unknown';
        const inlineText = parseInlineTextMethod(dialogue[3] ?? '');
        const created = createLine(project, speaker, stripRglMarkup(inlineText.text));
        created.scene = pendingScene;
        created.textEffect = inlineText.effect ?? defaultTextEffect;
        const textFrames = inlineText.frames ?? defaultTextMethodFrames;
        if (created.textEffect !== 'all' && textFrames > 0) {
          const units = created.textEffect === 'l2l' ? Math.max(1, created.text.split(/\n/).length) : Math.max(1, Array.from(created.text).length);
          created.textEffectDuration = units * textFrames / 30;
        }
        const stageMethod = dialogue[2] ? parseMethodWithDefault(dialogue[2], defaultStageMethod) : { ...defaultStageMethod };
        if (stageMethod.name !== 'replace' || dialogue[2]) created.stageMethod = stageMethod;
        if (characterSet.length > 1) {
          created.stageMode = 'custom';
          created.stageIds = characterSet.map(token => ensureCharacter(project, token.name).id);
        }
        if (characterSet[0]?.subtype && characterSet[0].subtype !== 'default') { created.expression = characterSet[0].subtype; created.expressionMode = 'set'; }
        created.metadata = {
          ...(created.metadata ?? {}),
          rplgen: {
            characterSet: characterSet.map(token => ({ ...token })),
            stageMethod: stageMethod.name
          }
        };
        pendingScene = freshScene();
        project.lines.push(created);
        continue;
      }

      const bg = line.match(/^<background>\s*(<[^>]+>)?\s*:?\s*(.+)$/i);
      if (bg) {
        const method = bg[1] ? parseMethodWithDefault(bg[1], defaultBgMethod) : { ...defaultBgMethod };
        pendingScene.background = /^(NA|None)$/i.test(bg[2]!.trim()) ? null : bg[2]!.trim();
        pendingScene.backgroundMethod = asBackgroundMethod(method.name);
        pendingScene.backgroundMethodDuration = method.duration;
        continue;
      }

      const bgm = line.match(/^<(?:bgm|BGM)>\s*:?\s*(.+)$/);
      if (bgm) { pendingScene.bgm = /^(stop|NA|None)$/i.test(bgm[1]!.trim()) ? null : bgm[1]!.trim(); continue; }
      const clear = line.match(/^<clear>\s*:?\s*(.*)$/i);
      if (clear) { pendingScene.cg = null; continue; }

      const bubble = line.match(/^<bubble>\s*(<[^>]+>)?\s*:?\s*(.+)$/i);
      if (bubble) {
        const parsed = parseBubblePayload(bubble[2]!);
        const text = parsed.mainText || parsed.headerText || parsed.rawDefinition;
        const created = createLine(project, 'System', text, 'bubble');
        created.scene = pendingScene;
        created.mouth = 'off';
        created.textEffect = parsed.effect ?? defaultTextEffect;
        const frames = parsed.frames ?? defaultTextMethodFrames;
        if (created.textEffect !== 'all' && frames > 0) created.textEffectDuration = Math.max(1,Array.from(parsed.mainText || text).length) * frames / 30;
        created.bubble = {
          definitionId: parsed.definitionId, headerText: parsed.headerText, mainText: parsed.mainText,
          textEffect: created.textEffect, textEffectDuration: created.textEffectDuration ?? null,
          metadata: { rplgen: { raw: bubble[2]!.trim(), method: bubble[1] ?? null } }
        };
        if (bubble[1]) created.stageMethod = parseMethodWithDefault(bubble[1], defaultStageMethod);
        pendingScene = freshScene(); project.lines.push(created); continue;
      }

      const dice = line.match(/^<dice>\s*:?\s*(.+)$/i);
      if (dice) {
        const rolls = parseDiceRolls(dice[1]!);
        const text = rolls.length
          ? rolls.map(roll => `${roll.label}: ${roll.result}${roll.check == null ? '' : ` / ${roll.check}`}`).join('\n')
          : stripRglMarkup(dice[1]!);
        const created = createLine(project, 'DiceBot', text, 'dice');
        created.scene = pendingScene;
        created.diceRolls = rolls;
        created.textEffect = defaultTextEffect;
        if (defaultTextEffect !== 'all' && defaultTextMethodFrames > 0) created.textEffectDuration = Math.max(1, Array.from(created.text).length) * defaultTextMethodFrames / 30;
        pendingScene = freshScene();
        project.lines.push(created);
        continue;
      }

      const hitpoint = line.match(/^<hitpoint>\s*:?\s*\((.+?),(\d+),(\d+),(\d+)\)\s*$/i);
      if (hitpoint) {
        const created = createLine(project, 'System', hitpoint[1]!.trim(), 'hitpoint');
        created.scene = pendingScene;
        created.hitPoint = {
          label: hitpoint[1]!.trim(),
          max: Number(hitpoint[2]),
          before: Number(hitpoint[3]),
          after: Number(hitpoint[4])
        };
        created.mouth = 'off';
        pendingScene = freshScene();
        project.lines.push(created);
        continue;
      }

      const txDefault = line.match(/^<set:tx_method_default>\s*:?\s*<(all|w2w|l2l|run)(?:=(\d+(?:\.\d+)?))?>/i);
      if (txDefault) { defaultTextEffect = txDefault[1].toLowerCase() as TextEffect; defaultTextMethodFrames = Number(txDefault[2] ?? 0); continue; }
      const formula = line.match(/^<set:formula>\s*:?\s*(linear|quadratic|quadraticR|sigmoid|right|left|sincurve)/i);
      if (formula) { defaultCurve = formula[1] as AnimationCurve; pendingScene.cameraCurve = defaultCurve; pendingScene.transitionCurve = defaultCurve; continue; }

      const bgMethodDefault = line.match(/^<set:bg_method_default>\s*:?\s*(<[^>]+>)/i);
      if (bgMethodDefault) { defaultBgMethod = parseMethodWithDefault(bgMethodDefault[1], defaultBgMethod); continue; }
      const amMethodDefault = line.match(/^<set:am_method_default>\s*:?\s*(<[^>]+>)/i);
      if (amMethodDefault) { defaultStageMethod = parseMethodWithDefault(amMethodDefault[1], defaultStageMethod); continue; }
      const bgDurDefault = line.match(/^<set:bg_dur_default>\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (bgDurDefault) { defaultBgMethod.duration = methodSeconds(Number(bgDurDefault[1]), 30); continue; }
      const amDurDefault = line.match(/^<set:am_dur_default>\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (amDurDefault) { defaultStageMethod.duration = methodSeconds(Number(amDurDefault[1]), 30); continue; }
      const txDurDefault = line.match(/^<set:tx_dur_default>\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (txDurDefault) { defaultTextMethodFrames = Number(txDurDefault[1]); continue; }

      // RplGen wait is frame-oriented (30 fps).
      const wait = line.match(/^<wait>\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (wait && project.lines.length) {
        project.lines[project.lines.length - 1]!.duration = Number(wait[1]) / 30;
        project.lines[project.lines.length - 1]!.metadata = {
          ...(project.lines[project.lines.length - 1]!.metadata ?? {}),
          rplgenWait: Number(wait[1])
        };
        continue;
      }

      const setChar = line.match(/^<set:charactor>\s*:?\s*(.+)$/i);
      if (setChar) ensureCharacter(project, cleanCharacterToken(setChar[1]!));
    }
    return project;
  }
};
