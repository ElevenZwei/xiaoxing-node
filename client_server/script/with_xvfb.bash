#!/bin/bash

# 目标 DISPLAY 编号
DISPLAY_NUM=99
DISPLAY=":$DISPLAY_NUM"

# 检查 Xvfb 是否已经运行在指定 DISPLAY 上
if xdpyinfo -display $DISPLAY > /dev/null 2>&1; then
  echo "✅ Xvfb is already running on DISPLAY $DISPLAY"
else
  echo "🚀 Xvfb not found on $DISPLAY, starting a new instance..."

  # 启动 Xvfb
  Xvfb $DISPLAY -screen 0 1920x1080x24 > /tmp/xvfb_$DISPLAY_NUM.log 2>&1 &
  XVFB_PID=$!

  # 等待 Xvfb 启动（最多等待 5 秒）
  for i in {1..10}; do
    if xdpyinfo -display $DISPLAY > /dev/null 2>&1; then
      echo "✅ Xvfb started successfully on $DISPLAY"
      break
    fi
    sleep 0.5
  done

  if ! xdpyinfo -display $DISPLAY > /dev/null 2>&1; then
    echo "❌ Failed to start Xvfb on $DISPLAY"
    exit 1
  fi
fi

# 设置环境变量供后续命令使用
export DISPLAY=$DISPLAY

# 执行传入的命令参数
echo "🚀 Running: $@"
exec "$@"


