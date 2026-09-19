import { createLine } from '../core/project.js';
import type { ReplayProject, WheelEvent, WheelOption, WheelStep } from '../core/types.js';

type UnknownRecord = Record<string, unknown>;

export interface WheelHistoryArchive {
  chars?: Array<UnknownRecord>;
  events?: Array<UnknownRecord>;
  history?: Array<UnknownRecord>;
  singleWeights?: Record<string, number>;
  pairMeta?: Record<string, UnknownRecord>;
  settings?: UnknownRecord;
}

export interface WheelHistoryImportSummary {
  imported: number;
  skipped: number;
  lines: string[];
}

function asArchive(input: string | unknown): WheelHistoryArchive {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  if (!value || typeof value !== 'object') throw new Error('转盘档案不是 JSON 对象。');
  const obj = value as WheelHistoryArchive;
  if (!Array.isArray(obj.history)) throw new Error('没有找到 history 历史记录。请导入隔壁转盘“导出 JSON”的完整档案。');
  return obj;
}

function chars(archive: WheelHistoryArchive): Array<{ id: string; name: string; status: string }> {
  return (archive.chars ?? []).map(item => ({ id: String(item.id ?? ''), name: String(item.name ?? '?'), status: String(item.status ?? '存活') })).filter(item => item.id);
}

function eventById(archive: WheelHistoryArchive, id: unknown): UnknownRecord | undefined {
  return (archive.events ?? []).find(item => String(item.id ?? '') === String(id ?? ''));
}

function charName(archive: WheelHistoryArchive, id: unknown): string {
  return chars(archive).find(c => c.id === String(id ?? ''))?.name ?? '?';
}

function weightOption(id: string, label: string, weight: unknown): WheelOption {
  return { id, label, weight: Math.max(0, Number(weight) || 0), characterId: id };
}

function activeSingleOptions(archive: WheelHistoryArchive, excluded = new Set<string>()): WheelOption[] {
  const weights = archive.singleWeights ?? {};
  return chars(archive)
    .filter(c => c.status !== '死亡' && !excluded.has(c.id))
    .map(c => weightOption(c.id, c.name, weights[c.id] ?? 1))
    .filter(option => option.weight > 0);
}

function eventMemberOptions(archive: WheelHistoryArchive, event: UnknownRecord | undefined, slot: 'A' | 'B', excluded = new Set<string>()): WheelOption[] {
  const members = (event?.members && typeof event.members === 'object' ? event.members : {}) as Record<string, UnknownRecord>;
  return chars(archive).filter(c => c.status !== '死亡' && !excluded.has(c.id)).flatMap(c => {
    const member = members[c.id] ?? {};
    const mode = String(member.mode ?? 'both');
    if (mode === 'off' || (slot === 'A' && mode === 'B') || (slot === 'B' && mode === 'A')) return [];
    const weight = slot === 'A' ? member.weightA ?? 1 : member.weightB ?? 1;
    const option = weightOption(c.id, c.name, weight);
    return option.weight > 0 ? [option] : [];
  });
}

function averageEventOptions(archive: WheelHistoryArchive, event: UnknownRecord | undefined, excluded = new Set<string>()): WheelOption[] {
  const members = (event?.members && typeof event.members === 'object' ? event.members : {}) as Record<string, UnknownRecord>;
  return chars(archive).filter(c => c.status !== '死亡' && !excluded.has(c.id)).flatMap(c => {
    const member = members[c.id] ?? {};
    if (String(member.mode ?? 'both') === 'off') return [];
    const a = Math.max(0, Number(member.weightA ?? 1) || 0);
    const b = Math.max(0, Number(member.weightB ?? 1) || 0);
    const option = weightOption(c.id, c.name, (a + b) / 2);
    return option.weight > 0 ? [option] : [];
  });
}

function step(title: string, options: WheelOption[], resultId: string | null, resultLabel: string, note = ''): WheelStep {
  let safe = options.filter(option => option.weight > 0);
  if (resultId && !safe.some(option => option.id === resultId)) safe = [...safe, { id: resultId, label: resultLabel, weight: 1, characterId: resultId }];
  if (!safe.length) safe = [{ id: resultId || 'result', label: resultLabel, weight: 1, characterId: resultId }];
  return { title, options: safe, resultId, resultLabel, note };
}

function sourceFor(record: UnknownRecord) {
  return {
    app: '恋综大逃杀 · 关系与事件模拟器',
    recordId: String(record.id ?? ''),
    recordType: String(record.type ?? ''),
    group: String(record.group ?? ''),
    day: Number(record.day ?? 0) || undefined,
    round: Number(record.round ?? 0) || undefined,
    timestamp: String(record.timestamp ?? '') || undefined
  };
}

