import path from "node:path";
import type { AgentConfig } from "../config.ts";
import { runCommand } from "./command.ts";
import {
  clearReports,
  COVERAGE_ARGS,
  type Coverage,
  readCoverage,
  readSummary,
  REPORT_ARGS,
  type TestSummary,
} from "./vitest.ts";

export const TYPECHECK_TIMEOUT_MS = 180_000;
export const TEST_TIMEOUT_MS = 600_000;
const FORMAT_TIMEOUT_MS = 120_000;

type App = AgentConfig["apps"][string];

export interface AppVerification {
  app: string;
  passed: boolean;
  /** Absent when the app has no formatter. */
  formatExitCode?: number;
  typecheckExitCode: number;
  tests: TestSummary & Coverage & { exitCode: number };
}

export interface VerifySpec {
  repoRoot: string;
  appName: string;
  app: App;
  /** The app's changed files, relative to the app directory. */
  files: string[];
  baselineDir: string;
}

export async function verifyApp(spec: VerifySpec): Promise<AppVerification> {
  const { repoRoot, appName, app, files, baselineDir } = spec;
  const cwd = path.join(repoRoot, app.cwd);
  const run = ([command, ...args]: string[], timeout: number) =>
    runCommand(command, args, { cwd, timeout });

  // Format first, so the content that is verified is the content that gets pushed.
  const format =
    app.format.length > 0
      ? await run([...app.format, ...files], FORMAT_TIMEOUT_MS)
      : undefined;
  const typecheck = await run(app.typecheck, TYPECHECK_TIMEOUT_MS);

  clearReports(cwd);
  const vitest = await run(
    [...app.vitest, ...REPORT_ARGS, ...COVERAGE_ARGS],
    TEST_TIMEOUT_MS,
  );
  const tests = {
    ...readSummary(cwd, vitest.output),
    ...readCoverage(cwd, path.join(baselineDir, `${appName}.json`)),
    exitCode: vitest.exitCode,
  };

  return {
    app: appName,
    passed:
      (format?.exitCode ?? 0) === 0 &&
      typecheck.exitCode === 0 &&
      tests.exitCode === 0 &&
      tests.failed === 0,
    formatExitCode: format?.exitCode,
    typecheckExitCode: typecheck.exitCode,
    tests,
  };
}

export interface ChangedAppsSpec {
  repoRoot: string;
  apps: AgentConfig["apps"];
  changedFiles: string[];
  baselineDir: string;
}

export async function verifyChangedApps(
  spec: ChangedAppsSpec,
): Promise<AppVerification[]> {
  const { repoRoot, apps, changedFiles, baselineDir } = spec;
  const verification: AppVerification[] = [];
  for (const [appName, app] of Object.entries(apps)) {
    const prefix = `${app.cwd}/`;
    const files = changedFiles
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length));
    if (files.length === 0) continue;
    verification.push(
      await verifyApp({ repoRoot, appName, app, files, baselineDir }),
    );
  }
  return verification;
}
