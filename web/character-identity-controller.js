import { suggestCharacterDuplicates, planCharacterMerge, mergeCharacters, planCharacterRemoval, removeCharacter } from '../dist/index.js';

function humanMergeConflict(path) {
  if (path === 'kind') return '角色类型';
  if (path === 'showOnStage') return '自动上镜';
  if (path === 'defaultPosition') return '默认站位';
  if (path === 'stagePositions') return '同句舞台站位';
  if (path === 'stageTransforms') return '舞台摆放';
  if (path === 'sceneGraph.nodeOverrides') return '角色图层 / 滤镜';
  if (path === 'speech.ttsProvider') return '声音服务';
  if (path === 'speech.translationProvider') return '翻译服务';
  if (path === 'puppet') return 'Puppet / 形变';
  if (path === 'faceFit') return 'Face Fit 五官位置';
  if (path === 'voice') return '旧式声音设置';
  if (path === 'speech.defaultLanguage') return '朗读语言';
  if (path === 'speech.pauseScale') return '朗读停顿强度';
  if (path.startsWith('speech.voices.')) return `语音 ${path.slice('speech.voices.'.length)}`;
  if (path.startsWith('speech.accents.')) return `口音 ${path.slice('speech.accents.'.length)}`;
  if (path === 'layers.base') return '角色底图';
  if (path.startsWith('layers.')) return `角色五官 ${path.slice('layers.'.length)}`;
  if (path.startsWith('expressions.')) return '整帧表情立绘';
  if (path.startsWith('layerExpressions.')) return '分层表情素材';
  return path;
}

function humanMergeFill(path) {
  if (path === 'defaultPosition') return '默认站位';
  if (path === 'puppet') return 'Puppet / 形变';
  if (path === 'faceFit') return 'Face Fit';
  if (path === 'voice') return '旧式声音设置';
  if (path === 'speech.defaultLanguage') return '朗读语言';
  if (path === 'speech.pauseScale') return '朗读停顿';
  if (path === 'speech.translationProvider') return '翻译提供方';
  if (path === 'speech.ttsProvider') return 'TTS 提供方';
  if (path.startsWith('speech.voices.')) return `语音 ${path.slice('speech.voices.'.length)}`;
  if (path.startsWith('speech.accents.')) return `口音 ${path.slice('speech.accents.'.length)}`;
  if (path === 'layers.base') return '角色底图';
  if (path.startsWith('layers.')) return `角色五官 ${path.slice('layers.'.length)}`;
  if (path.startsWith('images.')) return `整帧立绘 ${path.slice('images.'.length)}`;
  if (path.startsWith('expressions.')) return '整帧表情立绘';
  if (path.startsWith('layerExpressions.')) return '分层表情素材';
  return path;
}

export class CharacterIdentityController {
  constructor(options = {}) {
    this.options = options;
  }

  mountActions(host, characterId) {
    const { project, escapeHtml, onRemoved, setStatus } = this.options;
    const plan = planCharacterRemoval(project, characterId);
    host.innerHTML = `<div class="row character-cleanup-actions"><strong>${escapeHtml(plan.name)}</strong><button type="button" data-character-open-merge ${project.characters.length < 2 ? 'disabled' : ''}>合并到…</button><button type="button" class="danger" data-character-open-delete>删除角色</button></div><div class="character-delete-review stack" data-character-delete-review hidden><strong>删除“${escapeHtml(plan.name)}”</strong><div data-character-delete-impact></div><div class="row"><button type="button" class="danger" data-character-delete-apply ${plan.canRemove ? '' : 'disabled'}>确认删除</button><button type="button" data-character-delete-merge ${project.characters.length < 2 ? 'disabled' : ''}>选择合并目标</button><button type="button" data-character-delete-cancel>取消</button></div></div>`;
    const review = host.querySelector('[data-character-delete-review]');
    host.querySelector('[data-character-delete-impact]').textContent = plan.canRemove
      ? `当前剧本没有引用这个角色。删除角色配置，素材文件保留。可用顶部“撤销”恢复。`
      : `这个角色关联 ${plan.lines} 行台本，并可能有舞台或演出引用。请合并到正确角色，台词、录音和演出会一起保留。`;
    host.querySelector('[data-character-open-merge]').onclick = () => this.openMerge?.(characterId);
    host.querySelector('[data-character-open-delete]').onclick = () => { review.hidden = !review.hidden; };
    host.querySelector('[data-character-delete-cancel]').onclick = () => { review.hidden = true; };
    host.querySelector('[data-character-delete-merge]').onclick = () => this.openMerge?.(characterId);
    host.querySelector('[data-character-delete-apply]').onclick = () => {
      try { const result = removeCharacter(project, characterId); onRemoved?.(result); }
      catch (error) { setStatus?.(error.message); host.querySelector('[data-character-delete-impact]').textContent = error.message; }
    };
  }

