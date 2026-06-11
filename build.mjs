/**
 * Build script: bundles src/main.jsx -> dist/addin.js (single file).
 * Run: node build.mjs
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

// 1) Prepare Zenith CSS with @font-face blocks stripped (MyGeotab already
//    serves Roboto; inlining font binaries would bloat the bundle).
const zenithCssPath = join(here, "node_modules/@geotab/zenith/dist/index.css");
const raw = readFileSync(zenithCssPath, "utf8");
const stripped = raw.replace(/@font-face\s*\{[^}]*\}/g, "");
mkdirSync(join(here, "src/generated"), { recursive: true });
writeFileSync(join(here, "src/generated/zenith.css"), stripped);

// 2) Bundle.
mkdirSync(join(here, "dist"), { recursive: true });
await build({
    entryPoints: [join(here, "src/main.jsx")],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2019"],
    outfile: join(here, "dist/addin.js"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "text" },
    logLevel: "info"
});

// 3) Page add-in host file.
copyFileSync(join(here, "src/index.html"), join(here, "dist/index.html"));

console.log("Build complete -> dist/addin.js");
