/**
 * Code Property Graph for a scenario: loads the fixture's ts.Program from the
 * tsconfig registered in scenarioMeta, then decorates the finder spans with
 * types, data flow, calls and API migration edges.
 */
import path from "path";
import { getMeta } from "./scenarioMeta.mjs";
import { collectSpans, loadCoreModule } from "./spansService.mjs";

/**
 * @param {string} root
 * @param {string} scenarioInput
 * @param {{ file?: string; start?: number }} [focus]
 */
export async function buildScenarioGraph(root, scenarioInput, focus = {}) {
  const meta = getMeta(scenarioInput);
  const core = await loadCoreModule(root);
  const spansPayload = await collectSpans(root, meta.id);

  let tsconfigPath = meta.tsconfigPath ? path.join(root, meta.tsconfigPath) : null;
  let projectSource = "meta";
  if (!tsconfigPath) {
    tsconfigPath = core.findNearestTsconfig(path.dirname(path.join(root, meta.fixtureFiles[0])));
    projectSource = "walk";
  }
  if (!tsconfigPath) throw new Error(`No tsconfig.json found for scenario ${meta.id}`);

  const spans = spansPayload.files.flatMap((f) => f.spans);
  const graph = core.buildCodePropertyGraph({
    tsconfigPath,
    repoRoot: root,
    files: meta.fixtureFiles.map((f) => path.join(root, f)),
    spans,
    deprecatedSymbols: meta.deprecatedSymbols ?? [],
    successorSymbols: meta.successorSymbols ?? [],
    successorModule: meta.successorModule ?? null,
    focus:
      focus.file && Number.isFinite(focus.start)
        ? { fileName: focus.file, start: focus.start }
        : null,
  });

  return {
    scenario: meta.id,
    label: meta.label,
    number: meta.number,
    projectSource,
    spanFinders: meta.spanFinders,
    spans: spans.map((s) => ({
      fileName: s.fileName,
      start: s.start,
      startLine: s.startLine,
      kind: s.kind,
    })),
    files: spansPayload.files.map((f) => ({ name: f.name, path: f.path, source: f.source })),
    ...graph,
  };
}
