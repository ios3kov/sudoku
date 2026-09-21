import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/web");
const ignoredDirectories = new Set([
  "node_modules", ".next", "generated", "test-results", "playwright-report",
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : walk(full);
    }
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const sources = walk(root).map((file) => ({
  file,
  source: fs.readFileSync(file, "utf8"),
}));

// Follow relative side-effect CSS imports instead of assuming all styles live
// in globals.css. Unimported styles must not satisfy the UI class contract.
const cssPaths = new Set();
for (const { file, source } of sources) {
  const imports = /^\s*import\s*["'](\.[^"']+\.css)["']\s*;?/gm;
  for (const match of source.matchAll(imports)) {
    cssPaths.add(path.resolve(path.dirname(file), match[1]));
  }
}
if (cssPaths.size === 0) {
  throw new Error("UI class contract: no imported stylesheets found");
}
const css = [...cssPaths].map((file) => fs.readFileSync(file, "utf8")).join("\n");

const classes = new Set();
for (const { source } of sources) {
  const staticRegex = /className\s*=\s*"([^"]+)"/g;
  for (const match of source.matchAll(staticRegex)) {
    match[1].split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
  }

  const templateRegex = /className\s*=\s*\{\s*`([\s\S]*?)`\s*\}/g;
  for (const match of source.matchAll(templateRegex)) {
    match[1]
      .replace(/\$\{[\s\S]*?\}/g, " ")
      .split(/\s+/)
      .filter((name) => /^[a-zA-Z][\w-]*$/.test(name))
      .forEach((name) => classes.add(name));
    for (const literal of match[1].matchAll(/["']([a-zA-Z][\w-]*)["']/g)) {
      classes.add(literal[1]);
    }
  }

  const expressionRegex = /className\s*=\s*\{([^}]+)\}/g;
  for (const match of source.matchAll(expressionRegex)) {
    for (const literal of match[1].matchAll(/[?:]\s*["']([a-zA-Z][\w-]*)["']/g)) {
      classes.add(literal[1]);
    }
  }
}

const missing = [...classes]
  .filter((name) => !new RegExp("\\." + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])").test(css))
  .sort();

console.log(`UI class contract: ${classes.size} classes checked`);
if (missing.length) {
  console.error("Missing CSS selectors:", missing.join(", "));
  process.exit(1);
}
