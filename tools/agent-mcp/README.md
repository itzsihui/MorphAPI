# MorphAPI as tools for a coding agent (MCP)

`morph_mcp.cjs` is a stdio MCP server that gives a coding agent (e.g. Claude Code) two MorphAPI tools.
It calls no LLM, and it needs no API key.

- `migration_status`: lists every site the dependency upgrade still breaks. MorphAPI finds them with the previous SDK version loaded beside the new one (the version bridge). The list includes uses of exports the new version dropped, which the compiler does not flag at each use, and untyped hand-offs to packages written for a replaced SDK.
- `check_edit`: runs MorphAPI's gate over the current edits, compared with the start state:
  - new errors under the **project's own** TypeScript;
  - added `as any`, `: any` or `@ts-ignore`;
  - imports of a compatibility layer or a replaced package;
  - `X.prototype.instanceProperty`, which is undefined at runtime.

Usage (paths in the evaluation harness differ):

    node tools/agent-mcp/morph_mcp.cjs <task.json> <workspace>

`task.json` contains `tsconfig`, `bridges` (`[{module, previousDir}]`), `successorModules`, and optionally `retiredModules` and `extraFiles`.
