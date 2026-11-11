import type { DirectorBeat, DirectorBeatChange, ReplayDirectorCommand, ReplayLine, ReplayProject } from './types.js';

function commandLabel(command: ReplayDirectorCommand | null | undefined, line: ReplayLine, project: ReplayProject): string {
  if (!command) return line.text.trim() || '未解析指令';
  const character = command.characterId ? project.characters.find(c => c.id === command.characterId) : null;
  const asset = command.assetId ? project.assets.find(a => a.id === command.assetId) : null;
  const who = character?.name ?? command.target ?? '';
  const media = asset?.name ?? command.target ?? '';
  switch (command.kind) {
    case 'expression': return `${who || '角色'} → ${command.expression ?? 'default'}`;
    case 'pose': return `${who || '角色'} 姿势 → ${command.value ?? 'default'}`;
    case 'outfit': return `${who || '角色'} 服装 → ${command.value ?? 'default'}`;
    case 'enter': return `${who || '角色'} 上场${command.position && command.position !== 'auto' ? ` · ${command.position}` : ''}`;
    case 'dismiss': return `${who || '角色'} 退场`;
    case 'move': return `${who || '角色'} 调整位置`;
    case 'motion': return `${who || '角色'} 动作 · ${command.value ?? '自定义动作'}`;
    case 'background': return `背景 → ${media || '清除'}`;
    case 'cg': return `CG → ${media || '清除'}`;
    case 'object': { const object = command.objectId ? project.customObjects.find(item => item.id === command.objectId) : null; return `对象 · ${object?.name ?? command.target ?? '未绑定'} · ${command.objectAction ?? 'show'}`; }
    case 'bgm': return command.assetId ? `BGM → ${media}` : '停止 BGM';
    case 'ambient': return command.assetId ? `环境声 → ${media}` : '停止环境声';
    case 'sfx': return `SFX · ${media || '未绑定'}`;
    case 'camera': return `镜头 · ${command.value ?? 'none'}`;
    case 'transition': return `转场 · ${command.value ?? 'cut'}`;
    case 'scene': return `Scene · ${command.value ?? ''}`;
    case 'chapter': return `Chapter · ${command.value ?? ''}`;
    case 'wait': return `等待 ${Math.max(0, Number(command.duration) || 0)}s`;
    default: return line.text.trim() || command.kind;
  }
}

/**
 * Groups consecutive director-command rows into author-readable beats. Commands
 * remain independent, draggable source rows; a beat is a derived view, not a
 * second source of truth.
 */
export function buildDirectorBeats(project: ReplayProject): DirectorBeat[] {
  const beats: DirectorBeat[] = [];
  let index = 0;
  while (index < project.lines.length) {
    if (project.lines[index]?.type !== 'command') { index += 1; continue; }
    const start = index;
    const commandLines: ReplayLine[] = [];
    while (index < project.lines.length && project.lines[index]?.type === 'command') {
      commandLines.push(project.lines[index]!);
      index += 1;
    }
    const target = index < project.lines.length ? project.lines[index]! : null;
    const changes: DirectorBeatChange[] = commandLines.map(line => ({
      kind: line.command?.kind === 'expression' ? 'expression' : 'command',
      lineId: line.id,
      command: line.command ? structuredClone(line.command) : undefined,
      characterId: line.command?.characterId ?? null,
      label: commandLabel(line.command, line, project)
    }));
    const summary = changes.length === 1 ? changes[0]!.label : changes.slice(0, 3).map(change => change.label).join(' · ') + (changes.length > 3 ? ` · +${changes.length - 3}` : '');
    const timingMode = commandLines.find(line => line.command?.beatMode)?.command?.beatMode ?? 'sequence';
    beats.push({
      id: `beat:${commandLines[0]!.id}`,
      timingMode,
      startIndex: start,
      endIndex: index - 1,
      commandLineIds: commandLines.map(line => line.id),
      targetLineId: target?.id ?? null,
      changes,
      summary
    });
  }
  return beats;
}

export function directorBeatByLineId(project: ReplayProject): Map<string, DirectorBeat> {
  const result = new Map<string, DirectorBeat>();
  for (const beat of buildDirectorBeats(project)) {
    for (const id of beat.commandLineIds) result.set(id, beat);
    if (beat.targetLineId) result.set(beat.targetLineId, beat);
  }
  return result;
}

export function setDirectorBeatTiming(project: ReplayProject, beatId: string, mode: 'parallel' | 'sequence'): boolean {
  const beat = buildDirectorBeats(project).find(item => item.id === beatId);
  if (!beat) return false;
  let changed = false;
  for (const id of beat.commandLineIds) {
    const line = project.lines.find(item => item.id === id);
    if (!line?.command) continue;
    if (line.command.beatMode !== mode) { line.command.beatMode = mode; changed = true; }
  }
  return changed;
}
