import { OUTCOMES, type Outcome, type RunResult } from "../agent/result.ts";
import type { AppVerification } from "../agent/verify.ts";

export const COMMENT_MARKER = "<!-- taskly-unit-test-agent -->";

// GitHub rejects a comment or a check run summary above 65,536 characters.
const MAX_MARKDOWN_LENGTH = 60_000;

const TITLES: Record<Outcome, string> = {
  verified: "Tests written and verified",
  no_tests_needed: "No unit tests needed",
  needs_human: "Needs a human",
  unverified: "Tests written but not verified",
  no_report: "The agent produced no result",
};

export const CI_RESULTS = [
  "success",
  "failure",
  "cancelled",
  "skipped",
] as const;
export type CiResult = (typeof CI_RESULTS)[number];

export interface RenderContext {
  pushed: boolean;
  ci: CiResult;
  runUrl?: string;
}

export interface RenderedReport {
  markdown: string;
  conclusion: (typeof OUTCOMES)[Outcome]["conclusion"];
  title: string;
}

interface Publication {
  title: string;
  conclusion: RenderedReport["conclusion"];
  note: string;
}

function describePublish({ pushed, ci }: RenderContext): Publication {
  if (pushed) {
    return {
      title: TITLES.verified,
      conclusion: "success",
      note: "CI ran on this PR's head plus the agent's tests and passed, so the agent committed them to this branch. Review them like any other code.",
    };
  }
  if (ci === "failure") {
    return {
      title: "Tests verified but CI failed",
      conclusion: "failure",
      note: "CI failed on this PR's head plus the agent's tests, so they were not committed. See the run log.",
    };
  }
  return {
    title: "Tests verified but not committed",
    conclusion: "failure",
    note: "The publish job could not commit the tests. See the run log.",
  };
}

function oneLine(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function code(text: string): string {
  return `\`${oneLine(text.replaceAll("`", "'"))}\``;
}

function table(headers: string[], rows: string[][]): string[] {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line), ""];
}

function describeFormat({ formatExitCode }: AppVerification): string {
  if (formatExitCode === undefined) return "none";
  return formatExitCode === 0 ? "pass" : "fail";
}

function describeTypecheck({ typecheckExitCode }: AppVerification): string {
  return typecheckExitCode === 0 ? "pass" : "fail";
}

function describeTests({ tests }: AppVerification): string {
  const counts = `${tests.passed} passed, ${tests.failed} failed`;
  return tests.exitCode !== 0 && tests.failed === 0
    ? `${counts} (vitest exit ${tests.exitCode})`
    : counts;
}

function describeCoverage({ tests }: AppVerification): string {
  if (!tests.coverage) return "";
  const after = `${tests.coverage.lines}%`;
  return tests.baseline ? `${tests.baseline.lines}% to ${after}` : after;
}

function describeRun(result: RunResult): string[] {
  const facts = [
    code(result.model),
    `${result.turns} turns`,
    `$${result.costUsd.toFixed(3)}`,
    `${result.seconds}s`,
    `stop: ${code(result.stopReason)}`,
  ];
  return [facts.join(" · "), ""];
}

function describeVerdict(result: RunResult | null): string[] {
  if (!result) {
    return ["The agent job left no `result.json`. See the run log.", ""];
  }
  const { report } = result;
  if (!report) {
    return [
      "The agent ended without calling `report_result`.",
      ...(result.errorMessage
        ? [`Error: ${oneLine(result.errorMessage)}`]
        : []),
      "",
    ];
  }
  const lines = [
    `**Decision:** ${code(report.decision)}`,
    "",
    oneLine(report.reason),
    "",
  ];
  if (result.outcome === "unverified") {
    lines.push(
      "The tests were not pushed. After the agent stopped, the harness did not get a clean format, typecheck and full test run for every changed app, or the agent changed a file it may not write.",
      "",
    );
  }
  return lines;
}

function describeChanges(result: RunResult | null): string[] {
  const changes = result?.report?.changes ?? [];
  if (changes.length === 0) return [];
  return table(
    ["Source", "Test", "Action", "Why"],
    changes.map((change) => [
      code(change.source),
      change.test ? code(change.test) : "",
      change.action,
      oneLine(change.why),
    ]),
  );
}

function describeVerification(result: RunResult | null): string[] {
  const apps = result?.verification ?? [];
  if (apps.length === 0) return [];
  return [
    "**Verified by the harness after the agent stopped**",
    "",
    ...table(
      ["App", "Format", "Typecheck", "Tests", "Line coverage"],
      apps.map((app) => [
        app.app,
        describeFormat(app),
        describeTypecheck(app),
        describeTests(app),
        describeCoverage(app),
      ]),
    ),
  ];
}

function describeNotCovered(result: RunResult | null): string[] {
  const notCovered = result?.report?.not_covered ?? [];
  if (notCovered.length === 0) return [];
  return [
    "**Not covered**",
    "",
    ...notCovered.map((item) => `- ${oneLine(item)}`),
    "",
  ];
}

export function renderReport(
  result: RunResult | null,
  ctx: RenderContext,
): RenderedReport {
  const outcome = result?.outcome ?? "no_report";
  const published = outcome === "verified" ? describePublish(ctx) : undefined;
  const title = published?.title ?? TITLES[outcome];
  const conclusion = published?.conclusion ?? OUTCOMES[outcome].conclusion;
  const body = [
    COMMENT_MARKER,
    `## Unit test agent: ${title}`,
    "",
    ...(result ? describeRun(result) : []),
    ...describeVerdict(result),
    ...(published ? [published.note, ""] : []),
    ...describeChanges(result),
    ...describeVerification(result),
    ...describeNotCovered(result),
    ...(ctx.runUrl ? [`[Run log and artifacts](${ctx.runUrl})`, ""] : []),
  ].join("\n");
  const markdown =
    body.length > MAX_MARKDOWN_LENGTH
      ? `${body.slice(0, MAX_MARKDOWN_LENGTH)}\n\n(The report was cut at ${MAX_MARKDOWN_LENGTH} characters.)`
      : body;

  return { markdown, conclusion, title };
}
