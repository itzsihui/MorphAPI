// Prints the agent's task prompt (identical for both arms). usage: node prompt.mjs <scenario>
import fs from "fs"; import path from "path"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url); const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { getMeta } = await import(path.join(ROOT, "apps/demo-ui/scenarioMeta.mjs")); const { S } = require(path.join(ROOT, "scripts/crossver/specs.cjs"));
const id = process.argv[2]; const m = getMeta(id); const { v1, v2 } = S[id].lib;
process.stdout.write(`Migrate the TypeScript project in the current directory from the deprecated package \`${v1}\` to its successor \`${v2}\` (both are installed in node_modules).
Deprecated API: ${m.deprecatedSpec}.

Requirements:
- The project must type-check: \`npx tsc --noEmit -p tsconfig.json\`.
- No file may import or require \`${v1}\` any more.
- Runtime behaviour must stay the same as before the migration.
- Edit files under src/ only. Do not use \`as any\`, \`: any\`, \`@ts-ignore\`, \`@ts-expect-error\` or \`@ts-nocheck\`.

Migration guide for ${v2}:
----------------------------------------------------------------
${fs.readFileSync(path.join(ROOT, m.docsPath), "utf8")}
----------------------------------------------------------------
`);
