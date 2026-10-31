import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toRepoRelative } from "../../src/agent/policy.ts";
import {
  TEST_TIMEOUT_MS,
  TYPECHECK_TIMEOUT_MS,
} from "../../src/agent/verify.ts";
import {
  BASELINE_DIR,
  clearReports,
  COVERAGE_ARGS,
  describeTestRun,
  readCoverage,
  readSummary,
  REPORT_ARGS,
  type TestRunDetails,
  type TestSummary,
  type TypecheckDetails,
} from "../../src/agent/vitest.ts";
import { loadConfig } from "../../src/config.ts";

function tail(text: string, chars = 4000): string {
  return text.slice(-chars);
}

/** pi.exec reports a process that a timeout or an abort killed as exit code 0. */
function exitCodeOf(result: ExecResult): number {
  return result.killed ? 1 : result.code;
}

function appRelativePath(
  repoRoot: string,
  appCwd: string,
  file: string,
): string {
  const rel = toRepoRelative(repoRoot, file);
  if (rel === null || !rel.startsWith(`${appCwd}/`)) {
    throw new Error(`Refused path "${file}": not inside ${appCwd}/`);
  }
  const inApp = rel.slice(appCwd.length + 1);
  if (inApp.startsWith("-")) {
    throw new Error(
      `Refused path "${file}": vitest would read it as an option`,
    );
  }
  return inApp;
}

interface VitestRun {
  summary: TestSummary;
  exitCode: number;
  output: string;
}

export default function (pi: ExtensionAPI) {
  const { apps } = loadConfig(
    fileURLToPath(new URL("../../config.json", import.meta.url)),
  );
  const App = StringEnum(Object.keys(apps));

  async function runVitest(
    command: string,
    args: string[],
    appDir: string,
    signal: AbortSignal | undefined,
  ): Promise<VitestRun> {
    clearReports(appDir);
    const result = await pi.exec(command, args, {
      cwd: appDir,
      signal,
      timeout: TEST_TIMEOUT_MS,
    });
    const output = result.stdout + result.stderr;
    return {
      summary: readSummary(appDir, output),
      exitCode: exitCodeOf(result),
      output,
    };
  }

  pi.registerTool({
    name: "typecheck",
    label: "Typecheck",
    description:
      "Run the TypeScript compiler for one app. Returns pass, or the end of the compiler output.",
    promptSnippet: "Typecheck an app with tsc",
    parameters: Type.Object({ app: App }),
    async execute(_toolCallId, { app }, signal, _onUpdate, ctx) {
      const [command, ...args] = apps[app].typecheck;
      const result = await pi.exec(command, args, {
        cwd: path.join(ctx.cwd, apps[app].cwd),
        signal,
        timeout: TYPECHECK_TIMEOUT_MS,
      });
      const details: TypecheckDetails = { app, exitCode: exitCodeOf(result) };
      const text =
        details.exitCode === 0
          ? `typecheck ${app}: pass`
          : `typecheck ${app}: FAIL (exit ${details.exitCode})\n${tail(result.stdout + result.stderr)}`;
      return { content: [{ type: "text", text }], details };
    },
  });

  pi.registerTool({
    name: "run_tests",
    label: "Run tests",
    description:
      "Run vitest for one app. Without files it runs the full suite with coverage, as the harness does after you report. With files it runs only those test files, without coverage. Use repeat to detect flaky tests.",
    promptSnippet: "Run vitest for an app (full suite, or selected files)",
    promptGuidelines: [
      "Call run_tests after every test file you write or change. Never guess whether tests pass.",
    ],
    parameters: Type.Object({
      app: App,
      files: Type.Optional(
        Type.Array(Type.String(), {
          minItems: 1,
          description: "Repo-relative test files. Omit to run the full suite.",
        }),
      ),
      repeat: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 5,
          description: "Run N times to detect flaky tests",
        }),
      ),
    }),
    async execute(
      _toolCallId,
      { app, files, repeat = 1 },
      signal,
      _onUpdate,
      ctx,
    ) {
      const { cwd: appCwd, vitest } = apps[app];
      const appDir = path.join(ctx.cwd, appCwd);
      const [command, ...baseArgs] = vitest;
      const selected = files?.map((file) =>
        appRelativePath(ctx.cwd, appCwd, file),
      );
      const args = [
        ...baseArgs,
        ...REPORT_ARGS,
        ...(selected ?? COVERAGE_ARGS),
      ];

      const runs: VitestRun[] = [];
      for (let i = 0; i < repeat; i++) {
        runs.push(await runVitest(command, args, appDir, signal));
      }
      const last = runs[runs.length - 1];
      const passed = runs.map(
        (run) => run.summary.failed === 0 && run.exitCode === 0,
      );

      const coverage = selected
        ? {}
        : readCoverage(appDir, path.join(ctx.cwd, BASELINE_DIR, `${app}.json`));

      const details: TestRunDetails = {
        ...last.summary,
        app,
        scope: selected ? "files" : "all",
        runs: repeat,
        flaky: new Set(passed).size > 1,
        exitCode: last.exitCode,
        ...coverage,
      };
      const text = describeTestRun(details, tail(last.output, 2500));
      return { content: [{ type: "text", text }], details };
    },
  });
}
