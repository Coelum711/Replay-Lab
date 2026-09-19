# Replay Lab 0.22 人因 / UX 启发式审计

> 这是一轮基于真实 0.21 Studio 与 Voice Workbench 界面、代码和完整任务流进行的**启发式审计**，随后把结论实际实现进 0.22。它不是可用性实验，也不能替代观察真实用户操作。

审计时采用的主任务模型不是“这个软件有哪些功能”，而是一个人真正制作 Replay 时会做什么：

```text
把 Log 放进工程
→ 检查 / 整理剧本
→ 绑定角色和素材
→ 只给需要的场景添加演出
→ 预览
→ 修复诊断问题
→ 导出
```

0.22 的核心规则因此是：**先显示当前任务需要的东西；低频、危险、兼容性或实现层细节，等用户主动需要时再展开。** 这主要对应 progressive disclosure、recognition over recall、error prevention、match between system and real world，以及 aesthetic/minimalist design。

## 结果概览

按“页面刚打开时、关闭折叠区和高级模式后，默认实际可见的交互控件”做静态统计：

| 页面 | 0.21 | 0.22 | 变化 |
| --- | ---: | ---: | ---: |
| Replay Studio | 74 | 34 | -54% |
| Voice Workbench | 16 | 3 | -81% |

这不是说功能减少了 54% / 81%。功能仍然存在，只是不再同时争夺注意力。这个指标只用于衡量**默认视觉选择密度**，不是用户研究结果，也不能直接推出完成任务速度提升多少。

---

## P0：一句普通台词看起来像要配置整个软件

### 0.21 的问题

选中一行普通对话后，用户会同时看到或非常接近看到：

- 角色、类型、正文、表情、SFX；
- Bubble / ChatWindow；
- 时长、口型、文字出现方式；
- BG / CG / BGM；
- 镜头、转场、easing；
- 在场角色、左右站位、进退场；
- RplGen motion method；
- Chapter / Scene 拆分、合并、复制、移动；
- Dice / HitPoint；
- 演出复制粘贴；
- 素材导入 / 重定位。

字段本身可能都是“可选的”，但人不会先读 schema 再决定忽略什么。视觉上同时存在就会形成选择压力，用户很容易产生：

> “我是不是每项都应该设置？”

这会把“改一句台词”变成“理解整个 Replay 引擎”。

### 0.22 的处理

普通台词默认只保留：

```text
谁说
类型
说什么
表情
音效
普通对话框样式
```

其余分成带摘要的折叠区：

- 显示与时长；
- 场景演出；
- 舞台 / 在场角色；
- Chapter / Scene 结构；
- 演出设置复用。

折叠标题不会只写“高级设置”，而是直接给状态摘要，例如：

```text
显示与时长    自动时长 · 逐字
场景演出      背景 Warehouse · 聚焦说话人
舞台          自动 · 2 人
结构          Session 2 / Basement
```

这样用户靠**识别**知道里面现在是什么，而不是靠记忆“我刚才在哪里调过背景”。

Dice、HP、Bubble 的编辑器只在对应行类型出现。RplGen method、精细曲线、MediaDef 原始能力再放进全局“高级工具”。

---

## P0：第一次打开软件时，不应该先看到一个假的“我的工程”

### 0.21 的问题

以前没有恢复快照时，会自动解析示例 Log。它让页面显得“不空”，但会模糊两个概念：

```text
演示数据
≠
用户自己的项目
```

这对新用户尤其危险，因为下一次导入看起来只是一次普通编辑，实际上是在替换当前工程。

### 0.22 的处理

首次启动是真正空工程，中间只显示最短路径：

```text
粘贴 Log
导入 Log 文件
导入制作文件夹
手动创建第一句
```

示例还在，但只有用户主动点“填入示例”才出现。

Import 区只在空工程时自动展开；项目开始工作后不会一直占据主界面。

---

## P0：高代价错误必须在发生前阻止，而不是发生后解释

### 0.21 的问题

以下操作都可能直接替换当前工程：

- 解析另一份 Log；
- 导入另一组 Log；
- 打开另一个工程文件夹；
- 新建工程。

按钮文字对开发者很明确，但对注意力分散、操作很快的人并不够安全。

### 0.22 的处理

确认提示只出现在**真的存在可丢失内容**时：

```text
空工程 + 导入
→ 直接执行

已有内容 + 会替换工程的操作
→ 明确提示“将替换当前工程”
```

这样既避免“每点一步都确认”的确认疲劳，也保护高成本错误。

新建工程同时明确说明自动恢复快照也会转向新项目。

---

## P1：素材库和单句 Inspector 是两种心理对象，不应混在一起

### 0.21 的问题

Inspector 底部长期放着素材导入 / 重定位。它混合了两个问题：

