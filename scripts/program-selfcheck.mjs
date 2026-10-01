#!/usr/bin/env node
/**
 * Checks the program-derived pieces against the hand-authored ones on all
 * scenarios: generic findDeprecatedReferences vs the scenario's AST finders,
 * and the incremental session (patch → diagnostics → reset).
 *   node scripts/program-selfcheck.mjs [scenario...]
 */
import path from "path";
import { fileURLToPath } from "url";
import { SCENARIO_META } from "../apps/demo-ui/scenarioMeta.mjs";
import { collectSpans, loadCoreModule } from "../apps/demo-ui/spansService.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = await loadCoreModule(ROOT);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIO_META);

let failed = 0;
for (const id of ids) {
  const meta = SCENARIO_META[id];
  const files = meta.fixtureFiles.map((f) => path.join(ROOT, f));
  const session = core.ProjectSession.open(path.join(ROOT, meta.tsconfigPath), { requireDeps: true });
  const generic = core.findDeprecatedReferences(session, meta.deprecatedSpec, { files });
  const hand = (await collectSpans(ROOT, id)).files.flatMap((f) => f.spans);
  const key = (s) => `${s.fileName}:${s.startLine}`;
  const g = new Set(generic.map(key));
  const h = new Set(hand.map(key));
  const missed = [...h].filter((k) => !g.has(k));
  const extra = [...g].filter((k) => !h.has(k));

  const before = session.diagnostics(files).length;
  const first = files[0];
  session.update({ [first]: session.text(first) + "\nconst __selfcheck: number = 'x';\n" });
  const patched = session.diagnostics([first]).length;
  session.reset();
  const after = session.diagnostics(files).length;
  const incrementalOk = patched === before + 1 && after === before;

  const ok = generic.length > 0 && incrementalOk;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${id.padEnd(14)} generic=${generic.length} hand=${hand.length}` +
      (missed.length ? ` handOnly=[${missed.join(", ")}]` : "") +
      (extra.length ? ` genericOnly=[${extra.join(", ")}]` : "") +
      ` diags=${before}${incrementalOk ? "" : ` patched=${patched} reset=${after}`}`
  );
}
const FIX = path.join(ROOT, "packages/morphapi-core/test-fixtures/alias-monorepo");
const fixtureCases = [
  ["paths alias + import rename", "tsconfig.json", "app/src/users.ts", "@http/client#getJson"],
  ["NodeNext .js import", "nodenext/tsconfig.json", "nodenext/src/main.ts", "./client.js#getJson"],
  ["Bundler namespace import", "bundler/tsconfig.json", "bundler/src/main.ts", "./client#getJson"],
];
for (const [label, tsconfig, file, spec] of fixtureCases) {
  const session = core.ProjectSession.open(path.join(FIX, tsconfig));
  const abs = path.join(FIX, file);
  const found = core.findDeprecatedReferences(session, spec, { files: [abs] });
  const diags = session.diagnostics([abs]);
  const ok = found.length === 1 && diags.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} fixture: ${label.padEnd(28)} refs=${found.length} diags=${diags.length}` +
      (diags.length ? ` ${diags.map((d) => d.message).join(" | ")}` : "")
  );
}
process.exit(failed ? 1 : 0);
