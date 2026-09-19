# Replay Lab 0.26 · 英语音素 / Viseme

0.26 的英语口型规则直接移植自用户此前提供的 `lipsync-tool (23)(1).html`。目标是延续已经使用过的视觉口型语义，而不是重新设计一张语言学分类表。

## 口型集合

基础：`A I U E O`。额外：`SCHWA(ə) AE(æ) UU(ʊ) OO(ɔ) W F TH M`。其中 `F` 同时覆盖 F/V，`TH` 覆盖 TH/DH，`M` 覆盖 M/B/P。

## ARPABET

| ARPABET | Replay viseme |
|---|---|
| AA, AW, AY | A |
| AE | AE |
| AH, ER | SCHWA |
| AO | OO |
| EH, EY | E |
| IH, IY | I |
| OW, OY | O |
| UH | UU |
| UW | U |
| B, P, M | M |
| F, V | F |
| TH, DH | TH |
| W | W |
| 其他英语辅音 | CLOSED |

ARPABET 的 stress suffix `0/1/2` 会被忽略。

## 可选美术与 fallback

角色可提供 `mouthSchwa / mouthAe / mouthUu / mouthOo / mouthW / mouthF / mouthTh / mouthM`。没有专图时保留旧工具 fallback：`AE→A`、`UU/W→U`、`OO→O`、其余额外口型→默认闭嘴。

## Timing

`phonemesToMouthCues()` 接受可选 `language`。`en-*` 使用上述英语映射；通用 LAB/KuchiPaku 行为保持兼容。TTS provider 若返回 `TimedPhoneme[]`，`prepareLineSpeech()` 会自动生成 `line.mouthCues`，Renderer 仍统一应用项目的 `mouthLeadMs`。


## 0.27：跨语言 fallback

英语专用 ARPABET 表本身保持 0.26 语义不变。0.27 在它下面新增 `universalPhonemeToViseme()`：其他语言如果没有专门 resolver，但 TTS / aligner 能提供 IPA 或近似音素，就按**可见发音动作**复用这套扩展口型，而不是把文字按英语发音。详见 `LIPSYNC_UNIVERSAL.md`。
