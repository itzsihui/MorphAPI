import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface TypecheckResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
}

function resolveTsc(projectDir: string): { bin: string; prefixArgs: string[] } {
  const candidates = [
    path.resolve(projectDir, "node_modules/typescript/bin/tsc"),
    path.resolve(projectDir, "../node_modules/typescript/bin/tsc"),
    path.resolve(projectDir, "../../node_modules/typescript/bin/tsc"),
    path.resolve(projectDir, "../../../node_modules/typescript/bin/tsc"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { bin: c, prefixArgs: [] };
  }
  return { bin: "npx", prefixArgs: ["--no-install", "tsc"] };
}

/**
 * Run tsc --noEmit in a project directory.
 */
export function runTypecheck(projectDir: string): TypecheckResult {
  const { bin, prefixArgs } = resolveTsc(projectDir);
  const args = [...prefixArgs, "--noEmit", "-p", "tsconfig.json"];

  const result = spawnSync(bin, args, {
    cwd: projectDir,
    encoding: "utf8",
    env: process.env,
  });

  return {
    ok: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    command: `${bin} ${args.join(" ")}`,
  };
}
