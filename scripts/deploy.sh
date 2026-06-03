#!/usr/bin/env bash
# 部署脚本（占位）。实际部署需在本地登录 Railway / Vercel CLI。
#
# 用法：
#   1. 装 CLI：npm i -g @railway/cli vercel
#   2. 登录：railway login && vercel login
#   3. 后端：cd backend && railway up
#   4. 前端：在 Vercel dashboard 选这个 repo，框架选 Other，build/override 配置见 vercel.json

set -euo pipefail

echo "⚠  实际部署需 Railway/Vercel CLI 已登录。详见 README §Deployment。"
echo ""
echo "后端 (Railway):"
echo "  railway up"
echo ""
echo "前端 (Vercel):"
echo "  vercel --prod"
echo ""
echo "环境变量参考 .env.example。"
