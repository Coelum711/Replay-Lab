#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x bridge/.venv/bin/python ]; then
  echo '请先双击 INSTALL_VOICE_BRIDGE.command 安装独立依赖。'
  read -r -p '按回车关闭。'
  exit 1
fi
exec bridge/.venv/bin/python bridge/server.py
