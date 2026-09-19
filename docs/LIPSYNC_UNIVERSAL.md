# Replay Lab 0.27 · 通用音素 → Viseme fallback

目的：当某个语言没有专门的口型表，但 TTS / forced aligner 能返回 phoneme / IPA timing 时，不直接退化成简单 OPEN/CLOSED，而是优先复用 Replay Lab 0.26 已有的英语扩展视觉口型。

这不是“按英语发音”。映射只看**嘴唇、牙齿、舌尖在画面上需要做什么**。

## Resolution policy

```text
语言专用 resolver
        ↓ 没有
通用 IPA / phoneme 可见发音分类
        ↓ 无可用类别
A / I / U / E / O
        ↓ 仍无法判断
OPEN / CLOSED
```

当前专用 resolver：英语保留旧 LipSync Studio 的 ARPABET 规则。其他显式语言标签默认进入 universal fallback。

如果没有语言标签，为了不破坏旧 LAB 工程，普通 ASCII phoneme 仍使用旧 KuchiPaku 路径；但 `θ / ə / ʊ / ɔ` 等明显 IPA token 可以安全进入 universal fallback。

## 主要视觉类别

| 发音类 | 示例 phoneme | Replay viseme | 视觉理由 |
|---|---|---|---|
| 双唇闭合 | p b m | M | 双唇接触 |
| 双唇擦音/颤音 | ɸ β ʙ | M | 最接近现有的闭合/近闭合唇形 |
| 唇齿 | f v ɱ ʋ | F | 下唇接近/接触上齿 |
| 齿间/齿音 | θ ð | TH | 舌尖可见 |
| 强圆唇近音 | w ʍ ɥ | W | 明显前突圆唇 |
| 中央/弱化元音 | ə ɚ ɝ ɜ ɐ ɘ ɨ | SCHWA | 放松、中性开口 |
| 开前元音 | æ ɶ | AE | 大开口并较横向 |
| 近闭后元音 | ʊ | UU | 小而松的圆口 |
| 开中后圆唇元音 | ɔ ɒ | OO | 较大的圆口 |
| 基础元音 | a/ɑ, i/ɪ, e/ɛ, u/ɯ, o | A/I/E/U/O | 复用五元音 |

圆唇前元音没有独立美术槽时按视觉优先近似：`y→U`, `ʏ→UU`, `ø→O`, `œ→OO`。

## IPA normalization

为了视觉 fallback，stress / length / 常见 combining diacritics 不改变嘴型类别，例如：

```text
ˈæː → AE
ã   → A
```

带 `ʷ` 的 labialized phoneme 优先映射 W，因为唇化在画面上非常明显：

```text
kʷ → W
```

若 aligner 把 diphthong 合成一个 token，0.27 会选择其中第一个可用元音口型；需要更精细的语言以后可以注册专用 resolver 做两段 timing。

## 兼容策略

- `phonemeToViseme('m')`（无语言）仍为旧行为 `CLOSED`。
- `phonemeToViseme('m', ..., 'cy-GB')` 会得到 `M`。
- `phonemeToViseme('θ')` 即使无语言，也可识别为 `TH`，因为它是明确 IPA。
- 英语 ARPABET 仍优先走 0.26 旧站映射，不被 universal 表覆盖。

## 美术成本

角色完全不需要为每个小众语言重新画嘴型。现有可选槽位：

```text
mouthSchwa
mouthAe
mouthUu
mouthOo
mouthW
mouthF
mouthTh
mouthM
```

会被所有语言复用。没有这些专图时仍按既有 fallback 回到 A/I/U/E/O 或默认闭嘴；零素材占位角色也能直接显示这些视觉类别。
