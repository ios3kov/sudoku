import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/web");
const cssPath = path.join(root, "app/globals.css");
const css = fs.readFileSync(cssPath, "utf8");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const classes = new Set();
for (const file of walk(root)) {
  const source = fs.readFileSync(file, "utf8");
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
    for (const literal of match[1].matchAll(/["']([a-zA-Z][\w-]*)["']/g)) {
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
