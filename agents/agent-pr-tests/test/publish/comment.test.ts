import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../../src/agent/report.ts";
import type { Outcome, RunResult } from "../../src/agent/result.ts";
import {
  COMMENT_MARKER,
  type RenderContext,
  renderReport,
} from "../../src/publish/comment.ts";

const report: Report = {
  decision: "tests_added",
  reason: "The users service had no tests.",
  changes: [
    {
      source: "backend/src/users.ts",
      test: "backend/tests/users.test.ts",
      action: "created",
      why: "New service",
    },
  ],
  not_covered: [],
};

const result = (overrides: Partial<RunResult> = {}): RunResult => ({
  model: "anthropic/claude-sonnet-4-5",
  turns: 12,
  toolCalls: 30,
  tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
  costUsd: 0.5,
  seconds: 90,
  stopReason: "toolUse",
  finalText: "",
  report,
  outcome: "verified",
  verification: [],
  changedFiles: [],
  ...overrides,
});

const render = (run: RunResult | null, ctx: Partial<RenderContext> = {}) =>
  renderReport(run, { pushed: false, ci: "skipped", ...ctx });

describe("conclusion and title", () => {
  it.each<[Outcome, string, string]>([
    ["verified", "success", "Tests written and verified"],
    ["no_tests_needed", "success", "No unit tests needed"],
    ["needs_human", "neutral", "Needs a human"],
    ["unverified", "failure", "Tests written but not verified"],
    ["no_report", "failure", "The agent produced no result"],
  ])("%s", (outcome, conclusion, title) => {
    const rendered = render(result({ outcome }), {
      pushed: outcome === "verified",
      ci: "success",
    });
    expect(rendered.conclusion).toBe(conclusion);
    expect(rendered.title).toBe(title);
    expect(rendered.markdown).toContain(`## Unit test agent: ${title}`);
  });

  it.each<[string, Partial<RenderContext>, string, string, string]>([
    [
      "CI passed and the push worked",
      { pushed: true, ci: "success" },
      "success",
      "Tests written and verified",
      "CI ran on this PR's head plus the agent's tests and passed",
    ],
    [
      "CI failed",
      { ci: "failure" },
      "failure",
      "Tests verified but CI failed",
      "CI failed on this PR's head plus the agent's tests, so they were not committed",
    ],
    [
      "CI passed but the push failed",
      { ci: "success" },
      "failure",
      "Tests verified but not committed",
      "could not commit the tests",
    ],
    [
      "CI was cancelled",
      { ci: "cancelled" },
      "failure",
      "Tests verified but not committed",
      "could not commit the tests",
    ],
  ])("a verified run where %s", (_case, ctx, conclusion, title, note) => {
    const rendered = render(result({ outcome: "verified" }), ctx);
    expect(rendered).toMatchObject({ conclusion, title });
    expect(rendered.markdown).toContain(note);
  });

  it("treats a missing result as a failure", () => {
    const rendered = render(null);
    expect(rendered).toMatchObject({
      conclusion: "failure",
      title: "The agent produced no result",
    });
    expect(rendered.markdown).toContain("result.json");
  });

  it("keeps the title on a single line for $GITHUB_OUTPUT", () => {
    for (const outcome of ["verified", "no_report"] as const) {
      expect(render(result({ outcome })).title).not.toContain("\n");
    }
  });
});

