#!/usr/bin/env bash
# 測試門檻部署：npm test 全綠才 pm2 重啟，否則中止（服務維持舊版本不動）。
# 用法：npm run deploy  或  bash scripts/deploy.sh
cd "$(dirname "$0")/.." || exit 1

echo "▶ 部署前回歸測試…"
if npm test; then
  echo "✓ 測試通過，重啟服務…"
  pm2 restart mamacare --update-env
  echo "✓ 已部署（mamacare 已重啟）"
else
  echo "✗ 測試未通過，已中止部署——服務維持原狀，未重啟。"
  exit 1
fi
