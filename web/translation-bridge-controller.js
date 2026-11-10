import {
  collectBridgeLines,
  splitBridgeBatches,
  buildPastePrompt,
  parsePasteReply,
  translationWarnings,
  styleNotesFor,
  VoiceboxLlmTranslationProvider
} from '../dist/index.js';

/** Review table for 表里 translation: drafts stay here until the author adopts them. */
export function createTranslationBridge({ root, getProject, fetchImpl, getEndpoint, onApplied }) {
  const $ = selector => root.querySelector(selector);
  let rows = [], controller = null;

  const state = (text, kind = '') => { $('#tbState').className = `speech-status ${kind}`; $('#tbState').textContent = text; };
  const target = () => $('#tbTarget').value.trim() || 'ja';
  const batches = () => splitBridgeBatches(rows);

  function warningText(row) { return row.draft.trim() ? translationWarnings(row.draft, target()).join('、') : ''; }
  function syncMode() {
    const local = $('#tbMode').value === 'local';
    $('#tbLocalControls').hidden = !local;
    $('#tbPasteControls').hidden = local;
  }
  function syncBatches() {
    const select = $('#tbBatch');
    select.replaceChildren(...batches().map((batch, index) => new Option(`第 ${index + 1} 批 · 编号 ${batch[0].number}–${batch.at(-1).number}`, String(index))));
  }
  function renderRow(row) {
    const tr = document.createElement('tr');
    const pick = document.createElement('input'); pick.type = 'checkbox'; pick.checked = row.adopt;
    pick.addEventListener('change', () => { row.adopt = pick.checked; });
    const number = document.createElement('td'); number.textContent = String(row.number);
    const source = document.createElement('td'); source.textContent = `${row.speaker}：${row.text}`;
    const editor = document.createElement('textarea'); editor.rows = 2; editor.value = row.draft; editor.setAttribute('aria-label', `第 ${row.number} 句译文`);
    const warn = document.createElement('small'); warn.className = 'muted'; warn.textContent = warningText(row);
    editor.addEventListener('input', () => { row.draft = editor.value; row.adopt = !!editor.value.trim(); pick.checked = row.adopt; warn.textContent = warningText(row); });
    const adopt = document.createElement('td'); adopt.append(pick);
    const cell = document.createElement('td'); cell.append(editor, warn);
    tr.append(adopt, number, source, cell);
    row.refresh = () => { editor.value = row.draft; pick.checked = row.adopt; warn.textContent = warningText(row); };
    return tr;
  }
  function load() {
    const project = getProject();
    if (!project) { state('请先导入台本', 'error'); return; }
    rows = collectBridgeLines(project).map(line => ({ ...line, draft: line.existing, adopt: false }));
    $('#tbRows').replaceChildren(...rows.map(renderRow));
    $('#tbTable').hidden = !rows.length;
    syncBatches();
    state(`已载入 ${rows.length} 句`, 'ok');
  }
  async function runLocal() {
    if (!rows.length) load();
    const todo = rows.filter(row => !row.draft.trim());
    if (!todo.length) { state('没有待翻译的句子', 'ok'); return; }
    controller = new AbortController();
    $('#tbRunLocal').disabled = true; $('#tbStop').disabled = false;
    const provider = new VoiceboxLlmTranslationProvider({ baseUrl: getEndpoint(), fetchImpl });
    let done = 0;
    try {
      for (const row of todo) {
        state(`翻译中 ${done} / ${todo.length}`, 'busy');
        const result = await provider.translate({ text: row.text, targetLanguage: target(), speaker: row.speaker, styleNotes: styleNotesFor($('#tbStyle').value, row.speaker, [...new Set(rows.map(item => item.speaker))]), signal: controller.signal });
        row.draft = result.text; row.adopt = true; row.refresh?.(); done += 1;
      }
      state(`完成 ${done} 句，请审阅后点“采用勾选的译文”`, 'ok');
    } catch (error) {
      state(controller.signal.aborted ? `已停止，完成 ${done} 句` : `已完成 ${done} 句后中断：${error.message || error}`, controller.signal.aborted ? '' : 'error');
    } finally {
      controller = null; $('#tbRunLocal').disabled = false; $('#tbStop').disabled = true;
    }
  }
  function currentPrompt() {
    if (!rows.length) load();
    const batch = batches()[Number($('#tbBatch').value || 0)] || [];
    return batch.length ? buildPastePrompt(batch, { targetLanguage: target(), styleNotes: $('#tbStyle').value }) : '';
  }
  async function copyPrompt() {
    const prompt = currentPrompt();
    if (!prompt) return;
    $('#tbPrompt').value = prompt;
    try { await navigator.clipboard.writeText(prompt); state('已复制，粘贴到任意 AI 网页，再把回复贴到下面', 'ok'); }
    catch { $('#tbPrompt').select(); state('浏览器不允许自动复制，请手动复制上方文本', 'error'); }
  }
  function importReply() {
    if (!rows.length) load();
    const batch = batches()[Number($('#tbBatch').value || 0)] || [];
    const { translations, missing, unexpected } = parsePasteReply($('#tbReply').value, batch.map(row => row.number));
    if (!translations.size) { state('没有识别到译文，请确认回复格式是 #编号｜译文', 'error'); return; }
    for (const row of batch) if (translations.has(row.number)) { row.draft = translations.get(row.number); row.adopt = true; row.refresh?.(); }
    $('#tbReply').value = '';
    const notes = [missing.length && `缺少 ${missing.length} 句（${missing.slice(0, 8).join('、')}）`, unexpected.length && `忽略 ${unexpected.length} 个多余编号`].filter(Boolean).join('，');
    state(`已导入 ${translations.size} 句${notes ? `，${notes}` : ''}`, missing.length ? 'error' : 'ok');
  }
  function apply() {
    const project = getProject();
    if (!project) return;
    const adopted = rows.filter(row => row.adopt && row.draft.trim());
    if (!adopted.length) { state('没有勾选的译文', 'error'); return; }
    const speakers = new Set();
    for (const row of adopted) {
      const line = project.lines.find(item => item.id === row.lineId);
      if (!line) continue;
      line.speech ??= {};
      line.speech.textOverride = row.draft.trim();
      row.existing = row.draft.trim(); row.adopt = false; row.refresh?.();
      if (line.speakerId) speakers.add(line.speakerId);
    }
    project.settings.speechLanguage = target();
    onApplied([...speakers]);
    state(`已采用 ${adopted.length} 句，朗读语言已设为 ${target()}`, 'ok');
  }

  $('#tbMode').addEventListener('change', syncMode);
  $('#tbLoad').addEventListener('click', load);
  $('#tbRunLocal').addEventListener('click', () => void runLocal());
  $('#tbStop').addEventListener('click', () => controller?.abort());
  $('#tbCopy').addEventListener('click', () => void copyPrompt());
  $('#tbImport').addEventListener('click', importReply);
  $('#tbApply').addEventListener('click', apply);
  syncMode();
  return { load };
}
