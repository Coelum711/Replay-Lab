import type { CharacterLayerSet, ImageSet, MediaAsset, ReplayProject } from '../core/types.js';
import { suggestCharacterDuplicates } from './characters.js';
import { parseDirectorCommand } from '../core/directives.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticCode =
  | 'duplicate-id'
  | 'unknown-speaker'
  | 'missing-asset-reference'
  | 'missing-media-definition'
  | 'character-without-idle'
  | 'unused-asset'
  | 'ambiguous-character-alias'
  | 'invalid-director-command';

export interface ProjectDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  lineId?: string;
  characterId?: string;
  assetId?: string;
  ref?: string;
}

function resolveAsset(project: ReplayProject, ref: string | null | undefined): MediaAsset | undefined {
  if (!ref) return undefined;
  return project.assets.find(a => a.id === ref || a.name === ref || a.sourcePath === ref || a.sourcePath?.endsWith('/' + ref));
}

function imageRefs(set: ImageSet | undefined): string[] {
  if (!set) return [];
  return [set.idle, set.open, set.blink, set.A, set.I, set.U, set.E, set.O].filter((x): x is string => Boolean(x));
}

function layerRefs(set: CharacterLayerSet | undefined): string[] {
  if (!set) return [];
  return [set.base, set.overlay, set.eyesOpen, set.eyesClosed, set.eyelidsOpen, set.eyelidsClosed, set.pupils, set.brows,
    set.eyeLeftOpen, set.eyeLeftClosed, set.eyeRightOpen, set.eyeRightClosed,
    set.eyelidLeftOpen, set.eyelidLeftClosed, set.eyelidRightOpen, set.eyelidRightClosed,
    set.pupilLeft, set.pupilRight, set.browLeft, set.browRight,
    set.mouthClosed, set.mouthOpen, set.mouthA, set.mouthI, set.mouthU, set.mouthE, set.mouthO, set.mouthSchwa, set.mouthAe, set.mouthUu, set.mouthOo, set.mouthW, set.mouthF, set.mouthTh, set.mouthM]
    .filter((x): x is string => Boolean(x));
}

export function collectReferencedAssetRefs(project: ReplayProject): Set<string> {
  const refs = new Set<string>();
  for (const character of project.characters) {
    for (const ref of imageRefs(character.images)) refs.add(ref);
    for (const set of Object.values(character.expressions)) for (const ref of imageRefs(set)) refs.add(ref);
    for (const ref of layerRefs(character.layers)) refs.add(ref);
    for (const set of Object.values(character.layerExpressions ?? {})) for (const ref of layerRefs(set)) refs.add(ref);
  }
  for (const template of project.faceTemplates ?? []) for (const ref of layerRefs(template.layers)) refs.add(ref);
  for (const object of project.customObjects ?? []) for (const state of object.states ?? []) if (state.assetId) refs.add(state.assetId);
  for (const line of project.lines) {
    if (line.audioAssetId) refs.add(line.audioAssetId);
    if (line.sfxAssetId) refs.add(line.sfxAssetId);
    if (line.scene?.background) refs.add(line.scene.background);
    if (line.scene?.cg) refs.add(line.scene.cg);
    if (line.scene?.bgm) refs.add(line.scene.bgm);
    if (line.scene?.ambient) refs.add(line.scene.ambient);
    if (line.command?.assetId) refs.add(line.command.assetId);
  }
  return refs;
}

