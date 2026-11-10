# Replay Lab 0.54.2：本机克隆情绪桥

这份包包含实际的 MLX 后端实现。它仍是**待真机验证的实验功能**：自动测试验证了路由、注入接口和失败保护，没有验证你的 Mac 上的真实音质、速度或声纹相似度。

## 你已有的 0.6B 有用

昨天这条命令下载的模型继续用于普通 Voicebox 克隆，不用删除，也不用重下：

```bash
HF_HUB_DISABLE_XET=1 hf download mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16
```

它不能直接提供这条文字情绪路径。当前桥使用同尺寸的 **MLX 1.7B Base 提取声纹 → 1.7B CustomVoice 接收声纹与情绪指令**。不要为这项功能再下载 0.6B CustomVoice，也不要下载 C 引擎专用格式；本桥不使用 `.qvoice` 或 GGUF。

只需要角色原有的一份参考音频，不需要逐个准备 angry / sad / frightened Profile。完全没有声音样本的角色仍然无法克隆。样本不足 3 秒、损坏、静音或不是兼容的 PCM WAV 时，会明确报错。

## 第一次使用

1. 解压到一个新文件夹，保留旧工程和原 Voicebox。需要 Apple Silicon Mac、原生 arm64 终端、Python 3.10–3.12；不要用 Rosetta 终端。内存占用尚未实测，首次先试一句短台词，不要立刻批量生成。
2. 双击 `INSTALL_VOICE_BRIDGE.command`，输入 `y` 确认。它只在此目录创建 `bridge/.venv`，下载 Python 依赖；不会修改已安装的 Voicebox，不会下载 Qwen 模型。安装需要网络及 Git。如果 macOS 提示开发者无法验证，请先查看脚本，再按系统提示允许运行；不要关闭全局安全保护。
3. 用昨天同一个终端环境，执行下面两条模型下载命令。它们是额外的两个 1.7B 模型，当前仓库合计约 9.1 GB，另需依赖和下载临时空间。下载可与第 2 步分开进行。

```bash
HF_HUB_DISABLE_XET=1 hf download mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16
HF_HUB_DISABLE_XET=1 hf download mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16
```

已下载完整时，`hf download` 通常会复用同一个 HF 缓存。如果终端找不到 `hf`，先完成第 2 步，在本包根目录执行以下等价命令，不必再安装一份系统 CLI：

```bash
HF_HUB_DISABLE_XET=1 ./bridge/.venv/bin/hf download mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16
HF_HUB_DISABLE_XET=1 ./bridge/.venv/bin/hf download mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16
```

4. 启动 Voicebox，确认你要用的克隆 Profile 存在。再双击 `START_VOICE_BRIDGE.command`，保持这个终端窗口打开。
5. 运行 `START_REPLAY_LAB.command`，进入声音页，展开“实验：本机克隆情绪桥”，点击“检查情绪桥”。默认 Voicebox 地址是 `http://127.0.0.1:17493`，桥地址是 `http://127.0.0.1:17494`。两个服务不能填同一个地址。
6. 声音页需要打开/连接你的工程目录；不要假定从 Studio 新开页面就自动拿到了未保存工程。给角色选择 Voicebox 克隆 Profile，模式选“实验：克隆 + 情绪”，尺寸选 1.7B。给当前句填写表演指令，再生成试听。

英文台词可先试：`Speak quietly with restrained anger. Keep the pace steady. Do not shout.` 固定 Seed（例如 42）后比较不同指令。情绪和口音只是模型条件，不保证完全遵从；声纹相似度也需要与你的原样本比对。

“生成并试听”会在成功后写回该句生成音频，已连接工程时也会持久化；这版不是多候选待采用流程。请先下载备份满意音频。用户手工导入的音频仍优先，不会被此路径覆盖。

## 检查与常见问题

