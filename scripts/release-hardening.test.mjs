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
echo "$*" >> "\${DOCKER_LOG}"
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

// Media lifetime and storage commit behavior are exercised by the real-browser
// suites media-hardening.spec.ts and state-store.spec.ts, not source regexes.

test("service worker refreshes the offline root without caching private APIs", () => {
  const source = readFileSync("apps/web/public/sw.js", "utf8");
  assert.match(source, /cache\.put\("\/", copy\)/);
  assert.match(source, /url\.pathname\.startsWith\("\/v1\/"\)/);
  assert.ok(
    source.indexOf('url.pathname.startsWith("/v1/")')
      < source.indexOf('event.request.mode === "navigate"'),
  );
});

test("small messenger text keeps WCAG AA contrast tokens", () => {
  const redesign = readFileSync(
    "apps/web/features/messenger/messenger-redesign.css",
    "utf8",
  );
  const ux3 = readFileSync(
    "apps/web/features/messenger/messenger-ux3.css",
    "utf8",
  );
  const globals = readFileSync("apps/web/app/globals.css", "utf8");
  assert.doesNotMatch(redesign, /color:#94a3b8/);
  assert.match(redesign, /\.own \.message-time\{\s*color:rgba\(255,255,255,\.92\)/);
  assert.match(ux3, /message-date-separator[^}]*color:#5f6f84/);
  assert.match(globals, /placeholder\{color:#64748b\}/);
});

// GitHub's explicit bash shell includes -o pipefail. Without it, a failed
// profiler piped through tee could be mistaken for a successful release gate.
test("profile pipelines propagate failure instead of tee's success", () => {
  for (const file of [".github/workflows/ci.yml", ".github/workflows/hardening-behavior.yml"]) {
    assert.match(readFileSync(file, "utf8"), /defaults:\s+run:\s+shell: bash/);
  }
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", "(exit 42) | cat; exit 0"], { encoding: "utf8" });
  assert.equal(result.status, 42);
});
