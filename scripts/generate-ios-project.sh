#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/Sudoku"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "error: full Xcode is required" >&2
  exit 2
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "error: XcodeGen is required (brew install xcodegen)" >&2
  exit 2
fi

cd "$IOS_DIR"
xcodegen generate
xcodebuild -project Sudoku.xcodeproj -scheme Sudoku -showBuildSettings >/dev/null

echo "IOS_PROJECT_GENERATED=$IOS_DIR/Sudoku.xcodeproj"
