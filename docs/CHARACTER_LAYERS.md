# Replay Lab 0.25 · 分层角色、半身构图与轻量 Puppet

Replay Lab 不再要求“先准备好整张立绘，才能开始制作 Replay”。角色视觉现在有两条兼容路径：

1. **推荐：分层角色**：角色底图、眼睛、嘴巴和表情覆盖层分别保存；
2. **兼容：整帧立绘**：继续支持旧项目的 IDLE / OPEN / BLINK / A-I-U-E-O 整张图片切换。

## 零素材占位角色

导入 Log 或新建角色时，即使一个角色素材都没有，也会直接参加舞台演出。Renderer 会生成一个使用角色颜色的竖向长方形占位角色，并显示角色名。

占位脸部是故意极简的程序图形：

- 睁眼：两个黑色方块；
- 眨眼：两条扁黑块；
- 闭嘴：一条短黑块；
- 张嘴：一个黑色矩形；
- A / I / U / E / O 会用不同宽高的嘴块近似显示。

它使用和正式角色完全相同的 `pseudoViseme` / mouth cue 与 blink timing，因此以后换成正式素材时不需要重做台词或演出。

## 推荐分层结构

```text
Character
├─ base          角色底图
├─ overlay       默认额外表情层（可选）
├─ eyesOpen      睁眼
├─ eyesClosed    闭眼
├─ mouthClosed   闭嘴
├─ mouthOpen     通用张嘴
├─ mouthA/I/U/E/O
├─ mouthSchwa / mouthAe / mouthUu / mouthOo      英语可选
├─ mouthW / mouthF / mouthTh / mouthM            英语可选
└─ layerExpressions
   ├─ angry
   │  ├─ eyesOpen
   │  └─ overlay
   └─ crying
      ├─ overlay
      └─ mouthClosed
```

每个表情只保存“发生变化的层”。例如 `angry` 只换眼睛，那么底图、嘴巴和其他默认层继续继承角色默认值。

## 素材制作约定

最省心的做法是让底图、眼睛、嘴巴、overlay 使用**完全相同的透明画布尺寸和原点**。Renderer 会以底图的最终舞台矩形为准，把所有组件直接覆盖到同一矩形中，因此不需要为眼睛和嘴巴再维护 XY 坐标。

这对常见 PSD / Clip Studio / Live2D 前处理式素材很友好：导出各图层透明 PNG/WebP 即可。

## 渲染优先级

```text
分层角色有 base
→ base + eyes + mouth + overlay

没有分层 base，但存在旧式整帧素材
→ IDLE / OPEN / BLINK / A-I-U-E-O

两者都没有
→ 程序占位角色
```

因此旧工程不会被破坏，新工程则可以从“一个素材都没有”逐步升级到完整分层角色。


## 0.25：从“切图层”升级到轻量 Puppet

0.25 不再假设角色一定是全身立绘，也不把图片底边等同于脚底。`character.puppet.layout` 统一描述头像、胸像、半身和全身：

- `framing`: `auto / portrait / bust / half / full`
- `anchorX / anchorY`: 归一化舞台锚点
- `scale`: 角色整体舞台缩放
- `offsetX / offsetY`: 构图微调

因此半身立绘、胸像、坐姿或其他裁切图都可以用同一套站位逻辑。旧整帧 IDLE / OPEN / BLINK 也会使用这套 layout。

角色部件层扩展为 `base → eyes → pupils → eyelids → brows → mouth → overlay`。没有拆分素材的角色仍可继续只提供 `eyesOpen / eyesClosed / mouthOpen / mouthClosed`；新增部件都是渐进增强。

表情除了换图，还可以保存参数值和局部 3×3 lattice 形变。参数模型采用 Inochi2D 风格的 `Parameter → Binding → Part`：例如 `eyeOpen` 可以同时压缩眼睛、隐藏睁眼眼皮并显示闭眼眼皮，`browAngle` 可以旋转眉毛，`mouthOpen` / `mouthWide` 可由口型自动驱动。表情预设再覆盖这些参数，特殊颜艺仍然可以换新图。详见 `docs/PUPPET_RIG.md`。


## 0.26：英语专用嘴型仍是渐进增强

英语角色无需一次画完整音素库。默认五元音和闭嘴/张嘴继续是最小素材集；Studio 的“英语额外音素口型”折叠区只提供 8 个可选槽：`ə / æ / ʊ / ɔ / w / f-v / th-dh / m-b-p`。

这套槽位来自用户旧 LipSync Studio 的实际工作流。若某个槽没有素材，Renderer 使用同一工具原先的 nearest-base fallback，因此可以在项目已经完成 timing 之后再逐步补图，不需要重新生成口型时间轴。


## 0.27：英语扩展嘴型成为跨语言可复用槽位

`mouthF / mouthTh / mouthM / mouthW / mouthAe / mouthUu / mouthOo / mouthSchwa` 不再只服务英语。只要其他语言的音素能归入相同的可见发音类别，Renderer 就直接复用这些槽；没有专图时仍按既有 fallback 回到五元音或闭嘴。
