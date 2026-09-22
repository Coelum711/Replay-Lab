# 0.54.2-dev 验证记录

执行环境：Linux x86_64，Node 与 Python 3.12。无 Apple Silicon、无 MLX、无真实 Voicebox / Qwen 权重。

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| TypeScript 构建与运行清单 | 通过，102 个 JS 模块 | 源码可编译、分发清单完整 |
| Node 自动测试 | 230 / 230 通过，0 跳过 | 核心回归、模拟 TTS、实验路由/协议、WAV 时长、语言继承、配置副作用 |
| Python 桥测试 | 13 / 13 通过 | 样本 ZIP 解析、尺寸/输入限制、缓存缺失、只读注入代理、真实本机 HTTP 防护与模拟生成 |
| 精确上游输入组装离线探针 | 通过 | 对固定版本 `_prepare_generation_inputs` 用 NumPy 替代张量运算：独立指令前缀存在、2048 维参考向量只插入一次、未查预设音色、原模型未修改 |
| `node --check web/app.js` | 通过 | JS 语法 |
| 两个桥 `.command` 脚本 `bash -n` | 通过 | Shell 语法，不代表 Mac 安装已验证 |
| `python3 bridge/server.py --check` | 正确返回 `ready: false` | 无 MLX / 无缓存时不假报就绪，不下载模型 |
| 本地浏览器预览 | 未完成：`net::ERR_BLOCKED_BY_CLIENT` | 不声称 UI 视觉或实际点击回归通过 |
| Apple Silicon 推理与试听 | 未完成 | 不声称音色保真、情绪有效、口音准确或具体性能 |

Node / Python 测试输出保存在 `tests-0.54.2.log`。其中模拟 PCM 音频不是模型生成样本；“声纹注入确认”不是感知相似度测量。

离线探针使用已核对的 MLX 源码：提交 `04839707811dbe2d5cc61e2a425909eb8399dc59`，Qwen 模块 Git blob SHA-1 为 `cd3af7e7ed967866e98b00ba0decbbc092d769f9`。探针不进入神经网络推理，不能替代 Mac 实测。

本次没有安装模型或改动用户 Voicebox。安装器只在用户确认后下载独立依赖；两个 1.7B 模型需用户按说明显式下载。