export function diagnoseProject(project: ReplayProject, options: { includeUnused?: boolean; includePlaceholderArtInfo?: boolean } = {}): ProjectDiagnostic[] {
  const out: ProjectDiagnostic[] = [];
  const seen = new Set<string>();
  const allIds = [
    ...project.characters.map(x => ({ id: x.id, label: `角色 ${x.name}` })),
    ...project.lines.map(x => ({ id: x.id, label: `台词 ${x.id}` })),
    ...project.assets.map(x => ({ id: x.id, label: `素材 ${x.name}` })),
    ...(project.customObjects ?? []).map(x => ({ id: x.id, label: `自定义对象 ${x.name}` })),
    ...(project.mediaDefinitions ?? []).map(x => ({ id: x.id, label: `媒体定义 ${x.name}` })),
    ...(project.faceTemplates ?? []).map(x => ({ id: x.id, label: `脸部模板 ${x.name}` }))
  ];
  for (const item of allIds) {
    if (seen.has(item.id)) out.push({ code: 'duplicate-id', severity: 'error', message: `${item.label} 使用了重复 ID：${item.id}` });
    seen.add(item.id);
  }

  for (const suggestion of suggestCharacterDuplicates(project)) {
    out.push({ code: 'ambiguous-character-alias', severity: 'warning', characterId: suggestion.keepId, message: `角色身份可能重复：${suggestion.keepName} / ${suggestion.mergeName}（${suggestion.reason}）。请在角色页确认是否合并。` });
  }

  const characterIds = new Set(project.characters.map(c => c.id));
  for (const line of project.lines) {
    if (line.type === 'command') {
      const parsed = parseDirectorCommand(project, line.text);
      if (!parsed.command) out.push({ code: 'invalid-director-command', severity: 'error', lineId: line.id, message: `导演指令无法解析：${parsed.error || line.text}` });
    } else if (!characterIds.has(line.speakerId)) out.push({ code: 'unknown-speaker', severity: 'error', lineId: line.id, message: `台词引用了不存在的角色：${line.speakerId}` });
    const refs: Array<[string, string | null | undefined]> = [
      ['语音', line.audioAssetId], ['SFX', line.sfxAssetId], ['背景', line.scene?.background], ['CG', line.scene?.cg], ['BGM', line.scene?.bgm], ['环境声', line.scene?.ambient]
    ];
    for (const [label, ref] of refs) if (ref && !resolveAsset(project, ref)) out.push({ code: 'missing-asset-reference', severity: 'error', lineId: line.id, ref, message: `${label} 引用了不存在的素材：${ref}` });
    const defIds = new Set((project.mediaDefinitions ?? []).map(def => def.id));
    if (line.dialogueStyleId && !defIds.has(line.dialogueStyleId)) out.push({ code:'missing-media-definition', severity:'error', lineId:line.id, ref:line.dialogueStyleId, message:`台词引用了不存在的对话框定义：${line.dialogueStyleId}` });
    if (line.bubble?.definitionId && !defIds.has(line.bubble.definitionId)) out.push({ code:'missing-media-definition', severity:'error', lineId:line.id, ref:line.bubble.definitionId, message:`Bubble 引用了不存在的媒体定义：${line.bubble.definitionId}` });
  }

  const defIds = new Set((project.mediaDefinitions ?? []).map(def => def.id));
  for (const def of project.mediaDefinitions ?? []) {
    if (def.type === 'bubble' || def.type === 'balloon' || def.type === 'dynamic-bubble') {
      if (def.mainTextStyleId && !defIds.has(def.mainTextStyleId)) out.push({ code:'missing-media-definition', severity:'error', ref:def.mainTextStyleId, message:`${def.name} 的主文本样式不存在：${def.mainTextStyleId}` });
      if (def.headerTextStyleId && !defIds.has(def.headerTextStyleId)) out.push({ code:'missing-media-definition', severity:'error', ref:def.headerTextStyleId, message:`${def.name} 的标题样式不存在：${def.headerTextStyleId}` });
      for (const header of def.headers ?? []) if (header.textStyleId && !defIds.has(header.textStyleId)) out.push({ code:'missing-media-definition', severity:'error', ref:header.textStyleId, message:`${def.name} 的多标题样式不存在：${header.textStyleId}` });
      if (def.backgroundAssetId && !resolveAsset(project,def.backgroundAssetId)) out.push({ code:'missing-asset-reference', severity:'error', ref:def.backgroundAssetId, message:`${def.name} 的气泡背景素材不存在：${def.backgroundAssetId}` });
    } else if (def.type === 'chat-window') {
      if (def.backgroundAssetId && !resolveAsset(project,def.backgroundAssetId)) out.push({ code:'missing-asset-reference', severity:'error', ref:def.backgroundAssetId, message:`${def.name} 的聊天窗背景素材不存在：${def.backgroundAssetId}` });
      for (const part of def.participants ?? []) {
        if (part.bubbleDefinitionId && !defIds.has(part.bubbleDefinitionId)) out.push({ code:'missing-media-definition', severity:'error', ref:part.bubbleDefinitionId, message:`${def.name} 中 ${part.key} 的子气泡不存在：${part.bubbleDefinitionId}` });
        if (part.avatarDefinitionId && !defIds.has(part.avatarDefinitionId)) out.push({ code:'missing-media-definition', severity:'error', ref:part.avatarDefinitionId, message:`${def.name} 中 ${part.key} 的头像定义不存在：${part.avatarDefinitionId}` });
      }
    } else if (def.type === 'image' && def.assetId && !resolveAsset(project,def.assetId)) {
      out.push({ code:'missing-asset-reference', severity:'error', ref:def.assetId, message:`${def.name} 的图像素材不存在：${def.assetId}` });
    }
  }


  for (const object of project.customObjects ?? []) {
    const stateIds = new Set<string>();
    for (const state of object.states ?? []) {
      if (stateIds.has(state.id)) out.push({ code:'duplicate-id', severity:'error', message:`自定义对象 ${object.name} 存在重复状态 ID：${state.id}` });
      stateIds.add(state.id);
      if (state.assetId && !resolveAsset(project,state.assetId)) out.push({ code:'missing-asset-reference', severity:'error', ref:state.assetId, message:`自定义对象 ${object.name} 的状态「${state.name}」引用了不存在的素材：${state.assetId}` });
    }
    if (object.initialStateId && !stateIds.has(object.initialStateId)) out.push({ code:'missing-media-definition', severity:'error', ref:object.initialStateId, message:`自定义对象 ${object.name} 的初始状态不存在：${object.initialStateId}` });
    const hotspotIds = new Set<string>();
    for (const hotspot of object.hotspots ?? []) {
      if (hotspotIds.has(hotspot.id)) out.push({ code:'duplicate-id', severity:'error', message:`自定义对象 ${object.name} 存在重复热点 ID：${hotspot.id}` });
      hotspotIds.add(hotspot.id);
      if (hotspot.stateId && !stateIds.has(hotspot.stateId)) out.push({ code:'missing-media-definition', severity:'error', ref:hotspot.stateId, message:`自定义对象 ${object.name} 的热点「${hotspot.label}」限定了不存在的状态。` });
      if (hotspot.action === 'state' && (!hotspot.targetStateId || !stateIds.has(hotspot.targetStateId))) out.push({ code:'missing-media-definition', severity:'error', ref:hotspot.targetStateId ?? undefined, message:`自定义对象 ${object.name} 的热点「${hotspot.label}」没有有效的目标状态。` });
    }
  }
  const objectIds = new Set((project.customObjects ?? []).map(object => object.id));
  for (const take of project.customObjectTakes ?? []) {
    if (!objectIds.has(take.objectId)) out.push({ code:'missing-media-definition', severity:'error', ref:take.objectId, message:`对象交互录制「${take.name}」引用了不存在的自定义对象。` });
  }

  for (const template of project.faceTemplates ?? []) {
    for (const ref of layerRefs(template.layers)) if (!resolveAsset(project, ref)) out.push({ code: 'missing-asset-reference', severity: 'error', ref, message: `脸部模板 ${template.name} 引用了不存在的素材：${ref}` });
  }

  for (const character of project.characters) {
    if (character.faceFit?.templateId && !(project.faceTemplates ?? []).some(template => template.id === character.faceFit.templateId)) out.push({ code: 'missing-media-definition', severity: 'error', characterId: character.id, ref: character.faceFit.templateId, message: `${character.name} 引用了不存在的脸部模板：${character.faceFit.templateId}` });
    if (options.includePlaceholderArtInfo && !character.layers?.base && !character.images?.idle && !Object.values(character.expressions ?? {}).some(set => set.idle)) {
      out.push({ code: 'character-without-idle', severity: 'info', characterId: character.id, message: `${character.name} 还没有角色底图；舞台会先用带名字、可眨眼/张嘴的占位角色。` });
    }
    for (const ref of [
      ...imageRefs(character.images),
      ...Object.values(character.expressions ?? {}).flatMap(imageRefs),
      ...layerRefs(character.layers),
      ...Object.values(character.layerExpressions ?? {}).flatMap(layerRefs)
    ]) {
      if (!resolveAsset(project, ref)) out.push({ code: 'missing-asset-reference', severity: 'error', characterId: character.id, ref, message: `${character.name} 的立绘槽引用了不存在的素材：${ref}` });
    }
  }

  if (options.includeUnused) {
    const refs = collectReferencedAssetRefs(project);
    for (const asset of project.assets) if (!refs.has(asset.id) && !refs.has(asset.name) && (!asset.sourcePath || !refs.has(asset.sourcePath))) {
      out.push({ code: 'unused-asset', severity: 'info', assetId: asset.id, message: `素材尚未在演出中使用：${asset.name}` });
    }
  }
  return out;
}
