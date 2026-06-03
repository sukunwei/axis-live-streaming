#!/usr/bin/env bash
#
# Playback 2-min × 4-channel test driver (manual, browser-driven).
#
# 此脚本只是**打印步骤**，不自动化（播放必须真浏览器）。
# 完成后跑 scripts/analyze-playback.py 看结果。
#
# 流程：
#   1. 打开 http://localhost:5173
#   2. 依次点 4 个频道各播 2 min
#   3. 期间所有 HUD 数据 + stalls 自动通过 /api/log-playback 上报
#   4. 数据落在 /tmp/playback-YYYYMMDD.jsonl
#   5. 跑 analyze-playback.py

set -euo pipefail

LOG_DIR="/tmp"
TODAY=$(date +%Y%m%d)
LOG_FILE="$LOG_DIR/playback-$TODAY.jsonl"

echo "=========================================="
echo "  Playback 2-min × 4-channel Test Driver"
echo "=========================================="
echo ""
echo "  目的：实测 4 个频道的真实播放质量，给 smoothness 算法校准"
echo "  时长：~10 min（每频道 2 min + 切换）"
echo "  数据：$LOG_FILE"
echo ""

if [ -f "$LOG_FILE" ]; then
  current_lines=$(wc -l < "$LOG_FILE")
  echo "  ⚠ log 已存在，$current_lines 行。建议重命名/清空后开始新测试："
  echo "    mv $LOG_FILE $LOG_FILE.bak.$(date +%H%M%S)"
  echo ""
  read -p "  是否继续（追加到现有 log）？[y/N] " -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
  fi
fi

echo "  步骤："
echo ""
echo "  1. 打开浏览器："
echo "       http://localhost:5173"
echo ""
echo "  2. 对 4 个频道依次（按下面顺序）："
echo "     - DW English        →  播 2 min"
echo "     - Mux LL-HLS Test   →  播 2 min"
echo "     - Mux VOD Test      →  播 2 min"
echo "     - Apple BipBop      →  播 2 min"
echo ""
echo "     每频道 2 min，期间："
echo "     - 看 HUD 数字变化"
echo "     - 注意 stalls/dropped/buffer 是否稳定"
echo "     - 切下一频道不需要等，但保留浏览器在前台"
echo ""
echo "  3. 完成后跑分析："
echo "       ./scripts/analyze-playback.py"
echo "       ./scripts/analyze-playback.py $LOG_FILE"
echo ""
echo "  4. 完成后端 log（health 变化 + proxy 错误）："
echo "       tail -50 /private/tmp/.../bac7oteni.output | grep -E 'health|playback'"
echo ""
echo "  提示："
echo "  - 切源时数据会切到新频道（每频道独立 sample）"
echo "  - sample 间隔 5s，2 min 每频道约 24 个 sample"
echo "  - 总共 ~96 sample + 8 mount/unmount"
echo "  - log 格式: {ts, channelId, stalls, droppedFrames, ...}"
echo ""
echo "=========================================="
echo "  Ready? 在浏览器里开始播放第一个频道"
echo "=========================================="
