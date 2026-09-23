#!/usr/bin/env bash
set -euo pipefail

plist="ios/App/App/Info.plist"
if [[ ! -f "$plist" ]]; then
  echo "Missing generated iOS Info.plist: $plist" >&2
  exit 1
fi

description="Use Face ID to unlock your private messages."

if /usr/libexec/PlistBuddy -c "Print :NSFaceIDUsageDescription" "$plist" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :NSFaceIDUsageDescription $description" "$plist"
else
  /usr/libexec/PlistBuddy -c "Add :NSFaceIDUsageDescription string $description" "$plist"
fi

# CNContactPickerViewController intentionally does not request broad Contacts
# authorization, so NSContactsUsageDescription is not added here.
echo "[ios] generated Info.plist configured"