```text
素材库：我拥有哪些文件？
Inspector：这一句要用哪个已经存在的东西？
```

### 0.22 的处理

“导入素材 / 批量重定位”只在“素材”视图出现。

Inspector 只负责从已有素材中选择引用。

这减少了对象层级混乱，也防止用户误以为“给一句话加背景”必须从这里重新导入一次背景文件。

---

## P1：永久复选框让剧本看起来像一个批量管理后台

### 0.21 的问题

每一行都永久显示 checkbox。

多选时很高效，但绝大多数时间用户只是阅读、跳转、修改一行。永久复选框会持续暗示“你正在批量管理项目”。

### 0.22 的处理

默认剧本行变成：

```text
序号 | 角色 | 台词
```

只有展开“批量选择 / 编辑”以后才进入 batch mode，并显示 checkbox。

如果已经有选中的行，批量状态不会因为折叠面板而突然消失，避免 mode error。

---

## P1：内部实现词汇不应成为用户必须学习的词汇

0.21 暴露过多开发语言，例如：

```text
已编译
MediaDef
IDLE / OPEN / BLINK
left / center / right
quadraticR
Performance JSON
```

0.22 保留内部 enum，UI 改成人类语言：

```text
已编译            → 预览就绪
MediaDef           → 样式（高级）
IDLE               → 基础立绘
OPEN               → 张嘴
BLINK              → 眨眼
left/center/right  → 左 / 中 / 右
quadratic          → 逐渐加速
quadraticR         → 逐渐减速
sigmoid            → 平滑加减速
```

Performance JSON 仍然存在，但进入高级调试折叠区。

这种做法不是把专业能力“幼儿化”，而是把**系统实现名**和**用户任务名**分开。

---

## P1：右栏不应该像项目组的开发 Dashboard

0.21 的导出旁边长期显示编译 JSON 和“本体下一步”等开发信息。

0.22：

- WebM 是主导出动作；
- YMM / CSV / Tyrano / JSON 放在“其他导出格式”；
- diagnostics 保持可见，因为它属于“完成作品”；
- 编译状态原始 JSON 只在高级调试区；
- roadmap 从产品 UI 移除。

用户来做 Replay，不需要同时参与 Replay Lab 的开发管理。

---

## P1：Voice Workbench 应该像“选演员”，不是 TTS 调试控制台

### 0.21 的问题

Voice Workbench 虽然已经和 Studio 分开，但打开后仍然同时出现：

- 示例 Log；
- 工程目录；
- 每个角色所有语言字段；
- Accent / region；
- Provider；
- Voice；
- 翻译 endpoint；
- 巨大的 Performance JSON。

### 0.22 的处理

页面变成单列，默认核心任务只有：

```text
加载 Replay Lab Free
→ 给角色选语言和声音
→ 试听
```

按需展开：

- 测试 / 导入 Log；
- 工程目录；
- 每角色口音 / 地区；
- 翻译链测试；
- Performance JSON。

启动时不再自动创建示例项目。

Accent 仍然存在，但不会因为“这个系统支持 Accent”就要求每个只想选声音的人先做语言学配置。

---

## 工作记忆 / Recognition 优化

0.22 具体减少“记住刚才设置了什么”的地方包括：

- 当前 Chapter / Scene 作为上下文路径持续显示；
- 折叠区标题带当前设置摘要；
- 被截断的角色名 / 台词有完整 tooltip；
- easing 显示人类名称但保留稳定 enum；
- 类型相关选项只在当前类型适用时出现；
- 高级模式状态和折叠状态会被保存，下次打开不要求专家重新整理界面。

目标不是“越少越好”，而是让**同一时刻互相竞争的选择数量**与当前任务复杂度匹配。

---

# 0.22 之后仍然不舒服的地方

这些问题本轮没有用 CSS 假装已经解决。

## 1. 真正的长 Log 虚拟列表还没接上

目前 `content-visibility + DocumentFragment` 可以减轻浏览器工作，但 20k 行仍然会创建过多 DOM。

数据层 benchmark 已经说明瓶颈不在 outline/search core；下一步应该直接接 `@tanstack/virtual-core`，而不是继续自制虚拟滚动。

优先级：**P0**。

## 2. 三栏布局仍然太刚性

桌面宽屏问题不大，但 1366×768、1440×900 的笔记本会明显挤压舞台。

下一步适合：

- 左右栏可拖动宽度；
- 一键“专注预览”；
- 一键“专注剧本”；
- 窄屏时 Inspector 变抽屉或下方 panel。

这需要真实分辨率上的浏览器操作测试，不能只凭 CSS 猜。

优先级：**P1**。

## 3. 15–30 个角色时，角色页仍然会变成表单墙

目前单张角色卡已经简化，但长团会遇到：

