# 0.54.1-dev 历史说明更正

该版只增加了前端字段与假定请求协议，没有实现声纹注入后端，不能视作可用的“克隆 + 情绪”功能。

之前向 stock Voicebox `/generate` 发送 `experimental_clone_instruct: true`，并假定不支持时一定会失败，这不是可靠的能力校验。旧的 0.6B CustomVoice 情绪示例也不成立：官方能力表只列 1.7B CustomVoice 支持指令控制。

0.54.2 已移除这个 stock 请求字段，并提供独立本机 MLX 后端、专用能力检查和明确的失败处理。当前实现限同尺寸 1.7B Base → 1.7B CustomVoice，尚待 Apple Silicon 真机验证。说明以 `VOICE_BRIDGE_CN.md` 和 `PATCH_NOTES_0.54.2_DEV.md` 为准。
