import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = fileURLToPath(new URL("./check-web-bundle-budget.mjs", import.meta.url));

for (const mode of ["missing", "empty", "valid", "oversized"]) {
  test(`bundle gate checks ${mode} encryption artifact`, () => {
    const root = mkdtempSync(join(tmpdir(), "sudoku-budget-"));
    try {
      const web = join(root, "apps/web");
      for (const dir of [".next/static/chunks", "public", "generated/mls-wasm"]) {
        mkdirSync(join(web, dir), { recursive: true });
      }
      writeFileSync(join(web, ".next/static/chunks/main.js"), "void 0;");
      writeFileSync(join(web, "public/sw.js"), "void 0;");
      const wasm = join(web, "generated/mls-wasm/sudoku_mls_wasm_bg.wasm");
      if (mode !== "missing") {
        writeFileSync(wasm, mode === "empty" ? Buffer.alloc(0)
          : mode === "oversized" ? Buffer.alloc(8_000_001)
            : Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
      }
      const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, mode === "valid" ? 0 : 1, result.stderr);
      if (mode === "missing") assert.match(result.stderr, /Missing OpenMLS/);
      if (mode === "empty") assert.match(result.stderr, /artifact is empty/);
      if (mode === "oversized") assert.match(result.stderr, /Performance budget failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
