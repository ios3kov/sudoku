import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const buildDir = path.resolve("apps/web/.next/static/chunks");
const wasmPath = path.resolve("apps/web/generated/mls-wasm/sudoku_mls_wasm_bg.wasm");
const swPath = path.resolve("apps/web/public/sw.js");

const limits = {
  totalJsGzip: 1_300_000,
  largestJsGzip: 320_000,
  wasmRaw: 8_000_000,
  serviceWorkerRaw: 60_000,
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

const jsFiles = walk(buildDir).filter((file) => file.endsWith(".js"));
if (!jsFiles.length) throw new Error("No production JS chunks found; run next build first");

const sizes = jsFiles.map((file) => {
  const data = fs.readFileSync(file);
  return {
    file: path.relative(process.cwd(), file),
    raw: data.byteLength,
    gzip: zlib.gzipSync(data, { level: 9 }).byteLength,
  };
});
const totalJsGzip = sizes.reduce((sum, item) => sum + item.gzip, 0);
const largest = sizes.reduce((max, item) => item.gzip > max.gzip ? item : max, sizes[0]);
const wasmRaw = fs.existsSync(wasmPath) ? fs.statSync(wasmPath).size : 0;
const serviceWorkerRaw = fs.statSync(swPath).size;

console.log(JSON.stringify({
  jsChunkCount: sizes.length,
  totalJsGzip,
  largestJsGzip: largest.gzip,
  largestJsChunk: largest.file,
  wasmRaw,
  serviceWorkerRaw,
}, null, 2));

const failures = [];
if (totalJsGzip > limits.totalJsGzip) failures.push(`total JS gzip ${totalJsGzip} > ${limits.totalJsGzip}`);
if (largest.gzip > limits.largestJsGzip) failures.push(`largest JS gzip ${largest.gzip} > ${limits.largestJsGzip}`);
if (wasmRaw > limits.wasmRaw) failures.push(`OpenMLS WASM ${wasmRaw} > ${limits.wasmRaw}`);
if (serviceWorkerRaw > limits.serviceWorkerRaw) failures.push(`service worker ${serviceWorkerRaw} > ${limits.serviceWorkerRaw}`);

if (failures.length) {
  console.error("Performance budget failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
