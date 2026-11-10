# Replay Lab 0.57.0-dev · Mac 桌面测试版

## 安装与打开

适用于 macOS 13 或更新系统的 Apple Silicon Mac（M 系列芯片）。

1. 解压 `Replay-Lab-0.57.0-Mac-arm64.zip`。
2. 把里面的 `Replay Lab.app` 拖入“应用程序”文件夹。
3. 双击打开。桌面程序自带运行组件，不需要先启动 Python、Node 或浏览器。

此版本尚无 Apple Developer ID 签名及公证。首次打开可能出现开发者验证提示；在确认文件来自本次交付后，可在“系统设置 → 隐私与安全性”里针对 Replay Lab 选择“仍要打开”。无需关闭系统整体安全保护。详见 [Apple 的说明](https://support.apple.com/en-euro/guide/mac-help/mh40616/mac)。

这个版本在 Apple Silicon Mac 上打包，并在真机上用过启动、打开工程、舞台预览、Voicebox 普通克隆与情绪桥出声。如果提示“应用已损坏”，通常是下载隔离标记导致的，可在终端运行 `xattr -dr com.apple.quarantine "/Applications/Replay Lab.app"` 后再打开；若仍直接退出，请保留提示截图并提 Issue。

## 本版新增：角色整理、视角与施工台

角色列表保留最小宽高、长名字换行，并支持直接删除闲置角色、将误识别角色合并到正确角色。合并保留台词、录音及演出引用，可撤销。批量语音失败时，具体错误会显示在角色按钮下方；本机服务失败原因仍需结合错误内容判断。

舞台预览上方可切换摄像机、正视、左右视、俯视和自由查看。在场人数、角色选择、站位与本句摄像机都位于「施工台 → 演出」。施工台顶部边缘可以上下拖动调高度。详见 `CAMERA_WORKBENCH_0.57_CN.md`。

## 保留：单句语调曲线

声音 → 当前单句 → 语调曲线。可以本地微调录音，也可以按曲线调用实验情绪桥重录；试听后采用，旧素材保留。详见 `PROSODY_0.56_CN.md`。

## 从哪里开始

- **首页 → 打开工程**：选择原来的工程文件夹。继续沿用 `project.replaylab.json` 与 `assets/`，不转换项目格式。
- **首页 → 新建工程**：进入制作区，导入台本或粘贴 Log。需要长期保留时，在左侧“保存位置”选择文件夹。
- **最近工程**：显示最近打开的八个工程，可直接继续。
- **制作**：安排角色、舞台、镜头与音轨；原有演出编辑功能继续保留。
- **声音**：打开独立声音窗口，并接续当前工程和当前句。
- **右上角设置**：统一朗读语言与默认声音服务。角色和单句仍可覆盖。画面字幕保持原文。

快捷键：⌘O 打开工程，⌘S 保存，⌘N 新建，⌘, 打开设置，⌘1 回首页。文字输入框的剪切、复制、粘贴继续使用系统快捷键。

## Voicebox 与实验情绪桥

二者仍为可选服务，需要使用时才启动，桌面程序不会自动下载模型。

已经安装的 Voicebox、模型缓存和桥服务可以继续使用。打开声音窗口检查现有地址即可；默认 Voicebox 为 `127.0.0.1:17493`，情绪桥为 `127.0.0.1:17494`。

压缩包中的 `VoiceBridge` 文件夹保留可选桥的安装器、启动器和使用说明。只有使用这条实验路径时才需要 Python 与相应模型。已有的 0.6B Base 继续用于普通克隆；实验文字情绪路径仍要求同尺寸 1.7B Base + 1.7B CustomVoice。

内置免费声音首次使用仍需下载模型；MP4 编码器也可能首次联网加载。应用本体不等于已附带所有声音模型。

## 界面变化

增加最近工程首页、应用图标、统一导航和设置面板。制作区与声音页使用同一套深石墨底色、暖白文字和淡紫色重点色，并调整留白、按钮层级、边框和焦点状态。旧功能继续位于制作工作区，高级工具仍可折叠。

## 开发和重新打包

源码包与桌面应用分别交付。源码中新增：

- `desktop/`：Electron 主进程、隔离的 preload、原生文件操作与本机服务适配。
- `src/workspace/desktop.ts`：桌面工程目录适配，复用原有工程接口。
- `web/desktop-client.js`、`web/desktop-ui.js`、`web/studio-theme.css`：桌面连接与共用界面。
- `scripts/package-desktop.mjs`：生成 Mac arm64 应用目录。

安装依赖后执行 `npm test`、`npm run test:bridge`，再执行 `npm run package:mac`。开发运行使用 `npm run desktop`。当前固定 Electron 44.3.0、Packager 20.3.0。

正式对外发布还需要在 Mac 上实测、申请自己的 Apple 开发者签名并完成公证；本版未配置自动更新。打包行为参照 [Electron 打包文档](https://electron.github.io/packager/main/interfaces/Options.html)，窗口及隔离设置参照 [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 和 [窗口文档](https://www.electronjs.org/docs/latest/api/window-open)。
