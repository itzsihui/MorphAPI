# Code Property Graph

The **Code Graph** tab (`#graph/<scenario>`, e.g. `#graph/mail`) shows what MorphAPI knows about a call site before it asks the LLM to rewrite it. Everything comes from the TypeScript compiler; no neural model is involved.

## How it is built

1. **Program.** `loadProgram()` (`packages/morphapi-core/src/program.ts`) reads the fixture's `tsconfig.json` with `ts.parseJsonConfigFileContent`, so `paths`, `baseUrl`, `types` and module resolution match what `tsc` would do. The tsconfig comes from `tsconfigPath` in `apps/demo-ui/scenarioMeta.mjs`; if that is missing, the service walks up from the first fixture file (`projectSource: "walk"`).
2. **Spans.** The scenario's AST finders (`spanFinders`) mark the call sites to migrate — the same spans the Workbench uses.
3. **Graph.** `buildCodePropertyGraph()` (`packages/morphapi-core/src/codePropertyGraph.ts`) decorates those spans using the TypeChecker:

| Node | Meaning |
|---|---|
| `function` | function / method / const arrow, with `async`, return type, params |
| `variable` | one occurrence of a local or parameter, with role (param / def / assign / use) and resolved type |
| `call_site` | a finder span, with resolved signature, typed arguments mapped to parameters, and why it is deprecated |
| `api_symbol` | the v1 symbol the call resolves to, and each v2 successor symbol |

| Edge | Meaning |
|---|---|
| `comesFrom` / `computedFrom` | data flow between variable occurrences |
| `calls` | function → function it calls (resolved declaration, not name match) |
| `resolves_to` | call site → v1 API symbol |
| `migrates_to` | v1 symbol → v2 successor (from `successorModule` / `successorSymbols`) |
| `contains` | function → call site inside it |
| `argument_of` | variable → call it is passed into |

A call is marked deprecated by, in order: an `@deprecated` JSDoc tag on the resolved declaration (`jsdoc`), the scenario's `deprecatedSymbols` list (`scenario_meta`), or simply being a finder span (`finder_match`).

## The five cards

1. **Source + syntax tree** — the enclosing function, the finder span highlighted in red, identifiers labelled with their checker type.
2. **Typed data-flow graph** — one lane per variable; hover a node to light up the same occurrence in the code and tree.
3. **Code Property Graph** — one lane per file, API symbols in a shared column. Data flow, calls and resolution edges are on by default; `contains` and arguments can be toggled on. Click a node to see its properties and edges.
4. **Slice facts** — the JSON for the selected call site: target call, resolved v1 signature, v2 successors, typed arguments with origins, data flow, how the result is consumed, the enclosing function and 1-hop callers. This is what the hybrid prompt receives instead of the whole file. Token counts are shown next to it; on these small fixtures the facts can be longer than the file, because they add information (types, signatures, callers) the file does not state.
5. **1-hop impact + health** — callers and result consumers, plus health checks: the rate of implicit `any` / unresolved callees, fixture files missing from the program, and tsconfig errors. Explicit `any` written in the source is listed separately, since it is not a resolution failure.

## Headless check

```bash
npm run build -w @morphapi/core
npm run graph:cli -- mail
npm run graph:cli -- async
npm run graph:cli -- envelope
```

Prints node/edge counts, token counts, health and the slice facts. Exits non-zero if a fixture file is missing from the program or `anyCollapseRate` is above 0%. All 11 scenarios currently pass.

The API is `GET /api/graph?scenario=<id>[&file=<name>&start=<offset>]`.
