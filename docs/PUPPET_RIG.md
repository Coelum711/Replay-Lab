# Replay Lab 0.25 · 轻量 Puppet / 参数形变

Replay Lab 0.25 将 0.24 的“分层 PNG”推进为一个轻量 2D puppet。目标不是复刻完整 Live2D/VTuber 编辑器，而是让 TRPG Replay 常见的眼睛、眼皮、瞳孔、眉毛、嘴巴与表情覆盖层可以：

- 独立换图；
- 用参数做平移 / 缩放 / 旋转 / 透明度变化；
- 用 3×3 lattice 做局部网格拉伸；
- 把上述变化保存为表情预设；
- 继续由 Replay 的眨眼、口型和 expression 时间线自动驱动。

## 上游设计来源：Inochi2D

0.25 的 `Parameter → Binding → Part` 数据分层和 `LatticeDeformer` 概念直接参考/派生自 Inochi2D。Inochi2D 与 Inochi Creator 使用 BSD-2-Clause；Replay Lab 保留对应许可证于 `licenses/Inochi2D-BSD-2-Clause.txt`。

Replay Lab 只裁取了与 Replay 角色演出有关的最小子集：

```text
CharacterPuppetRig
├─ layout
├─ parts
├─ parameters
│  └─ bindings
└─ expressionPresets
```

没有移植完整物理、摄像头 tracking、VTuber 会话协议、复杂骨骼系统或完整 Creator IDE。

## 半身 / 胸像 / 全身统一模型

角色图片不再假设“底边就是脚底”。任何裁切都使用相同的归一化舞台锚点：

```text
layout.framing = auto | portrait | bust | half | full
layout.anchorX
layout.anchorY
layout.scale
layout.offsetX / offsetY
```

因此头像、胸像、半身、全身、坐姿甚至漂浮怪物都可以用同一舞台站位系统。`anchorX/Y` 是相对于角色源画布的比例坐标；半身图常见默认仍可使用 `(0.5, 1)`，需要让裁切口埋得更低/更高时再调 `anchorY`。

## 部件顺序

推荐透明层顺序：

```text
base
→ eyes
→ pupils
→ eyelids
→ brows
→ mouth
→ overlay
```

仍建议各部件导出为相同透明画布尺寸。Renderer 会估算每张部件图真正的非透明像素范围，以该区域中心作为默认变换 pivot；这避免“嘴巴虽然只占脸上一小块，但缩放却围绕整张 2000×3000 画布中心”的问题。

## 参数驱动

内置参数包括：

- `eyeOpen`：眨眼自动驱动；
- `mouthOpen` / `mouthWide`：viseme 自动驱动；
- `eyeSquash`：表情用眼睛纵向压缩；
- `browY` / `browAngle`；
- `mouthY` / `mouthTilt`。

表情可以只保存参数值：

```text
angry
├─ browY = -0.65
├─ browAngle = -0.8
└─ eyeSquash = 0.78
```

也可以同时叠加图片差分，例如换一张 angry brows，再继续用参数微调。

## 3×3 Lattice

高级表情编辑可以给任意部件建立 3×3 lattice。九个控制点的偏移会作为一个 Inochi 风格 deformation binding 保存：

```text
exprWarp:smile:mouth
parameter 0 → 1
  0: 全部控制点偏移为 0
  1: 用户拖出的控制点偏移
```

当 `smile` expression 激活时该 parameter 取 1，其他表情取默认 0。因此网格形变不会永久破坏素材，也不会要求为每个表情复制一张新 PNG。

## 兼容路径

0.25 保留三层兼容：

1. 有分层 base → Puppet renderer；
2. 没有分层 base 但有旧 IDLE/OPEN/BLINK → 整帧 renderer，同时仍使用新的 layout/anchor；
3. 什么图都没有 → 程序占位角色，继续眨眼/口型。



## 0.26 · 英语音素口型

英语层直接移植用户早期 LipSync Studio 的紧凑口型集合，而不是要求完整 40+ 音素美术：

```text
A / I / U / E / O
+ ə  (schwa)
+ æ
+ ʊ
+ ɔ
+ w
+ f / v
+ th / dh
+ m / b / p
```

ARPABET 映射保留旧工具语义：`AA→A`、`AE→æ`、`AH/ER→ə`、`AO→ɔ`、`UH→ʊ`、`B/P/M→m`、`F/V→f`、`TH/DH→th`、`W→w`；其他未专门处理的英语辅音回到默认闭嘴。重音数字 `0/1/2` 不改变口型。

专用英语嘴图完全可选。缺图时沿用旧站 fallback：

```text
æ  → A
ʊ  → U
ɔ  → O
w  → U
ə  → 默认闭嘴
f  → 默认闭嘴
th → 默认闭嘴
m  → 默认闭嘴
```

因此角色只画 A/I/U/E/O 仍可正常播放英语；补上专用 `mouthF` / `mouthTh` 等以后，已有 timing 会自动获得更精确的视觉结果。外部 TTS 若返回带时间戳的 phoneme 序列，`prepareLineSpeech()` 会按角色实际朗读语言生成 `mouthCues`。


## 0.27 · 通用音素驱动

Puppet 的嘴部仍只消费 Replay viseme，不关心语言本身。0.27 将非英语、低资源语言的 IPA/phoneme timing 先映射到现有扩展 viseme，再由 `mouthOpen / mouthWide` 与可选专用嘴图驱动。这样 `F / TH / M / W / AE / UU / OO / SCHWA` 等现有层可以跨语言复用。
