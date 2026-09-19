import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifest = join(root, "packages", "mls-wasm", "Cargo.toml");
const outDir = join(root, "apps", "web", "generated", "mls-wasm");
const toolRoot = join(root, ".tools", "wasm-bindgen");
const binary = join(
  toolRoot,
  "bin",
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
run("cargo", [
  "+1.91.0",
  "install",
  "wasm-bindgen-cli",
  "--version",
  "0.2.105",
  "--locked",
  "--root",
  toolRoot,
]);

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
