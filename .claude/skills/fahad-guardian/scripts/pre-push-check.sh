#!/bin/bash
# fahad-guardian: pre-push check — يمنع الـ push إذا فيه مشاكل

echo "🛡️ fahad-guardian: Pre-push check..."

# 1. تحقق من API keys مسرّبة
if grep -rn "sk-ant-" src/ --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null; then
  echo "❌ ANTHROPIC KEY LEAKED IN CODE! Push blocked."
  exit 2
fi

if grep -rn "AIzaSy" src/ --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | grep -v "firebase-applet-config" 2>/dev/null; then
  echo "⚠️  Firebase key in src/ — تأكد إنه مقصود"
fi

# 2. تأكد الـ build يشتغل
echo "🔨 Running build..."
npm run build 2>&1 | tail -3
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "❌ BUILD FAILED! Fix errors before pushing."
  exit 2
fi

echo "✅ Pre-push checks passed — OK to push"
exit 0
