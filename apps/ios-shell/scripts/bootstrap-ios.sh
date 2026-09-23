#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Full Xcode is required before generating the iOS project." >&2
  exit 1
fi

export SUDOKU_IOS_REMOTE_URL="${SUDOKU_IOS_REMOTE_URL:-https://sudoku.moscow}"

npm install

if [[ ! -d ios ]]; then
  npx cap add ios
fi

npx cap sync ios
bash scripts/configure-generated-ios.sh

echo "[ios] shell ready"
echo "[ios] open with: npx cap open ios"
