// Bundles src/main.js (with three.js) into dist/game.js and copies public/.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
const result = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020", "safari15"],
  outfile: "dist/game.js",
  sourcemap: false,
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warning",
});
for (const f of readdirSync("dist")) {
  const s = statSync(`dist/${f}`);
  if (s.isFile()) console.log(`${f.padEnd(14)} ${(s.size / 1024).toFixed(0).padStart(6)} KB`);
}
if (result.errors.length) process.exit(1);