describe("comment body", () => {
  it("starts with the marker the workflow uses to find its comment", () => {
    expect(render(result()).markdown.split("\n")[0]).toBe(COMMENT_MARKER);
  });

  it("is the marker the workflow's skipped job writes", () => {
    const workflow = readFileSync(
      new URL(
        "../../../../.github/workflows/pr-unit-tests.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toContain(COMMENT_MARKER);
  });

  it("summarizes the run", () => {
    const { markdown } = render(result({ costUsd: 0.1234 }));
    expect(markdown).toContain("anthropic/claude-sonnet-4-5");
    expect(markdown).toContain("12 turns");
    expect(markdown).toContain("$0.123");
    expect(markdown).toContain("90s");
  });

  it("states the decision and the reason", () => {
    const { markdown } = render(result());
    expect(markdown).toContain("`tests_added`");
    expect(markdown).toContain("The users service had no tests.");
  });

  it("keeps a multi-line reason from starting its own markdown blocks", () => {
    const { markdown } = render(
      result({
        report: { ...report, reason: "First line.\n# A heading\n- an item" },
      }),
    );
    expect(markdown).toContain("First line. # A heading - an item");
  });

  it("cuts a report that GitHub would reject, keeping the marker line", () => {
    const { markdown } = render(
      result({
        report: {
          ...report,
          not_covered: Array.from(
            { length: 5000 },
            (_, i) => `Case ${i} ${"x".repeat(30)}`,
          ),
        },
      }),
    );
    expect(markdown.length).toBeLessThan(65_000);
    expect(markdown.split("\n")[0]).toBe(COMMENT_MARKER);
    expect(markdown).toContain("The report was cut");
  });

  it("lists the changes in a table and keeps a pipe from breaking it", () => {
    const { markdown } = render(
      result({
        report: {
          ...report,
          changes: [{ ...report.changes[0], why: "Covers a|b\nand c" }],
        },
      }),
    );
    expect(markdown).toContain(
      "| `backend/src/users.ts` | `backend/tests/users.test.ts` | created | Covers a\\|b and c |",
    );
  });

  it("shows what the harness verified for each app", () => {
    const { markdown } = render(
      result({
        verification: [
          {
            app: "backend",
            passed: true,
            typecheckExitCode: 0,
            tests: {
              passed: 12,
              failed: 0,
              failures: [],
              exitCode: 0,
              coverage: {
                lines: 91,
                branches: 80,
                functions: 85,
                statements: 90,
              },
              baseline: {
                lines: 88.5,
                branches: 78,
                functions: 80,
                statements: 88,
              },
            },
          },
          {
            app: "frontend",
            passed: false,
            formatExitCode: 2,
            typecheckExitCode: 2,
            tests: { passed: 4, failed: 1, failures: [], exitCode: 1 },
          },
        ],
      }),
    );
    expect(markdown).toContain(
      "Verified by the harness after the agent stopped",
    );
    expect(markdown).toContain(
      "| backend | none | pass | 12 passed, 0 failed | 88.5% to 91% |",
    );
    expect(markdown).toContain(
      "| frontend | fail | fail | 4 passed, 1 failed |  |",
    );
  });

  it("names a vitest exit code that no failed test explains", () => {
    const { markdown } = render(
      result({
        verification: [
          {
            app: "backend",
            passed: false,
            formatExitCode: 0,
            typecheckExitCode: 0,
            tests: { passed: 5, failed: 0, failures: [], exitCode: 1 },
          },
        ],
      }),
    );
    expect(markdown).toContain(
      "| backend | pass | pass | 5 passed, 0 failed (vitest exit 1) |  |",
    );
  });

  it("lists what was not covered", () => {
    const { markdown } = render(
      result({ report: { ...report, not_covered: ["Prisma queries"] } }),
    );
    expect(markdown).toContain("- Prisma queries");
  });

  it("says when the tests were pushed and links the run", () => {
    const { markdown } = render(result(), {
      pushed: true,
      ci: "success",
      runUrl: "https://github.com/o/r/actions/runs/1",
    });
    expect(markdown).toContain("committed them to this branch");
    expect(markdown).toContain("(https://github.com/o/r/actions/runs/1)");
  });

  it("does not claim a push or a CI pass that did not happen", () => {
    for (const ci of ["failure", "cancelled", "skipped"] as const) {
      const { markdown } = render(result(), { ci });
      expect(markdown).not.toContain("committed them to this branch");
      expect(markdown).not.toContain("CI ran on this PR's head");
    }
  });

  it("explains an unverified outcome", () => {
    const { markdown } = render(result({ outcome: "unverified" }));
    expect(markdown).toContain("not pushed");
  });

  it("shows why a run ended without a report", () => {
    const { markdown } = render(
      result({
        report: null,
        outcome: "no_report",
        stopReason: "error",
        errorMessage: "OAuth refresh failed",
      }),
    );
    expect(markdown).toContain("without calling `report_result`");
    expect(markdown).toContain("OAuth refresh failed");
  });
});