export function wheelEventFromHistoryRecord(archiveInput: WheelHistoryArchive, record: UnknownRecord): WheelEvent | null {
  const archive = archiveInput;
  const type = String(record.type ?? '');
  const note = String(record.note ?? '');
  const title = String(record.title ?? '历史转盘');
  const steps: WheelStep[] = [];

  if (type === 'single') {
    const ids = Array.isArray(record.participantIds) ? record.participantIds.map(String) : [String(record.charId ?? '')].filter(Boolean);
    const used = new Set<string>();
    ids.forEach((id, index) => {
      const label = charName(archive, id);
      steps.push(step(ids.length > 1 ? `人物抽取 ${index + 1}/${ids.length}` : String(title.split('：')[0] || '普通人物盘'), activeSingleOptions(archive, used), id, label));
      used.add(id);
    });
  } else if (type === 'draw') {
    const event = eventById(archive, record.eventId);
    const aId = String(record.aId ?? ''); const bId = String(record.bId ?? '');
    const slotA = String(event?.slotA ?? 'A位'); const slotB = String(event?.slotB ?? 'B位');
    if (aId) steps.push(step(`${String(event?.name ?? '双人事件')} · ${slotA}`, eventMemberOptions(archive, event, 'A'), aId, charName(archive, aId)));
    const excluded = new Set<string>(); if (aId && event?.allowSame !== true) excluded.add(aId);
    if (bId) steps.push(step(`${String(event?.name ?? '双人事件')} · ${slotB}`, eventMemberOptions(archive, event, 'B', excluded), bId, charName(archive, bId)));
  } else if (type === 'party') {
    const ids = Array.isArray(record.participantIds) ? record.participantIds.map(String) : [];
    const event = eventById(archive, record.eventId);
    const sourceEventId = String((archive.settings?.partySourceEventId ?? record.eventId) || '');
    const sourceEvent = eventById(archive, sourceEventId) ?? event;
    const used = new Set<string>();
    ids.forEach((id, index) => {
      steps.push(step(`多人场景 · 第 ${index + 1} 人`, averageEventOptions(archive, sourceEvent, used), id, charName(archive, id), index === 0 && sourceEventId !== String(record.eventId ?? '') ? '权重来源按档案当前“人物抽取权重来源”重建' : ''));
      used.add(id);
    });
    // The historical record preserves the chosen event but not the exact eligible event pool
    // at that moment. Keep the event in the line title/provenance instead of faking a one-option wheel.
  } else if (type === 'relation' && /攻受锁定/.test(title)) {
    const names = title.replace(/攻受锁定.*$/, '').split('×').map(x => x.trim()).filter(Boolean);
    if (names.length >= 2) {
      const [a, b] = names;
      const aId = chars(archive).find(c => c.name === a)?.id ?? a!;
      const bId = chars(archive).find(c => c.name === b)?.id ?? b!;
      const key = [aId, bId].sort().join('__');
      const weights = Array.isArray(archive.pairMeta?.[key]?.sexWeights) ? archive.pairMeta![key]!.sexWeights as unknown[] : [1,1,1];
      const options: WheelOption[] = [
        { id: 'ab', label: `${a}攻 / ${b}受`, weight: Number(weights[0]) || 1 },
        { id: 'ba', label: `${b}攻 / ${a}受`, weight: Number(weights[1]) || 1 },
        { id: 'vers', label: '无差', weight: Number(weights[2]) || 1 }
      ];
      const result = String(record.detail ?? '无差');
      const chosen = options.find(o => o.label === result)?.id ?? 'vers';
      steps.push(step(`${a} × ${b} · 攻受确定`, options, chosen, result));
    }
  } else return null;

  if (!steps.length) return null;
  return { title, mode: 'history', steps, source: sourceFor(record), blockingAuto: false, metadata: { importedNote: note } };
}

export function appendWheelHistoryToProject(project: ReplayProject, input: string | unknown): WheelHistoryImportSummary {
  const archive = asArchive(input);
  const history = [...(archive.history ?? [])].sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));
  let imported = 0, skipped = 0;
  const lineIds: string[] = [];
  for (const record of history) {
    const wheel = wheelEventFromHistoryRecord(archive, record);
    if (!wheel) { skipped += 1; continue; }
    const resultText = wheel.steps.map(s => s.resultLabel).join(' → ');
    const line = createLine(project, '系统', `${wheel.title}${resultText ? `：${resultText}` : ''}`, 'wheel');
    line.wheel = wheel;
    line.duration = Math.max(2.8, wheel.steps.length * 2.15);
    line.mouth = 'off';
    line.metadata = { ...(line.metadata ?? {}), wheelHistoryImported: true, sourceRecordId: wheel.source?.recordId };
    project.lines.push(line);
    lineIds.push(line.id);
    imported += 1;
  }
  return { imported, skipped, lines: lineIds };
}
