import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("restore failure leaves application traffic stopped", () => {
  const root = mkdtempSync(join(tmpdir(), "sudoku-restore-"));
  const bin = join(root, "bin");
  const backup = join(root, "backup");
  mkdirSync(bin);
  mkdirSync(join(backup, "objects"), { recursive: true });
  writeFileSync(join(root, ".env.production"), "APP_DOMAIN=sudoku.test\n");
  writeFileSync(join(backup, "postgres.dump"), "not-a-real-dump");
  writeFileSync(join(backup, "manifest.txt"), "created_utc=test\\n");
  const sum = execFileSync(
    "sha256sum",
    ["postgres.dump", "manifest.txt"],
    { cwd: backup, encoding: "utf8" },
  );
  writeFileSync(join(backup, "SHA256SUMS"), sum);

  const docker = `#!/usr/bin/env bash
set -eu
echo "$*" >> "${DOCKER_LOG}"
if [[ "$*" == *"pg_restore"* ]]; then exit 42; fi
exit 0
`;
  writeFileSync(join(bin, "docker"), docker, { mode: 0o755 });

  const result = spawnSync(
    "bash",
    [join(process.cwd(), "scripts/restore-production.sh"), backup],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        ENV_FILE: join(root, ".env.production"),
        RESTORE_CONFIRM: "YES",
        DOCKER_LOG: join(root, "docker.log"),
      },
    },
  );
  assert.equal(result.status, 42);
  assert.match(result.stderr, /remain stopped/);
  const log = readFileSync(join(root, "docker.log"), "utf8");
  assert.match(log, /stop caddy web api worker beat/);
  assert.doesNotMatch(log, /up -d api worker beat web caddy/);
});

test("wrapping key creation cannot overwrite a concurrent winner", () => {
  const source = readFileSync(
    "apps/web/features/messenger/crypto/browser-state-store.ts",
    "utf8",
  );
  assert.match(source, /\.add\(key, WRAPPING_KEY_ID\)/);
  assert.match(source, /ConstraintError/);
  assert.doesNotMatch(source, /\.put\(key, WRAPPING_KEY_ID\)/);
});

test("voice recorder owns the acquired stream before MediaRecorder construction", () => {
  const source = readFileSync(
    "apps/web/features/messenger/encrypted-conversation-view.tsx",
    "utf8",
  );
  const acquired = source.indexOf("mediaStreamRef.current = stream;");
  const constructed = source.indexOf("new MediaRecorder(stream");
  assert.ok(acquired >= 0 && constructed >= 0 && acquired < constructed);
  assert.match(source, /acquiredStream\?\.getTracks\(\)\.forEach/);
});

test("decrypted attachment completion is invalidated on release and unmount", () => {
  const source = readFileSync(
    "apps/web/features/messenger/encrypted-attachment.tsx",
    "utf8",
  );
  assert.match(source, /decryptGenerationRef\.current \+= 1/);
  assert.match(source, /!mountedRef\.current \|\| generation !== decryptGenerationRef\.current/);
  assert.match(source, /mountedRef\.current = false/);
  assert.match(source, /!nearViewport && state !== "idle"/);
});
