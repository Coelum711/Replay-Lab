# Replay Lab 0.23 视频导出架构

## 为什么旧导出又慢又大

0.22 及更早的浏览器成片路径使用 Canvas `captureStream()` + Web Audio + `MediaRecorder`。它的优点是实现简单、浏览器兼容面较宽，但存在三个结构性问题：

1. **必须按真实时间播放。** 一小时 Replay 至少需要约一小时完成录制，不能因为画面大多静止就更快。
2. **旧默认视频码率为 5.5 Mbps。** 仅视频轨理论上约为 2.48 GB/小时（十进制）；这不是“无压缩源格式”，但对以静态立绘/字幕为主的 Replay 明显偏高。
3. **最终 Blob 在内存里聚合。** 很长的片子会增加页面内存压力，连接工程目录后还要再写一遍文件。

真正的逐帧 RGBA“源格式”更不可取：1280×720、30fps、RGBA8 约为 398 GB/小时。因此 Replay Lab 不提供原始帧视频作为普通导出格式。

## 0.23：离线 WebCodecs MP4

主路径改为：

```text
PerformanceDocument
      ↓ 任意时间点
CanvasStageRenderer.renderAt(t)
      ↓
CanvasSource
      ↓
WebCodecs H.264 encoder
      ↓
Mediabunny MP4 muxer
      ↑
OfflineAudioContext (10s chunks)
      ↓
AAC audio source
```

这里的“离线”指**不跟墙上时钟同步**。Renderer 可以连续计算第 0 帧、第 1 帧、第 2 帧……编码器有能力多快接收，就多快生成。因此理论上可以快于实时；实际速度取决于 GPU/CPU、素材解码、Canvas 绘制复杂度和浏览器 WebCodecs 实现，Replay Lab 不承诺固定倍速。

## 为什么选 Mediabunny

Mediabunny 已经解决了浏览器媒体工具最容易踩坑的一层：WebCodecs 编解码抽象、MP4/WebM mux、精确时间戳、流式输出和 backpressure。Replay Lab 只负责“这一帧应该画什么”和“这个时间窗应该混什么音频”，不重新实现 MP4 容器。

0.23 使用：

- `Output`
- `Mp4OutputFormat`
- `CanvasSource`
- `AudioBufferSource`
- `Quality`
- `BufferTarget`
- `StreamTarget`

静态 Studio 通过 ESM URL 加载 Mediabunny 1.56.0；正式 bundled app 应使用 npm 依赖。

## 大文件：直接写磁盘

优先级：

```text
连接的 Replay Lab 工程目录
→ workspace.createWritable("exports/name.mp4")
→ StreamTarget

没有工程目录，但浏览器支持 File System Access
→ showSaveFilePicker()
→ FileSystemWritableFileStream
→ StreamTarget

两者都没有
→ BufferTarget
→ 最后生成 Blob 下载
```

因此 Chrome/Edge 等支持直接文件 writer 的环境，不需要先把整个长视频攒进 RAM。

## 音频为什么分块

如果为两小时 Replay 一次性建立一个 48kHz 双声道 `OfflineAudioContext`，峰值内存并不理想。0.23 默认每 10 秒混一次：

```text
0–10s    mix → AAC
10–20s   mix → AAC
...
```

每块包含对应时间窗内的 Voice / SFX / BGM（含循环 BGM），然后立即交给输出轨。这样音频混音的工作集与总片长基本解耦。

## 默认体积预估

体积预估只按目标码率计算：

`duration × (video bitrate + audio bitrate) / 8`

默认预设：

| 预设 | 视频 | 音频 | 理论约每小时 |
|---|---:|---:|---:|
| 较小 | 1.2 Mbps | 96 kbps | 约 583 MB |
| 均衡 | 2.0 Mbps | 128 kbps | 约 958 MB |
| 较高 | 3.5 Mbps | 160 kbps | 约 1.65 GB |
| 旧 WebM 默认（仅视频） | 5.5 Mbps | 未计 | 约 2.48 GB |

实际文件会受编码器、内容复杂度和容器开销影响。这些数字是容量规划，不是精确承诺。

## 取消与失败

快速 MP4 接受 `AbortSignal`。Studio 导出期间显示“取消导出”；中止会调用 muxer/output 的取消流程并关闭编码资源。工程目录里的中断文件可能需要清理，因此发布前还应在真实 Chrome/Edge 上验证不同取消时机的文件系统行为。

如果浏览器没有可用的 AVC/AAC WebCodecs encoder，Studio 会提示使用“兼容导出 → 实时 WebM”。

## 仍需真实浏览器验证的项目

当前容器无法完成可靠的桌面 WebCodecs E2E，因此 0.23 只宣称源码/逻辑/静态 UI 测试通过，不宣称硬件编码路径已经在所有浏览器完成实机验收。发布前至少应验证：

- Chrome / Edge，Windows + macOS；
- 30 分钟、1 小时、2 小时项目；
- 有/无 BGM、长循环 BGM、多 Voice/SFX；
- 直接写工程目录、Save File Picker、内存 Blob 三条路径；
- 导出取消；
- 页面切后台；
- 最终 MP4 时长、seek、A/V sync；
- 低磁盘空间和编码器不可用错误。
