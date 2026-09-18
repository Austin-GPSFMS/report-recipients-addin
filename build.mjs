/**
 * Build script: bundles src/main.jsx -> dist/addin.js (single file).
 * Run: node build.mjs
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Force every import of React (including any nested copy under
// @geotab/zenith) to resolve to the single top-level installation.
// Two React copies in one bundle = "Cannot read properties of null
// (reading 'useContext')" and a blank UI at runtime.
const REACT_ALIASES = {
    "react/jsx-runtime": require.resolve("react/jsx-runtime"),
    "react/jsx-dev-runtime": require.resolve("react/jsx-dev-runtime"),
    "react-dom/client": require.resolve("react-dom/client"),
    "react-dom": require.resolve("react-dom"),
    "react": require.resolve("react")
};

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
    alias: REACT_ALIASES,
    logLevel: "info"
});

// Guard: fail loudly if the bundle somehow contains two React copies
// (React 18 uses __SECRET_INTERNALS..., React 19 uses __CLIENT_INTERNALS...).
const bundled = readFileSync(join(here, "dist/addin.js"), "utf8");
const hasReact18 = bundled.includes("__SECRET_INTERNALS_DO_NOT_USE");
const hasReact19 = bundled.includes("__CLIENT_INTERNALS_DO_NOT_USE");
if (hasReact18 && hasReact19) {
    throw new Error(
        "BUILD ABORTED: dist/addin.js contains TWO copies of React (18 and 19). " +
        "Delete node_modules, run 'npm install --legacy-peer-deps' with the pinned versions, and rebuild."
    );
}

// 3) Page add-in host file + translations stub (MyGeotab requests it).
copyFileSync(join(here, "src/index.html"), join(here, "dist/index.html"));
mkdirSync(join(here, "dist/translations"), { recursive: true });
copyFileSync(join(here, "src/translations/en.json"), join(here, "dist/translations/en.json"));

console.log("Build complete -> dist/addin.js");
