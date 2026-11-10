#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo '需要 Apple Silicon Mac，且终端不能通过 Rosetta 运行。'
  exit 1
fi
bridge_python=''
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,12)' 2>/dev/null; then
    bridge_python="$candidate"
    break
  fi
done
if [ -z "$bridge_python" ]; then
  echo '需要 Python 3.10–3.12。请安装 Python 3.12 后重试；不会改动系统 Python 或 Voicebox。'
  read -r -p '按回车关闭。'
  exit 1
fi
echo '将创建独立的 bridge/.venv 并下载 Python 依赖；不会下载 Qwen 模型或修改 Voicebox。'
read -r -p '继续安装？输入 y 然后回车：' bridge_confirm
if [ "$bridge_confirm" != y ]; then exit 0; fi
"$bridge_python" -m venv bridge/.venv
bridge/.venv/bin/python -m pip install -r bridge/requirements.txt
bridge/.venv/bin/python bridge/server.py --check
echo '依赖安装完成。双击 START_VOICE_BRIDGE.command 启动；缺模型时请先阅读 VOICE_BRIDGE_CN.md。'
read -r -p '按回车关闭。'
