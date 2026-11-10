# Replay Lab

**把跑团 Log / 剧情台本，变成一集有配音、有演出的视觉小说式回放视频。**
完全在自己的电脑上运行：不需要 API 额度，素材和声音不离开本机。

*A local, text-first TRPG replay studio: turn a session log or script into a voiced, staged visual-novel style video, with a director's workbench for AI voice takes.*

![舞台演出效果一览：漫符、文字特效、说话跳动、圆形与百叶窗转场、回忆与夜晚滤镜、章节卡](docs/images/staging-effects.jpg)

## 它和别的工具有什么不同

舞台演出（对话框、转场、滤镜）这些，Ren'Py、Naninovel、RplGen 都做得很好，Replay Lab 只求够用。它真正想解决的是另外两件事：

- **AI 配音导演台。** 不是"点一下生成、不满意重来"，而是像录音棚收 take：每句保留历史版本、排队重 roll、生成完小红点提醒、整场连续审听、标记重录。每句可以单独写表演提示、选声音、选生成方式；还能把一句"念对了"的版本存成参考声音，让别的句子照着那个感觉念。
- **表里双语。** 屏幕显示一种语言、角色念另一种（例如字幕中文、配音日语），两条轨各自修改；中间可以用本地 LLM 翻译，也可以一键复制给任意 AI 网页再粘贴回来。

## 功能

| 方面 | 内容 |
|---|---|
| 台本 | 导入跑团 Log、RplGen RGL、纯文本台本；`角色[情绪\|强度\|补充]：表文 \|\|\| 裏文` 一行写清情绪和朗读文本 |
| 舞台 | 自动上场与站位、说话人焦点与跳动、2D / 2.5D、镜头、立绘图层与口型、转盘 / 骰子 / HP 条 |
| 导演指令 | 在台本里插 `/指令`，左侧有快捷按钮（见下表） |
| 配音 | 本地 [Voicebox](https://github.com/jamiepine/voicebox)（Qwen3-TTS 声音克隆）；可选「情绪桥」让克隆声音听从语气提示 |
| 单句精修 | 版本历史、重 roll 队列、语气快捷菜单、角色设定 / 本句状态提示词、一个角色多个声音、分段表演、语调曲线、参考句 |
| 音频 | BGM / 环境声 / 音效分轨、自动闪避、交叉淡化、打字音 |
| 导出 | 视频导出、可交互网页播放器、TyranoScript / YMM 等格式 |

### 导演指令速查

| 指令 | 例子 | 说明 |
|---|---|---|
| 震动 | `/shake 强 2 随机` | 轻/中/强或像素数，固定或随机节奏，可跨好几句 |
| 闪屏 | `/flash white 0.3` | 黑 / 白 / 红或 `#颜色` |
| 漫符 | `/emote 亚瑟 怒 1.6` | 怒 汗 惊 问 惊问 省略 心 音符 闪 黑线 冒气 灵光 |
| 转场 | `/transition 圆开 1.2` | 切 淡入 溶解 左擦 右擦 上擦 下擦 圆开 圆收 百叶窗 碎点 |
| 滤镜 | `/filter 回忆` | 回忆 夜晚 黄昏 黑白 梦境 暗角 危险；`/filter 无` 关闭 |
| 章节卡 | `/card 第一话 "副标题" 3` | 全屏卡片，会停顿 |
| 其他 | `/bg` `/bgm` `/sfx` `/enter` `/dismiss` `/move` `/expression` `/camera` `/wait` | 背景、音乐、上下场、表情、镜头、停顿 |

台词里还可以加局部文字特效：`{抖}撒手啊{/抖}`、`{大}死眉毛{/大}`，以及 波 小 跳 彩 红 蓝 金 绿 灰。配音和翻译会自动忽略这些标记。

### 单句配音精修

在「施工台 → 朗读 → 重 roll、版本与提示词」：

- **分段表演**：按标点把一句切成几段，每段单独选语气、速度（变速不变调）和段后停顿，分别生成再拼接。适合"前半句平静、后半句爆发"。
- **语调曲线**：9 个点的音高起伏；可以只在本地弯曲现有版本的音高，也可以让情绪桥照着重录。
- **参考句**：把念对的一句存成参考声音，别的句子选用它，普通克隆会模仿它的语气；也可以设为角色默认声音。

## 安装（Mac，Apple Silicon）

1. 到 [Releases](https://github.com/Coelum711/Replay-Lab/releases) 下载 `Replay-Lab-…-Mac-arm64.zip`，解压后把 `Replay Lab.app` 拖进「应用程序」。
2. 这个版本没有 Apple 开发者签名。第一次打开如果被拦，在「系统设置 → 隐私与安全性」里点「仍要打开」；或者在终端运行：
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Replay Lab.app"
   ```
3. 配音需要另外安装 [Voicebox](https://github.com/jamiepine/voicebox)，在里面为角色建好声音（上传几秒到几十秒的干净录音），Replay Lab 默认连接 `http://127.0.0.1:17493`。详见 [`VOICEBOX_LOCAL.md`](VOICEBOX_LOCAL.md)。
4. 可选：想让克隆声音听从「生气」「拖长尾音」这类提示，安装情绪桥（运行 `INSTALL_VOICE_BRIDGE.command`，需要约 9 GB 模型）。详见 [`VOICE_BRIDGE_CN.md`](VOICE_BRIDGE_CN.md)。

> 提示：Voicebox 与情绪桥同时用 1.7B 模型时，显存吃紧的电脑可能会让 Voicebox 崩溃。批量生成时建议先跑完情绪桥的句子，再跑普通克隆的句子。

### 从源码运行

需要 Node.js 20 以上。

```bash
npm install
npm run build
npm run desktop
```

测试：`npm test`。打包 Mac 应用：`npm run package:mac`。

## 文档

- 桌面版使用说明：[`DESKTOP_README_CN.md`](DESKTOP_README_CN.md)
- 实际制作流程：[`HUMAN_WORKFLOW_0.57_CN.md`](HUMAN_WORKFLOW_0.57_CN.md)
- 摄像机与施工台：[`CAMERA_WORKBENCH_0.57_CN.md`](CAMERA_WORKBENCH_0.57_CN.md)
- 语调曲线：[`PROSODY_0.56_CN.md`](PROSODY_0.56_CN.md)
- 音频工作台：[`AUDIO_WORKBENCH.md`](AUDIO_WORKBENCH.md)
- 灯光、滤镜与遮罩图层：[`LIGHTING_FILTERS_MASKS.md`](LIGHTING_FILTERS_MASKS.md)
- 2.5D 舞台：[`2_5D_STAGE.md`](2_5D_STAGE.md)；可交互对象：[`CUSTOM_OBJECT_INTERACTION.md`](CUSTOM_OBJECT_INTERACTION.md)
- 更多专题见 [`docs/`](docs/)；历代版本说明与测试记录见 [`docs/history/`](docs/history/)

## 关于二创与 AI 配音

Replay Lab 只是工具，不附带任何角色、立绘或声音。用别人的作品或声音做二创时，请遵守原作与发布平台的规则，并在发布时标明使用了 AI 生成的配音。

## 许可证

[GPL-3.0](LICENSE)。部分功能移植自 [TRPG-Replay-Generator / RplGen](https://github.com/DanDDXuanX/TRPG-Replay-Generator)（GPL-3.0），其他第三方组件及其许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与 [`licenses/`](licenses/)。
