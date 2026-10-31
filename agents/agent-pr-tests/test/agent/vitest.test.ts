import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  coverageTotals,
  describeTestRun,
  readCoverage,
  summarizeVitestReport,
  type TestRunDetails,
} from "../../src/agent/vitest.ts";

const assertion = (
  fullName: string,
  status: "passed" | "failed",
  failureMessages: string[] = [],
) => ({ fullName, status, failureMessages });

const testFile = (
  name: string,
  status: "passed" | "failed",
  assertionResults: ReturnType<typeof assertion>[],
  message = "",
) => ({ name, status, message, assertionResults });

describe("summarizeVitestReport", () => {
  it("reports a passing run", () => {
    const summary = summarizeVitestReport({
      numPassedTests: 2,
      testResults: [
        testFile("/repo/backend/tests/a.test.ts", "passed", [
          assertion("math adds", "passed"),
          assertion("math subtracts", "passed"),
        ]),
      ],
    });
    expect(summary).toEqual({ passed: 2, failed: 0, failures: [] });
  });

  it("names a failed assertion and keeps only the first line of its message", () => {
    const summary = summarizeVitestReport({
      numPassedTests: 1,
      testResults: [
        testFile("/repo/backend/tests/a.test.ts", "failed", [
          assertion("math adds", "passed"),
          assertion("math fails", "failed", [
            "AssertionError: expected 2 to be 3\n    at /repo/a.test.ts:4:35",
          ]),
        ]),
      ],
    });
    expect(summary).toEqual({
      passed: 1,
      failed: 1,
      failures: [
        {
          name: "a.test.ts > math fails",
          message: "AssertionError: expected 2 to be 3",
        },
      ],
    });
  });

  it("turns a suite that failed to load into one failure", () => {
    const summary = summarizeVitestReport({
      numPassedTests: 0,
      testResults: [
        testFile(
          "/repo/backend/tests/b.test.ts",
          "failed",
          [],
          "Cannot find module './missing.ts' imported from /repo/b.test.ts",
        ),
      ],
    });
    expect(summary).toEqual({
      passed: 0,
      failed: 1,
      failures: [
        {
          name: "b.test.ts",
          message:
            "Cannot find module './missing.ts' imported from /repo/b.test.ts",
        },
      ],
    });
  });

  it("fails a file whose tests passed but whose suite did not", () => {
    const summary = summarizeVitestReport({
      numPassedTests: 1,
      testResults: [
        testFile(
          "/repo/backend/tests/c.test.ts",
          "failed",
          [assertion("works", "passed")],
          "afterAll hook threw",
        ),
      ],
    });
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]).toEqual({
      name: "c.test.ts",
      message: "afterAll hook threw",
    });
  });

  it("does not count a failed file twice when its tests failed", () => {
    const summary = summarizeVitestReport({
      numPassedTests: 0,
      testResults: [
        testFile(
          "/repo/backend/tests/a.test.ts",
          "failed",
          [assertion("one", "failed", ["boom"]), assertion("two", "failed")],
          "1 test failed",
        ),
      ],
    });
    expect(summary.failed).toBe(2);
  });

  it("caps a very long failure message", () => {
    const summary = summarizeVitestReport({
      numPassedTests: 0,
      testResults: [
        testFile("/repo/a.test.ts", "failed", [
          assertion("long", "failed", ["x".repeat(2000)]),
        ]),
      ],
    });
    expect(summary.failures[0].message).toHaveLength(300);
  });

  it.each([undefined, null, "{}", {}, { numPassedTests: 1 }])(
    "rejects an unrecognized report %j",
    (json) => {
      expect(() => summarizeVitestReport(json)).toThrow(/vitest/);
    },
  );
});

describe("coverageTotals", () => {
  const entry = (pct: number) => ({ total: 10, covered: pct / 10, pct });

  it("reads the percentages from the total entry of coverage-summary.json", () => {
    const summary = {
      total: {
        lines: entry(91.2),
        statements: entry(90),
        functions: entry(80),
        branches: entry(70.5),
      },
      "/repo/backend/src/app.ts": { lines: entry(10) },
    };
    expect(coverageTotals(summary)).toEqual({
      lines: 91.2,
      statements: 90,
      functions: 80,
      branches: 70.5,
    });
  });

  it("rejects a summary without totals", () => {
    expect(() => coverageTotals({ total: { lines: entry(1) } })).toThrow(
      /coverage/,
    );
  });
});

describe("readCoverage", () => {
  let appDir: string;

  beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), "coverage-"));
    mkdirSync(path.join(appDir, "coverage"));
  });

  afterEach(() => {
    rmSync(appDir, { recursive: true, force: true });
  });

  it("reads the totals of the run and of the baseline", () => {
    const summary = {
      total: Object.fromEntries(
        ["lines", "branches", "functions", "statements"].map((key) => [
          key,
          { pct: 90 },
        ]),
      ),
    };
    writeFileSync(
      path.join(appDir, "coverage", "coverage-summary.json"),
      JSON.stringify(summary),
    );
    writeFileSync(path.join(appDir, "baseline.json"), JSON.stringify(summary));

    const { coverage, baseline } = readCoverage(
      appDir,
      path.join(appDir, "baseline.json"),
    );

    expect(coverage?.lines).toBe(90);
    expect(baseline?.lines).toBe(90);
  });

  it("leaves out a summary that is missing or unreadable", () => {
    writeFileSync(
      path.join(appDir, "coverage", "coverage-summary.json"),
      "{oops",
    );

    expect(readCoverage(appDir, path.join(appDir, "missing.json"))).toEqual({
      coverage: undefined,
      baseline: undefined,
    });
  });
});

describe("describeTestRun", () => {
  const run = (overrides: Partial<TestRunDetails> = {}): TestRunDetails => ({
    app: "backend",
    scope: "all",
    runs: 1,
    flaky: false,
    exitCode: 0,
    passed: 12,
    failed: 0,
    failures: [],
    ...overrides,
  });

  it("states the counts and the scope", () => {
    expect(describeTestRun(run(), "")).toBe(
      "vitest backend [full run]: 12 passed, 0 failed",
    );
  });

  it("lists at most ten failures", () => {
    const failures = Array.from({ length: 12 }, (_, index) => ({
      name: `a.test.ts > case ${index}`,
      message: "boom",
    }));
    const text = describeTestRun(run({ failed: 12, failures }), "");
    expect(text).toContain("- a.test.ts > case 9: boom");
    expect(text).not.toContain("case 10");
  });

  it("warns when repeated runs disagree", () => {
    const text = describeTestRun(run({ runs: 3, flaky: true }), "");
    expect(text).toContain("FLAKY");
  });

  it("compares coverage to the baseline", () => {
    const totals = { lines: 91, branches: 80, functions: 85, statements: 90 };
    const text = describeTestRun(
      run({ coverage: totals, baseline: { ...totals, lines: 88.5 } }),
      "",
    );
    expect(text).toContain("88.5% before your tests, 91% now");
  });

  it("shows the output when vitest fails although no test did", () => {
    const text = describeTestRun(
      run({ exitCode: 1 }),
      "ERROR: Coverage for lines (79%) does not meet threshold (80%)",
    );
    expect(text).toContain("does not meet threshold");
  });

  it("leaves the output out when a test failure explains the exit code", () => {
    const text = describeTestRun(
      run({
        exitCode: 1,
        failed: 1,
        failures: [{ name: "a.test.ts > x", message: "boom" }],
      }),
      "NOISY OUTPUT",
    );
    expect(text).not.toContain("NOISY OUTPUT");
  });
});
