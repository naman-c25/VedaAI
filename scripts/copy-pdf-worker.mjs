/**
 * Copies the pdf.js worker into public/ so the browser can load it from a stable
 * absolute path. Resolving the worker through a bundler specifier is fragile
 * across Webpack/Turbopack; a static file in public/ works the same locally and
 * on Vercel. Runs before dev and build.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const source = join(pdfjsRoot, "build", "pdf.worker.min.mjs");
const destDir = join(process.cwd(), "public");
const dest = join(destDir, "pdf.worker.min.mjs");

if (!existsSync(source)) {
  console.error(`[copy-pdf-worker] worker not found at ${source}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
console.log(`[copy-pdf-worker] -> public/pdf.worker.min.mjs`);
