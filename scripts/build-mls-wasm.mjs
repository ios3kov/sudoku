import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifest = join(root, "packages", "mls-wasm", "Cargo.toml");
const outDir = join(root, "apps", "web", "generated", "mls-wasm");
const toolRoot = join(root, ".tools", "wasm-bindgen");
const archive = join(toolRoot, "wasm-bindgen.tar.gz");
const binary = join(
  toolRoot,
  process.platform === "win32" ? "wasm-bindgen.exe" : "wasm-bindgen",
);
const wasm = join(
  root,
  "packages",
  "mls-wasm",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "sudoku_mls_wasm.wasm",
);

const bindgenTargets = {
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    sha256: "2011b2027c3dc68616c3d3265be95f37e12fef8ef21e2dcf0011275da58d19bb",
  },
  "darwin-x64": {
    target: "x86_64-apple-darwin",
    sha256: "b2a465b4538f0bf11685e296ac181c92deb45434cfc849c87a4b418c79214ac6",
  },
  "linux-arm64": {
    target: "aarch64-unknown-linux-musl",
    sha256: "26bec5b1e7ba80e0fd65e5d9f4c88c304f04d9c08d2a4da32ab31af8e2fee8eb",
  },
  "linux-x64": {
    target: "x86_64-unknown-linux-musl",
    sha256: "b391448c4926ac4b11425a6752484d85164e72489d97804461d5e868c643b88a",
  },
  "win32-x64": {
    target: "x86_64-pc-windows-msvc",
    sha256: "f70f9439437b0bb856367d70ac747e42116cb5a6f8a603656ccc93ce02c40bf8",
  },
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function ensureWasmBindgen() {
  if (existsSync(binary)) return;

  const key = `${process.platform}-${process.arch}`;
  const release = bindgenTargets[key];
  if (!release) {
    throw new Error(`Unsupported wasm-bindgen host platform: ${key}`);
  }

  const url =
    `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.105/` +
    `wasm-bindgen-0.2.105-${release.target}.tar.gz`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download wasm-bindgen: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256) {
    throw new Error("wasm-bindgen archive checksum mismatch");
  }

  mkdirSync(toolRoot, { recursive: true });
  writeFileSync(archive, bytes);
  run("tar", ["-xzf", archive, "-C", toolRoot, "--strip-components=1"]);
  rmSync(archive, { force: true });
  if (!existsSync(binary)) {
    throw new Error("wasm-bindgen binary missing after extraction");
  }
  if (process.platform !== "win32") chmodSync(binary, 0o755);
}

run("rustup", [
  "toolchain",
  "install",
  "1.91.0",
  "--profile",
  "minimal",
  "--target",
  "wasm32-unknown-unknown",
]);
run("cargo", [
  "+1.91.0",
  "build",
  "--manifest-path",
  manifest,
  "--target",
  "wasm32-unknown-unknown",
  "--release",
  "--locked",
]);
await ensureWasmBindgen();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
run(binary, [
  wasm,
  "--target",
  "web",
  "--typescript",
  "--out-dir",
  outDir,
  "--out-name",
  "sudoku_mls_wasm",
]);
