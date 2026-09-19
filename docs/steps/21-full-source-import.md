# Step 21 — Full source import

## Goal

Replace the incomplete direct-source reconstruction with the complete locally verified MVP source tree without losing the later Step 16–20 engineering history.

## Verification before import

- Secret scan: clean.
- Domain tests: 7/7 passed.
- Python compileall: passed.
- Snapshot SHA-256: `9ae3b9842d54a0ed248a2cf3c84d7ce03d1be1cac8903a0911ae4b1410bcbf60`.
- XZ integrity and tar path safety are verified by the import workflow before replacing the repository tree.

## Result

The full API, web client, migrations, integration tests, infrastructure, observability, assets/push, messaging, group/device management and search/preferences source tree is restored. Real service-backed CI is the next acceptance gate.
