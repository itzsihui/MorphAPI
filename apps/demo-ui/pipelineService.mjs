/**
 * Runs the generic MorphAPI pipeline (runMigration) on a live scenario.
 * Shared by scripts/morph-run.mjs and GET /api/pipeline.
 */
import fs from "fs";
import path from "path";
import { getMeta } from "./scenarioMeta.mjs";
import { loadCoreModule } from "./spansService.mjs";

export const PIPELINE_ARMS = ["arm1_morphapi", "arm0_llm_full", "arm_codemod", "arm_ast", "ast_no_gate", "ast_no_impact", "arm0_llm_only", "ablA_no_slices", "ablB_no_oracle", "ablC_no_impact"];

/**
 * @param {string} root
 * @param {string} scenario
 * @param {{ arm?: string; model?: string; onEvent?: (e: object) => void; propose?: (messages: object[]) => Promise<string> }} [opts]
 */
/** The successor package's own declaration file, as the fair LLM baseline's reference. */
function successorDecls(root, mod) {
  const f = path.join(root, "packages", mod, "dist", "index.d.ts");
  return fs.existsSync(f) ? `## ${mod} type declarations (index.d.ts)\n\`\`\`ts\n${fs.readFileSync(f, "utf8")}\n\`\`\`` : "";
}

export async function runScenarioPipeline(root, scenario, opts = {}) {
  const meta = getMeta(scenario);
  const core = await loadCoreModule(root);
  const docs = path.join(root, meta.docsPath);
  const run = await core.runMigration({
    repoRoot: root,
    tsconfigPath: path.join(root, meta.tsconfigPath),
    files: meta.fixtureFiles.map((f) => path.join(root, f)),
    deprecatedSpec: meta.deprecatedSpec,
    deprecatedSymbols: meta.deprecatedSymbols,
    successorModule: meta.successorModule,
    successorSymbols: meta.successorSymbols,
    successorKind: meta.successorKind,
    guide: fs.existsSync(docs) ? fs.readFileSync(docs, "utf8") : undefined,
    arm: PIPELINE_ARMS.includes(opts.arm) ? opts.arm : "arm1_morphapi",
    model: opts.propose ? undefined : core.resolveModelProfile(opts.model ?? "mini"),
    propose: opts.propose,
    codemod: opts.codemod,
    task: opts.arm === "arm0_llm_full" ? successorDecls(root, meta.successorModule) : undefined,
    onEvent: opts.onEvent,
  });
  return { scenario: meta.id, label: meta.label, ...run };
}
