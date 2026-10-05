#!/bin/bash
# 调试脚本：检查 COS 配置是否生效

echo "=== 环境变量检查 ==="
echo "SP_ASSET_BASE_URL: $SP_ASSET_BASE_URL"
echo "SP_DATA_BASE_URL: $SP_DATA_BASE_URL"
echo ""

echo "=== 测试 runtime-config.json 接口 ==="
curl -s http://localhost:3000/runtime-config.json | jq .
echo ""

echo "=== 检查进程环境变量 ==="
ps aux | grep "node.*server/index.js" | grep -v grep
PID=$(ps aux | grep "node.*server/index.js" | grep -v grep | awk '{print $2}' | head -n1)
if [ -n "$PID" ]; then
  echo "Node.js PID: $PID"
  cat /proc/$PID/environ | tr '\0' '\n' | grep "SP_"
else
  echo "未找到运行中的 Node.js 进程"
fi
