import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(new URL("./check-web-ui-contract.mjs", import.meta.url));

function checkFixture(files) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sudoku-ui-contract-"));
  try {
    const sources = {
      "apps/web/app/layout.tsx": 'import "./globals.css";\nexport default () => <main className="page" />;\n',
      "apps/web/app/globals.css": ".page { display: block; }\n",
      ...files,
    };
    for (const [relativePath, content] of Object.entries(sources)) {
      const file = path.join(cwd, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const result = spawnSync(process.execPath, [checker], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test("checks the existing global stylesheet", () => {
  const result = checkFixture({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 classes checked/);
});

test("includes the separate messenger stylesheet imported by the root layout", () => {
  const result = checkFixture({
    "apps/web/app/layout.tsx": [
      'import "./globals.css";',
      'import "../features/messenger/messenger-redesign.css";',
      'export default () => <main className="page minimal-chat-list" />;',
    ].join("\n"),
    "apps/web/features/messenger/messenger-redesign.css": ".minimal-chat-list { display: grid; }",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 classes checked/);
});

test("still fails for genuinely missing selectors", () => {
  const result = checkFixture({
    "apps/web/components/example.tsx": 'export const Example = () => <div className="missing-selector" />;',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing CSS selectors: missing-selector/);
});

test("an unimported stylesheet cannot hide a missing selector", () => {
  const result = checkFixture({
    "apps/web/components/example.tsx": 'export const Example = () => <div className="unloaded-class" />;',
    "apps/web/features/unused.css": ".unloaded-class { display: block; }",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing CSS selectors: unloaded-class/);
});

test("fails when an imported stylesheet is missing", () => {
  const result = checkFixture({
    "apps/web/app/layout.tsx": 'import "./globals.css";\nimport "./missing.css";\nexport default () => <main className="page" />;',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing\.css/);
});

test("ignores generated output and third-party sources", () => {
  const result = checkFixture({
    "apps/web/.next/server/example.tsx": '<div className="generated-only" />',
    "apps/web/node_modules/example/index.tsx": '<div className="vendor-only" />',
    "apps/web/generated/example.tsx": '<div className="generated-code" />',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 classes checked/);
});

test("resolves component CSS imports relative to their importing file", () => {
  const result = checkFixture({
    "apps/web/features/chat/view.tsx": [
      "import './view.css';",
      'export const View = () => <section className={`chat ${busy ? "is-busy" : ""}`} />;',
    ].join("\n"),
    "apps/web/features/chat/view.css": ".chat { display: grid; } .chat.is-busy { opacity: .5; }",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 classes checked/);
});
