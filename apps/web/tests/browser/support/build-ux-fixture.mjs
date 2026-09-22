import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import nextWebpack from "next/dist/compiled/webpack/webpack.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

// Test-only fixture, compiled with the project's pinned Next/TypeScript tools.
// No test route or observer is shipped in the Next application.
export default async function buildFixture(options = {}) {
  const { entry = "ux-fixture.tsx", aliases = {} } = typeof options === "string" ? { entry: options } : options;
  const outputPath = await fs.mkdtemp(path.join(os.tmpdir(), "sudoku-ux-fixture-"));
  const compiler = nextWebpack.webpack({
    mode: "production", devtool: false, target: "web",
    entry: path.join(directory, entry),
    plugins: entry === "audit-fixture.tsx" ? [new nextWebpack.webpack.NormalModuleReplacementPlugin(
      /^\.\/uploads$/,
      path.join(directory, "audit-media-services.ts"),
    )] : [],
    output: { path: outputPath, filename: "fixture.js" },
    optimization: { minimize: false },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: aliases },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "fixture-loader.mjs") }] },
  });
  try {
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
      if (error) reject(error);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
    return await fs.readFile(path.join(outputPath, "fixture.js"), "utf8");
  } finally {
    await new Promise((resolve) => compiler.close(resolve));
    await fs.rm(outputPath, { recursive: true, force: true });
  }
};