  mount(host) {
    const {
      project,
      escapeHtml,
      onMerged,
      setStatus
    } = this.options;
    if (!host || !project || project.characters.length < 2) return null;

    const suggestions = suggestCharacterDuplicates(project);
    const identity = document.createElement('details');
    identity.className = 'card character-identity';
    identity.innerHTML = `
      <summary>${suggestions.length ? '可能有重复角色' : '角色身份 / 手动合并'}
        <span class="summary-meta">${suggestions.length ? `${suggestions.length} 组` : '可撤销'}</span>
      </summary>
      <div class="stack disclosure-body">
        <div class="muted">这里只做保守提示：大小写、全半角、标点差异和已经确认的导入别名可以发现；Matthew ↔ 马修这类跨语言关系不会自动猜。</div>
        ${suggestions.length ? `<div class="stack" data-character-merge-suggestions>${suggestions.slice(0, 6).map((item, index) => `<button type="button" class="small" data-character-merge-suggestion="${index}">${escapeHtml(item.keepName)} ≈ ${escapeHtml(item.mergeName)} · ${escapeHtml(item.reason)}</button>`).join('')}</div>` : ''}
        <details class="subdetails" data-character-merge-manual>
          <summary>检查 / 手动指定两个角色</summary>
          <div class="stack disclosure-body">
            <div class="grid2">
              <label class="muted">保留角色<select data-character-merge-keep>${project.characters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select></label>
              <label class="muted">把这个角色并进去<select data-character-merge-source>${project.characters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select></label>
            </div>
            <div class="merge-impact" data-character-merge-impact></div>
            <button type="button" data-character-merge-apply class="small danger">确认合并</button>
            <div class="muted">合并后，旧名字会保留为“导入别名”；目标角色已有素材和设置优先。此操作可用 Undo 撤销。</div>
          </div>
        </details>
      </div>`;

    const keepSel = identity.querySelector('[data-character-merge-keep]');
    const sourceSel = identity.querySelector('[data-character-merge-source]');
    const impact = identity.querySelector('[data-character-merge-impact]');
    const apply = identity.querySelector('[data-character-merge-apply]');
    const manual = identity.querySelector('[data-character-merge-manual]');
    if (sourceSel && project.characters[1]) sourceSel.value = project.characters[1].id;

    const refreshImpact = () => {
      const keepId = keepSel?.value || '';
      const mergeId = sourceSel?.value || '';
      if (!impact || !apply) return null;
      if (!keepId || !mergeId || keepId === mergeId) {
        impact.className = 'merge-impact warning';
        impact.innerHTML = '<strong>请选择两个不同角色。</strong><div class="muted">什么都不会修改。</div>';
        apply.disabled = true;
        return null;
      }
      const keep = project.characters.find(c => c.id === keepId);
      const source = project.characters.find(c => c.id === mergeId);
      if (!keep || !source) {
        apply.disabled = true;
        return null;
      }
      const preview = planCharacterMerge(project, keepId, mergeId);
      const conflictLabels = [...new Set(preview.conflicts.map(humanMergeConflict))];
      const fillLabels = [...new Set(preview.filled.map(humanMergeFill))];
      const shownFills = fillLabels.slice(0, 5).map(escapeHtml).join('、');
      const moreFills = fillLabels.length > 5 ? ` 等 ${fillLabels.length} 项` : '';
      const shownConflicts = conflictLabels.slice(0, 5).map(escapeHtml).join('、');
      const moreConflicts = conflictLabels.length > 5 ? ` 等 ${conflictLabels.length} 项` : '';
      const conflictGroups = preview.conflictGroups.map(group => escapeHtml(group.label)).join('、');
      impact.className = `merge-impact ${preview.conflicts.length ? 'warning' : 'safe'}`;
      impact.innerHTML = `<strong>${escapeHtml(source.name)} → ${escapeHtml(keep.name)}</strong><div class="merge-impact-grid"><div><b>${preview.linesReassigned}</b><span>句台词改归目标角色</span></div><div><b>${preview.stageRefsReassigned}</b><span>处舞台引用重定向</span></div><div><b>${fillLabels.length}</b><span>类缺失设置会补入</span></div><div><b>${preview.conflictGroups.length}</b><span>类冲突保留目标版本</span></div></div>${preview.assetMetadataReassigned ? `<div class="compact-note">另有 ${preview.assetMetadataReassigned} 个已生成语音素材的角色身份会一起改到目标角色。</div>` : ''}${fillLabels.length ? `<div class="compact-note"><strong>会补入：</strong>${shownFills}${moreFills}</div>` : '<div class="compact-note">没有需要从源角色补入的素材或设置。</div>'}${preview.conflicts.length ? `<div class="compact-note"><strong>不会覆盖：</strong>${shownConflicts}${moreConflicts}。冲突集中在 ${conflictGroups}；这些项目继续保留“${escapeHtml(keep.name)}”当前版本。</div>` : '<div class="compact-note">没有发现互相打架的设置。</div>'}<div class="muted">“${escapeHtml(source.name)}”会从角色列表移除，但这个名字会保存为导入别名；以后再导入同名台词会继续认到“${escapeHtml(keep.name)}”。</div>`;
      apply.disabled = false;
      apply.textContent = `合并“${source.name}”到“${keep.name}”`;
      return { keep, source, preview };
    };

    keepSel?.addEventListener('change', refreshImpact);
    sourceSel?.addEventListener('change', refreshImpact);
    this.openMerge = sourceId => {
      sourceSel.value = sourceId;
      if (keepSel.value === sourceId) keepSel.value = project.characters.find(item => item.id !== sourceId)?.id || '';
      identity.open = true; manual.open = true;
      refreshImpact();
      identity.scrollIntoView?.({ block: 'nearest' });
      keepSel.focus();
    };
    for (const button of identity.querySelectorAll('[data-character-merge-suggestion]')) {
      button.addEventListener('click', () => {
        const item = suggestions[Number(button.dataset.characterMergeSuggestion)];
        if (!item) return;
        keepSel.value = item.keepId;
        sourceSel.value = item.mergeId;
        if (manual) manual.open = true;
        refreshImpact();
        impact?.scrollIntoView?.({ block: 'nearest' });
      });
    }

    apply?.addEventListener('click', () => {
      const state = refreshImpact();
      if (!state) {
        setStatus?.('角色合并：请选择两个不同角色。');
        return;
      }
      const result = mergeCharacters(project, state.keep.id, state.source.id);
      onMerged?.({ keep: state.keep, source: state.source, result });
    });

    refreshImpact();
    host.append(identity);
    return identity;
  }
}
