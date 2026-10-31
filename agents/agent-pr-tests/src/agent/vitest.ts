import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const MAX_MESSAGE_LENGTH = 300;
const MAX_LISTED_FAILURES = 10;

const VITEST_REPORT = path.join(".artifacts", "vitest.json");
const COVERAGE_DIR = "coverage";
const COVERAGE_SUMMARY = path.join(COVERAGE_DIR, "coverage-summary.json");

// Written by scripts/prepare-inputs.sh, relative to the repository root.
export const BASELINE_DIR = path.join(".artifacts", "coverage-baseline");

export const REPORT_ARGS = ["--reporter=json", `--outputFile=${VITEST_REPORT}`];
export const COVERAGE_ARGS = [
  "--coverage",
  "--coverage.reporter=json-summary",
  "--coverage.reportOnFailure",
  `--coverage.reportsDirectory=${COVERAGE_DIR}`,
];

export interface TestFailure {
  name: string;
  message: string;
}

export interface TestSummary {
  passed: number;
  failed: number;
  failures: TestFailure[];
}

export interface CoverageTotals {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

export interface TypecheckDetails {
  app: string;
  exitCode: number;
}

export interface Coverage {
  coverage?: CoverageTotals;
  baseline?: CoverageTotals;
}

export interface TestRunDetails extends TestSummary, Coverage {
  app: string;
  scope: "all" | "files";
  runs: number;
  flaky: boolean;
  exitCode: number;
}

const TestFile = Type.Object({
  name: Type.String(),
  status: Type.String(),
  message: Type.Optional(Type.String()),
  assertionResults: Type.Array(
    Type.Object({
      fullName: Type.String(),
      status: Type.String(),
      failureMessages: Type.Array(Type.String()),
    }),
  ),
});

const VitestReport = Type.Object({
  numPassedTests: Type.Integer(),
  testResults: Type.Array(TestFile),
});

const Percentage = Type.Object({ pct: Type.Number() });

const CoverageSummary = Type.Object({
  total: Type.Object({
    lines: Percentage,
    branches: Percentage,
    functions: Percentage,
    statements: Percentage,
  }),
});

function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n")[0].slice(0, MAX_MESSAGE_LENGTH);
}

function failuresIn(file: Static<typeof TestFile>): TestFailure[] {
  const fileName = path.basename(file.name);
  const failedTests = file.assertionResults
    .filter((test) => test.status === "failed")
    .map((test) => ({
      name: `${fileName} > ${test.fullName}`,
      message: firstLine(test.failureMessages[0]),
    }));

  // A file that fails without a failed test did not load, or a hook threw.
  const suiteFailed = file.status === "failed" && failedTests.length === 0;
  if (!suiteFailed) return failedTests;
  return [
    {
      name: fileName,
      message: firstLine(file.message) || "Test suite failed to run",
    },
  ];
}

/**
 * Vitest's `numFailedTestSuites` counts every `describe` block and each file
 * that contains a failed test, so adding it to the failed tests would count one
 * failure several times.
 */
export function summarizeVitestReport(json: unknown): TestSummary {
  if (!Check(VitestReport, json)) {
    throw new Error("Unrecognized vitest JSON report");
  }
  const failures = json.testResults.flatMap(failuresIn);
  return { passed: json.numPassedTests, failed: failures.length, failures };
}

export function coverageTotals(json: unknown): CoverageTotals {
  if (!Check(CoverageSummary, json)) {
    throw new Error("Unrecognized coverage summary");
  }
  const { lines, branches, functions, statements } = json.total;
  return {
    lines: lines.pct,
    branches: branches.pct,
    functions: functions.pct,
    statements: statements.pct,
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Deletes the files of an earlier run, so that a crashed run cannot pass on them. */
export function clearReports(appDir: string): void {
  rmSync(path.join(appDir, VITEST_REPORT), { force: true });
  rmSync(path.join(appDir, COVERAGE_SUMMARY), { force: true });
}

export function readSummary(appDir: string, output: string): TestSummary {
  try {
    return summarizeVitestReport(readJson(path.join(appDir, VITEST_REPORT)));
  } catch {
    return {
      passed: 0,
      failed: 1,
      failures: [
        {
          name: "vitest",
          message: `No readable test report. Output: ${output.slice(-600)}`,
        },
      ],
    };
  }
}

function readTotals(file: string): CoverageTotals | undefined {
  try {
    return coverageTotals(readJson(file));
  } catch {
    return undefined;
  }
}

export function readCoverage(appDir: string, baselineFile: string): Coverage {
  return {
    coverage: readTotals(path.join(appDir, COVERAGE_SUMMARY)),
    baseline: readTotals(baselineFile),
  };
}

function describeCoverage(run: TestRunDetails): string[] {
  const { coverage, baseline } = run;
  if (!coverage) return [];
  const lines = [
    `Coverage (total): lines ${coverage.lines}% branches ${coverage.branches}% functions ${coverage.functions}% statements ${coverage.statements}%`,
  ];
  if (baseline) {
    lines.push(
      `Line coverage: ${baseline.lines}% before your tests, ${coverage.lines}% now`,
    );
  }
  return lines;
}

export function describeTestRun(
  run: TestRunDetails,
  outputTail: string,
): string {
  const scope = run.scope === "all" ? "full run" : "selected files";
  const repeats =
    run.runs === 1
      ? ""
      : run.flaky
        ? ` (x${run.runs}, FLAKY: results differed between repeats)`
        : ` (x${run.runs}, stable)`;

  const lines = [
    `vitest ${run.app} [${scope}]: ${run.passed} passed, ${run.failed} failed${repeats}`,
  ];
  if (run.failures.length > 0) {
    lines.push(
      "Failures:",
      ...run.failures
        .slice(0, MAX_LISTED_FAILURES)
        .map((failure) => `- ${failure.name}: ${failure.message}`),
    );
  }
  lines.push(...describeCoverage(run));
  if (run.exitCode !== 0 && run.failed === 0) {
    lines.push(
      `vitest exited ${run.exitCode} although no test failed (a coverage threshold or a config error):`,
      outputTail,
    );
  }
  return lines.join("\n");
}
