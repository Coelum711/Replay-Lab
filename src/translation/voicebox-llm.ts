import type { TranslationProvider, TranslationRequest, TranslationResult } from './types.js';
import { languageName } from './script-bridge.js';

export const VOICEBOX_LLM_TRANSLATION_ID = 'voicebox-llm';

export interface VoiceboxLlmOptions {
  baseUrl?: string;
  modelSize?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function cleanTranslation(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\s*\n\s*/g, ' ').trim();
  // Local models often echo a speaker label even when told not to.
  const label = text.match(/^[^：:。！？!?\s]{1,12}[：:]\s*(.+)$/);
  if (label) text = label[1]!.trim();
  return text;
}

/** Translates through the small local LLM bundled with Voicebox. Output is a draft for human review. */
export class VoiceboxLlmTranslationProvider implements TranslationProvider {
  readonly id = VOICEBOX_LLM_TRANSLATION_ID;
  readonly label = 'Voicebox 本地 LLM';
  private readonly baseUrl: string;
  private readonly modelSize: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: VoiceboxLlmOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://127.0.0.1:17493').replace(/\/+$/, '');
    this.modelSize = options.modelSize || '4B';
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    request.signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const system = [
      `你是配音翻译。把用户给的台词翻译成自然的${languageName(request.targetLanguage)}口语。`,
      '只输出这一句译文，不要写说话人名字，不要解释，不要混用其他语言。',
      request.speaker ? `说话人：${request.speaker}。` : '',
      request.styleNotes?.trim() ? `口吻与称呼要求：${request.styleNotes.trim()}` : ''
    ].filter(Boolean).join('\n');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/llm/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: request.signal ? AbortSignal.any([request.signal, deadline]) : deadline,
        body: JSON.stringify({ system, prompt: request.text, model_size: this.modelSize, max_tokens: 400, temperature: 0.3 })
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (deadline.aborted) throw new Error('本地 LLM 超时，模型可能还在加载，请重试。');
      throw new Error(`连不上 Voicebox（${this.baseUrl}），请确认它已打开。`);
    }
    if (!response.ok) {
      const hint = response.status === 500 ? ' Voicebox 的 LLM 可能处于故障状态，重启 Voicebox 通常能恢复。' : '';
      throw new Error(`本地 LLM 翻译失败（HTTP ${response.status}）。${hint}`);
    }
    const row = await response.json() as { text?: unknown };
    const text = cleanTranslation(String(row.text ?? ''));
    if (!text) throw new Error('本地 LLM 返回了空译文。');
    return { text, providerMetadata: { modelSize: this.modelSize } };
  }
}