```text
Arthur
Matthew
Francis
...
30 张卡一直向下
```

更合理的长期模型应当是 master-detail：

```text
角色列表
    ↓ 选择一个
单角色编辑器
```

并支持搜索 / 标签 / NPC 折叠。

优先级：**P1**。

## 4. MediaDef 高级几何仍然太“填数字”

这部分已经藏进高级工具，所以不会骚扰普通用户，但 ChatWindow / DynamicBubble 的位置、边界和九宫格切线最终应该允许在 Stage 上直接拖动。

数字框仍应保留作为精确输入，而不是主要输入方法。

优先级：**P2**。

## 5. 视频导出的心理模型仍然不够安全

现在 WebM 主按钮很清楚，但长达一两个小时的 Replay 如果仍依赖实时 MediaRecorder，用户会担心：

- 中途失败怎么办；
- 浏览器切后台会怎样；
- 导出多久；
- 能否从中断位置继续；
- 最终文件是不是完整。

这不是改文案能解决的。需要更可靠的离线/分段渲染、进度、失败恢复和最终校验。

优先级：**P0（发布前）**。

## 6. 缺少真实用户行为验证

当前能够验证的是：

- TypeScript build；
- core/unit tests；
- UI 结构回归测试；
- HTML ID / JS 引用完整性；
- 静态默认选择密度。

当前执行容器里的 Chromium 仍在 headless / DBus runtime 阶段卡住，所以本轮没有拿“像素级浏览器 E2E”冒充已经完成。

后续最有价值的真实测试不是问用户“好不好看”，而是给三类人各一个任务：

1. 第一次见 Replay Lab：从 Log 做出 30 秒 Replay；
2. 熟练作者：在 2 小时 Log 中定位一个 Scene、批量改演出并导出；
3. 高级用户：导入 RGL + MediaDef，修失效素材和样式。

记录：第一次犹豫的位置、错误点击、回头找控件的次数、需要解释术语的次数、任务完成时间。

---

## 启发式依据

本轮主要依据 Nielsen Norman Group 的 10 usability heuristics 及其 progressive disclosure / error prevention / recognition-vs-recall 指南，尤其是：

- visibility of system status；
- match between system and the real world；
- user control and freedom；
- error prevention；
- recognition rather than recall；
- flexibility and efficiency of use；
- aesthetic and minimalist design；
- progressive disclosure。

参考：

- https://www.nngroup.com/articles/ten-usability-heuristics/
- https://www.nngroup.com/videos/progressive-disclosure/
- https://www.nngroup.com/videos/usability-heuristic-error-prevention/
- https://www.nngroup.com/videos/recognition-vs-recall/


# 0.23 修复进展

0.22 末尾列出的三项主要编辑交互债，在 0.23 已进入实现：

- **长 Log：** 超过阈值后使用 TanStack Virtual Core，只实例化视口附近的 ScriptRenderRow；离线/CDN失败时保留 full-DOM fallback。
- **三栏刚性：** 左右栏可拖拽、键盘调整并持久化宽度；新增“编辑专注”和“舞台专注”，Esc 回三栏。窄屏仍由 responsive layout 接管。
- **角色表单墙：** 改为角色 picker + 单角色 detail，并加入名字搜索和角色类型筛选。

视频导出也从实时 MediaRecorder 主路径升级为 WebCodecs/Mediabunny 离线 MP4，并加入体积预估、质量预设、流式落盘和取消。旧 WebM 作为兼容 fallback。详见 `docs/VIDEO_EXPORT.md`。

仍未完成的最高风险已经从“有没有离线导出架构”变成了**实机可靠性**：长视频在真实 Chrome/Edge 的编码器差异、A/V sync、后台运行、磁盘耗尽、取消后残留文件，以及是否需要分段 checkpoint/resume。它们不能靠 Node 单测替代。

# 0.24 修复进展：内容页签与“先做内容、后补美术”

0.23 的长 Log virtualizer 暴露出一个隐藏视口交互风险：剧本页切走后，virtualizer 仍持续观察被隐藏的 viewport，可能把尺寸更新为零并在重新进入时留下错误状态。0.24 将“剧本 / 角色 / 素材 / 样式”统一到单一 `setContentView()` 状态机；离开剧本页时销毁 virtualizer，返回时按当前可见尺寸重新建立。显隐不再混用 `style.display`、`hidden` 和不同 view-specific 分支。

角色流程也改为“内容先行”。导入 Log 自动生成的角色不再被诊断为需要立刻补立绘的警告，而是正常使用可眨眼、可张嘴的具名占位角色。用户可以先完成剧本、节奏、站位和配音，再逐步补角色底图、眼睛、嘴巴与表情层。这降低了前置依赖，也减少了“因为素材没齐所以现在什么都不能预览”的阻塞感。