- “已连接，尚未就绪”：打开桥状态页，检查两个 1.7B 模型是否完整、是否是 Apple Silicon / arm64，以及独立依赖是否安装。就绪只表示文件/依赖预检通过，不等于真机推理已通过。
- 自定义 HF 缓存：桥识别 `HF_HUB_CACHE`、`HUGGINGFACE_HUB_CACHE`、`HF_HOME`。如果昨天在终端设置过其中之一，从同一个终端启动 `./START_VOICE_BRIDGE.command`；Finder 双击未必继承终端变量。不要为了修路径重复下载模型。本桥默认读取标准 HF 缓存，不支持随意的 `--local-dir` 输出目录。
- Voicebox 不在默认端口：在本包根目录运行 `./bridge/.venv/bin/python bridge/server.py --voicebox http://127.0.0.1:你的端口`，同时修改声音页 Voicebox 地址。桥会核对两端地址，避免误取另一台服务的同名 Profile ID。
- “内部接口版本不匹配”：重新运行安装器。桥绑定 `mlx-audio` 的特定提交，并检查 Qwen 模块哈希；不猜测新版私有接口。其他 Python 依赖按兼容范围安装，尚未制作完整的 Mac 依赖锁文件。
- Profile 报错：当前适配 Voicebox 的 `/profiles/{id}` 与 `/profiles/{id}/export` ZIP 格式；从 `samples.json` 列出的 PCM WAV 中，自动选最长的 3–60 秒样本。不处理预设 Profile，不合并多个情绪样本。已有一份干净样本通常够开始试，不必给角色补全情绪库。
- “忙”：本桥一次只生成一句。其他窗口的请求会报忙，不自动排无限队列。
- 关闭声音网页不会取消正在本机桥中运行的推理；页面不再接收结果。要停止桥，回终端按 Ctrl+C。达到长度上限会拒绝采用截断音频，请拆短台词。
- 本桥合成时使用离线模式，只读取完整本地模型快照。模型缺失会停止，不自动下载，也不退回预设声音。普通 Voicebox 的生成行为由 Voicebox 管理，它仍可能为未安装的模型触发下载。
- 表演指令和发音/韵律口音提示单独送入模型，不拼进台词；地区用词不是本桥的文本改写功能。统一语言改变朗读目标，不负责自动获得译文，跨语言仍需翻译服务或手写朗读文本。
- 声纹缓存位于 `~/Library/Application Support/ReplayLabVoiceBridge/embeddings`。只保存声纹数组，不复制参考录音；录音变化会得到新缓存键。声纹也属于敏感声音数据，请只用于你有权使用的声音，不要把缓存公开分享。

## 开发与验证

```bash
npm ci --ignore-scripts --omit=optional
npm test
npm run test:bridge
```

前端测试使用模拟 API，Python 桥测试使用合成 PCM 与模拟模型，不下载模型。桥 `/health` 可以在无 MLX 的机器启动并准确返回未就绪；真正生成仅在 Apple Silicon 上支持。当前交付环境无法打开本地浏览器预览，也没有 Apple Silicon，未完成 UI 视觉检查和真实推理。

实现入口：`bridge/engine.py`、`bridge/server.py`、`src/tts/voicebox.ts`。服务只绑定回环地址，限制请求来源、请求体与 ZIP 大小；失败不会换用其他角色声音。它确认的是“目标声纹向量进入输入”，不是“感知上必然保持声纹”。

## 已核对来源

- [Qwen 官方模型能力表](https://github.com/QwenLM/Qwen3-TTS)：1.7B CustomVoice 支持 instruction control，0.6B 不支持。
- [MLX 1.7B Base 模型](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16) 与 [MLX 1.7B CustomVoice 模型](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16)：模型格式、下载标识及约 9.1 GB 的合计仓库体积。
- [固定版本的 MLX Qwen 输入组装与生成实现](https://github.com/Blaizzy/mlx-audio/blob/04839707811dbe2d5cc61e2a425909eb8399dc59/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py)：本桥以只读代理注入参考声纹，不修改其预设表。
- [Voicebox Profile 接口](https://github.com/jamiepine/voicebox/blob/main/backend/routes/profiles.py) 与 [Profile 导出格式](https://github.com/jamiepine/voicebox/blob/main/backend/services/export_import.py)。

本包没有移植或安装此前提到的第三方 C 引擎；这里是针对你现有 MLX 环境的新适配实现。
