import { planFacePackageBindings } from '../dist/index.js';

export class FacePackageController {
  constructor(options = {}) {
    this.options = options;
  }

  mount({ button, input, preview }) {
    if (!button || !input || !preview) return;
    button.onclick = () => input.click();
    input.onchange = () => {
      const files = [...(input.files ?? [])].filter(file => file.type.startsWith('image/') || /\.(png|webp|jpe?g|gif)$/i.test(file.name));
      if (!files.length) return;
      const { project, pathOf } = this.options;
      const plan = planFacePackageBindings(files.map(pathOf), project.characters.map(({ id, name, aliases }) => ({ id, name, aliases })));
      this.render(preview, files, plan);
      preview.querySelector('[data-face-package-cancel]').onclick = () => {
        input.value = '';
        preview.hidden = true;
        preview.innerHTML = '';
      };
      preview.querySelector('[data-face-package-apply]').onclick = () => this.apply(preview, files);
    };
  }

  targetOptions(selected = '', slot = '', proposedName = '') {
    const { project, escapeHtml } = this.options;
    const shared = slot === 'base' ? '' : `<option value="shared" ${selected === 'shared' ? 'selected' : ''}>共享模板</option>`;
    const characters = project.characters.map(character => `<option value="character:${escapeHtml(character.id)}" ${selected === `character:${character.id}` ? 'selected' : ''}>角色：${escapeHtml(character.name)}</option>`).join('');
    const proposed = proposedName ? `<option value="new:${escapeHtml(proposedName)}" ${selected === `new:${proposedName}` ? 'selected' : ''}>新角色：${escapeHtml(proposedName)}</option>` : '';
    return `<option value="">未确定</option>${shared}${characters}${proposed}`;
  }

  rootLabel(files) {
    const { pathOf } = this.options;
    const paths = files.map(pathOf), first = paths[0] || '';
    const root = first.includes('/') ? first.split('/')[0] : '';
    return root && !['common', 'shared', 'template'].includes(root.toLowerCase()) ? root : '共享脸部模板';
  }

  existingBinding(targetValue, slot, sharedTemplateId = '__new__') {
    const { project } = this.options;
    if (!slot) return null;
    if (targetValue === 'shared') {
      if (sharedTemplateId === '__new__') return null;
      return project.faceTemplates.find(template => template.id === sharedTemplateId)?.layers?.[slot] || null;
    }
    if (targetValue.startsWith('character:')) return project.characters.find(character => character.id === targetValue.slice('character:'.length))?.layers?.[slot] || null;
    return null;
  }

