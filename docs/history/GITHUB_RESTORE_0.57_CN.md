# 0.57 源码恢复与仓库迁移

从此前交付的 `replay-lab-0.57.0-dev-source.zip` 恢复，基于仓库提交 `1095e4904a5b64eccdd878a2833012c9f2889ba8` 整合。

包含统一语言、实验克隆情绪桥、单句语调曲线、Electron 桌面入口、2.5D 摄像机视角、施工台在场设置、批量语音错误定位，以及角色列表与删除/合并改进。

仓库的 0.53.2 和原上传的同版本包内容不同。迁移保留仓库已有的 Python 启动器同源 Voicebox 转发，浏览器访问本机 17493 时通过 `/__voicebox` 路由；桌面继续使用既有 IPC。Voicebox provider 统一到 `src/tts/voicebox.ts`，原独立浏览器 adapter 的测试迁移到共享 provider。

## 从源码运行

先安装 Node.js/npm 和 Python 3，在仓库目录执行：

```sh
npm ci
npm run build
python3 launch_replay_lab.py
```

桌面开发模式：构建后执行 `npm run desktop`。Mac 打包：`npm run package:mac`。仓库不包含编译后的 dist、node_modules、TTS 模型或桌面安装包；更新源码后需要重新构建。

## 本次验证

- `npm ci --ignore-scripts --no-audit --no-fund`：成功；验证环境跳过 Electron 二进制安装。
- `npm test`：289/289 通过，包含编译、现有 UI 模拟测试及新增浏览器请求路由回归测试。
- `npm run test:bridge`：13/13 通过。
- 未在真实 Mac 或真实 Voicebox 模型上测试，也未重新签名、公证或构建桌面安装包。

历史测试报告保留原记录；本文件记录本次迁移的验证范围。
