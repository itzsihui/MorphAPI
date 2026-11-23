// usage: node compare_traces.mjs <baseline.json> <trace.json>  -> findings JSON (scripts/crossver/compare.mjs)
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cmp = process.env.COMPARE_MJS || path.join(HERE, "../../scripts/crossver/compare.mjs");
const { compare } = await import(cmp);
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
process.stdout.write(JSON.stringify(compare(a, b)));