  render(host, files, plan) {
    const { project, escapeHtml, slotOptions, slotLabel } = this.options;
    host.hidden = false;
    const defaultTemplateName = `${this.rootLabel(files)} · 通用脸`;
    const attentionCount = plan.items.filter(item => !item.slot || item.targetKind === 'unresolved' || item.conflict || item.confidence < .9).length;
    const readyCount = plan.items.length - attentionCount;
    host.innerHTML = `<div class="stack"><div class="row"><strong>素材包检查</strong><span class="status ok">${readyCount} 个已自动分好</span>${attentionCount ? `<span class="status warn">只看这 ${attentionCount} 个</span>` : ''}</div><div class="low-attention-callout"><strong>${attentionCount ? '先处理黄色项，其他不用看。' : '全部分好了。'}</strong><div>${attentionCount ? '每个黄色文件只回答两个问题：属于谁？它是什么？' : '直接确认导入即可。纯文字项目不需要做这一步。'}</div></div><details><summary>共享模板怎么处理（通常不用改）</summary><div class="stack disclosure-body"><div class="grid2"><label class="muted">共享素材放到<select data-face-package-template><option value="__new__">新建共享模板（推荐）</option>${project.faceTemplates.map(template => `<option value="${escapeHtml(template.id)}">现有：${escapeHtml(template.name)}</option>`).join('')}</select></label><label class="muted">新模板叫<input data-face-package-template-name value="${escapeHtml(defaultTemplateName)}"></label></div><label class="checkrow"><input type="checkbox" data-face-package-assign-template checked> 自动把这张通用脸套给本次角色</label><div class="compact-note"><code>common/</code> = 大家共用；<code>角色名/</code> = 这个角色自己的素材；<code>base.png</code> = 角色立绘底图。</div></div></details>${attentionCount ? '<div><strong>需要你看</strong><div data-face-package-attention class="stack"></div></div>' : ''}${readyCount ? `<details><summary>已经分好的 ${readyCount} 个（通常不用看）</summary><div data-face-package-ready class="stack disclosure-body"></div></details>` : ''}<div data-face-package-error class="compact-note"></div><div class="row"><button type="button" data-face-package-apply class="primary">确认并导入</button><button type="button" data-face-package-cancel class="small">先不导入</button></div></div>`;
    const attention = host.querySelector('[data-face-package-attention]'), ready = host.querySelector('[data-face-package-ready]'), templateSelect = host.querySelector('[data-face-package-template]'), templateName = host.querySelector('[data-face-package-template-name]');

    const refreshRowProtection = row => {
      const slotSelect = row.querySelector('[data-face-package-slot]'), slot = slotSelect?.value || '', targetSelect = row.querySelector('[data-face-package-target]'), use = row.querySelector('[data-face-package-use]'), note = row.querySelector('[data-face-package-note]');
      if (!use || !targetSelect) return;
      const proposedName = row.dataset.facePackageProposedName || '';
      const previousTarget = targetSelect.value;
      targetSelect.innerHTML = this.targetOptions(previousTarget, slot, proposedName);
      if ([...targetSelect.options].some(option => option.value === previousTarget)) targetSelect.value = previousTarget; else targetSelect.value = '';
      targetSelect.disabled = !slot;
      const target = targetSelect.value || '';
      use.disabled = !slot || !target;
      const existing = slot && target ? this.existingBinding(target, slot, templateSelect.value) : null;
      if (existing && use.checked) use.checked = false;
      row.classList.toggle('unknown', !slot || !target);
      row.classList.toggle('conflict', !!existing || row.dataset.facePackageConflict === '1');
      if (note) note.textContent = !slot ? '这张是什么？请选一个部位' : !target ? '这张属于谁？请选择共享模板或角色' : existing ? '这个位置已经有素材；勾选才会替换' : row.dataset.facePackageReason || '已分好';
    };

    for (const item of plan.items) {
      const needsAttention = !item.slot || item.targetKind === 'unresolved' || item.conflict || item.confidence < .9;
      const row = document.createElement('div');
      row.className = `face-package-row${needsAttention ? ' needs-attention' : ''}${item.conflict ? ' conflict' : ''}${!item.slot ? ' unknown' : ''}`;
      row.dataset.facePackagePath = item.path;
      row.dataset.facePackageConflict = item.conflict ? '1' : '0';
      row.dataset.facePackageReason = `${item.targetReason} · ${item.partReason}`;
      row.dataset.facePackageProposedName = item.proposedCharacterName || '';
      const target = item.targetKind === 'shared' ? 'shared' : item.targetKind === 'character' ? `character:${item.targetId}` : item.targetKind === 'new-character' ? `new:${item.proposedCharacterName || item.targetLabel}` : '';
      const highConfidence = item.confidence >= .9;
      const checked = !!item.slot && item.targetKind !== 'unresolved' && !item.conflict && highConfidence && !this.existingBinding(target, item.slot, '__new__');
      row.innerHTML = `<input type="checkbox" data-face-package-use ${checked ? 'checked' : ''} ${item.slot && target ? '' : 'disabled'}><span class="face-autobind-file">${escapeHtml(item.path)}</span><span class="face-autobind-arrow">→</span><select aria-label="这张图属于谁" data-face-package-target ${item.slot ? '' : 'disabled'}>${this.targetOptions(target, item.slot || '', item.proposedCharacterName || '')}</select><select aria-label="这张图是什么" data-face-package-slot>${slotOptions(item.slot || '', true)}</select><span data-face-package-note class="summary-meta">${escapeHtml(needsAttention ? '需要确认' : '已分好')}</span>`;
      const targetSelect = row.querySelector('[data-face-package-target]'), slotSelect = row.querySelector('[data-face-package-slot]'), use = row.querySelector('[data-face-package-use]');
      targetSelect.onchange = () => { const slot = slotSelect.value; if (targetSelect.value && slot && !this.existingBinding(targetSelect.value, slot, templateSelect.value) && !item.conflict) use.checked = true; refreshRowProtection(row); };
      slotSelect.onchange = () => { const slot = slotSelect.value; row.dataset.facePackageConflict = '0'; refreshRowProtection(row); const target = targetSelect.value; if (slot && target && !this.existingBinding(target, slot, templateSelect.value)) use.checked = true; };
      (needsAttention ? attention : ready)?.append(row);
      refreshRowProtection(row);
    }
    templateSelect.onchange = () => { templateName.disabled = templateSelect.value !== '__new__'; for (const row of host.querySelectorAll('.face-package-row')) refreshRowProtection(row); };
  }

  async apply(host, files) {
    const { slotLabel, onApply } = this.options;
    const rows = [...host.querySelectorAll('.face-package-row')], chosen = [];
    for (const row of rows) {
      const use = row.querySelector('[data-face-package-use]');
      if (!use?.checked) continue;
      const target = row.querySelector('[data-face-package-target]')?.value || '', slot = row.querySelector('[data-face-package-slot]')?.value || '', path = row.dataset.facePackagePath;
      if (target && slot && path) chosen.push({ target, slot, path });
    }
    const error = host.querySelector('[data-face-package-error]');
    if (!chosen.length) { error.textContent = '没有选中可应用的素材。'; return; }
    const seen = new Map(), duplicates = [];
    for (const item of chosen) { const key = `${item.target}:${item.slot}`; if (seen.has(key)) duplicates.push(key); else seen.set(key, item); }
    if (duplicates.length) {
      error.textContent = `同一目标的同一槽位仍选中了多张素材：${[...new Set(duplicates)].map(key => slotLabel(key.split(':').at(-1))).join('、')}。请每个槽位只留一张。`;
      return;
    }
    error.textContent = '';
    await onApply?.({
      chosen,
      files,
      templateId: host.querySelector('[data-face-package-template]')?.value || '__new__',
      templateName: host.querySelector('[data-face-package-template-name]')?.value.trim() || '共享脸部模板',
      assignTemplate: !!host.querySelector('[data-face-package-assign-template]')?.checked,
      error
    });
  }
}
