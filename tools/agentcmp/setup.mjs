// Build one isolated agent workspace (run as root). usage: node setup.mjs <scenario> <wsProjectDir> <user>
// Workspace = the consumer project (package.json, tsconfig.json, src/) + node_modules with the old and new SDK
// (package.json + dist only, ALL comments stripped: the benchmark author's comments name the traps) + shared
// typescript/@types/node (read-only symlinks into /opt/agentcmp/nm). No MorphAPI code, oracles, docs or other runs.
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url); const ts = require("typescript");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { getMeta } = await import(path.join(ROOT, "apps/demo-ui/scenarioMeta.mjs"));
const { S } = require(path.join(ROOT, "scripts/crossver/specs.cjs"));
const [id, ws, user] = process.argv.slice(2);
const meta = getMeta(id); const fixtureRoot = path.join(ROOT, meta.fixtureFiles[0].split("/src/")[0]);
const strip = (file, text) => ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, file.endsWith(".d.ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS));
fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(path.join(ws, "node_modules/@types"), { recursive: true });
for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(fixtureRoot, f), path.join(ws, f));
fs.cpSync(path.join(fixtureRoot, "src"), path.join(ws, "src"), { recursive: true });
for (const pkg of [S[id].lib.v1, S[id].lib.v2]) {
  const src = path.join(ROOT, "packages", pkg), dst = path.join(ws, "node_modules", pkg);
  fs.mkdirSync(path.join(dst, "dist"), { recursive: true });
  const pj = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")); delete pj.description; delete pj.scripts;
  fs.writeFileSync(path.join(dst, "package.json"), JSON.stringify(pj, null, 2));
  for (const f of fs.readdirSync(path.join(src, "dist"))) if (/\.(js|d\.ts)$/.test(f))
    fs.writeFileSync(path.join(dst, "dist", f), strip(f, fs.readFileSync(path.join(src, "dist", f), "utf8")));
}
fs.symlinkSync("/opt/agentcmp/nm/typescript", path.join(ws, "node_modules/typescript"));
fs.symlinkSync("/opt/agentcmp/nm/@types/node", path.join(ws, "node_modules/@types/node"));
fs.mkdirSync(path.join(ws, "node_modules/.bin")); fs.symlinkSync("../typescript/bin/tsc", path.join(ws, "node_modules/.bin/tsc"));
execFileSync("chown", ["-R", `${user}:${user}`, path.dirname(ws)]); execFileSync("chmod", ["700", path.dirname(ws)]);
