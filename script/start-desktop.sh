#!/bin/sh
# 构建本地前端与 Agent，然后启动 Electron 桌面版。
set -eu

cd "$(dirname "$0")/.."

npm --prefix canvas-agent run build
sh script/build-plugins.sh
npm --prefix web run build
exec npm --prefix desktop start
