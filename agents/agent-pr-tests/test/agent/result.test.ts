import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../src/config.ts";
import type { Report } from "../../src/agent/report.ts";
import {
  OUTCOMES,
  type RunFacts,
  summarizeRun,
} from "../../src/agent/result.ts";
import type { AppVerification } from "../../src/agent/verify.ts";

type Message = RunFacts["messages"][number];

const app = (cwd: string) => ({
  cwd,
  typecheck: ["npm", "run", "typecheck"],
  vitest: ["npx", "vitest", "run"],
  format: [],
});
const apps: AgentConfig["apps"] = {
  backend: app("backend"),
  frontend: app("frontend"),
};

const policy: AgentConfig["policy"] = {
  writable: ["backend/tests/**/*.test.ts", "frontend/src/**/*.test.tsx"],
  forbidden: ["**/node_modules/**"],
  maxViolations: 3,
  maxFilesPerRun: 8,
};

const report = (decision: Report["decision"]): Report => ({
  decision,
  reason: "because",
  changes: [],
  not_covered: [],
});

const assistant = (stopReason: string, text: string, errorMessage?: string) =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    errorMessage,
  }) as unknown as Message;

const toolResult = (toolName: string, details: unknown, isError = false) =>
  ({ role: "toolResult", toolName, details, isError }) as unknown as Message;

const reported = (decision: Report["decision"]) =>
  toolResult("report_result", report(decision));

const verifiedApp = (appName: string): AppVerification => ({
  app: appName,
  passed: true,
  formatExitCode: 0,
  typecheckExitCode: 0,
  tests: { passed: 5, failed: 0, failures: [], exitCode: 0 },
});

const failedApp = (appName: string): AppVerification => ({
  ...verifiedApp(appName),
  passed: false,
  tests: {
    passed: 4,
    failed: 1,
    failures: [{ name: "a.test.ts > x", message: "boom" }],
    exitCode: 1,
  },
});

const facts = (
  messages: Message[],
  overrides: Partial<RunFacts> = {},
): RunFacts => ({
  model: "anthropic/claude-sonnet-4-5",
  messages,
  stats: {
    sessionFile: "/tmp/run.jsonl",
    sessionId: "id",
    userMessages: 1,
    assistantMessages: 3,
    toolCalls: 2,
    toolResults: 2,
    totalMessages: 6,
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
    cost: 0.123456,
  },
  startedAt: 0,
  finishedAt: 61_400,
  apps,
  policy,
  changedFiles: [],
  verification: [],
  ...overrides,
});

const backendTest = ["backend/tests/users.test.ts"];
const frontendTest = ["frontend/src/Card.test.tsx"];

describe("what each outcome means to the workflow", () => {
  it.each([
    {
      name: "tests written and verified by the harness",
      messages: [reported("tests_added")],
      overrides: {
        changedFiles: backendTest,
        verification: [verifiedApp("backend")],
      },
      outcome: "verified",
      effect: { exitCode: 0, conclusion: "success" },
    },
    {
      name: "nothing worth testing",
      messages: [reported("no_tests_needed")],
      overrides: {},
      outcome: "no_tests_needed",
      effect: { exitCode: 0, conclusion: "success" },
    },
    {
      name: "the agent hands over to a human",
      messages: [reported("needs_human")],
      overrides: {},
      outcome: "needs_human",
      effect: { exitCode: 2, conclusion: "neutral" },
    },
    {
      name: "tests written but the harness finds the suite red",
      messages: [reported("tests_updated")],
      overrides: {
        changedFiles: backendTest,
        verification: [failedApp("backend")],
      },
      outcome: "unverified",
      effect: { exitCode: 1, conclusion: "failure" },
    },
    {
      name: "the run ends without a report",
      messages: [],
      overrides: {
        changedFiles: backendTest,
        verification: [verifiedApp("backend")],
      },
      outcome: "no_report",
      effect: { exitCode: 1, conclusion: "failure" },
    },
  ])("$name", ({ messages, overrides, outcome, effect }) => {
    const result = summarizeRun(facts(messages, overrides));
    expect(result.outcome).toBe(outcome);
    expect(OUTCOMES[result.outcome]).toEqual(effect);
  });
});

describe("verifying written tests", () => {
  const outcomeOf = (
    overrides: Partial<RunFacts>,
    messages = [reported("tests_added")],
  ) => summarizeRun(facts(messages, overrides)).outcome;

  it("verifies when every changed app passed the harness", () => {
    expect(
      outcomeOf({
        changedFiles: [...backendTest, ...frontendTest],
        verification: [verifiedApp("backend"), verifiedApp("frontend")],
      }),
    ).toBe("verified");
  });

  it("does not trust the report when no file changed", () => {
    expect(outcomeOf({ verification: [verifiedApp("backend")] })).toBe(
      "unverified",
    );
  });

  it("does not verify a changed app that failed while another passed", () => {
    expect(
      outcomeOf({
        changedFiles: [...backendTest, ...frontendTest],
        verification: [verifiedApp("backend"), failedApp("frontend")],
      }),
    ).toBe("unverified");
  });

  it("does not verify a changed app that the harness never ran", () => {
    expect(
      outcomeOf({
        changedFiles: [...backendTest, ...frontendTest],
        verification: [verifiedApp("backend")],
      }),
    ).toBe("unverified");
  });

  it("does not verify a changed file the agent may not write", () => {
    expect(
      outcomeOf({
        changedFiles: [...backendTest, "backend/src/users.ts"],
        verification: [verifiedApp("backend")],
      }),
    ).toBe("unverified");
  });

  it("does not verify a writable file that no app verified", () => {
    expect(
      outcomeOf({
        policy: { ...policy, writable: ["**/*.test.ts"] },
        changedFiles: [...backendTest, "backend-tools/x.test.ts"],
        verification: [verifiedApp("backend")],
      }),
    ).toBe("unverified");
  });

  it("ignores passing checks the model ran earlier", () => {
    const earlierChecks = [
      toolResult("typecheck", { app: "backend", exitCode: 0 }),
      toolResult("run_tests", { app: "backend", exitCode: 0, failed: 0 }),
      reported("tests_added"),
    ];
    expect(
      outcomeOf(
        { changedFiles: backendTest, verification: [failedApp("backend")] },
        earlierChecks,
      ),
    ).toBe("unverified");
  });

  it("ignores failing checks the model ran earlier", () => {
    const earlierChecks = [
      toolResult("run_tests", { app: "backend", exitCode: 1, failed: 3 }),
      reported("tests_added"),
    ];
    expect(
      outcomeOf(
        { changedFiles: backendTest, verification: [verifiedApp("backend")] },
        earlierChecks,
      ),
    ).toBe("verified");
  });
});

describe("run summary", () => {
  it("takes the report from the last successful report_result call", () => {
    const final = report("tests_added");
    const result = summarizeRun(
      facts(
        [
          toolResult("report_result", { decision: "bogus" }, true),
          toolResult("report_result", final),
          assistant("toolUse", "Done."),
        ],
        { changedFiles: backendTest },
      ),
    );
    expect(result.report).toEqual(final);
    expect(result).toMatchObject({
      turns: 3,
      toolCalls: 2,
      costUsd: 0.1235,
      seconds: 61,
      stopReason: "toolUse",
      finalText: "Done.",
      sessionFile: "/tmp/run.jsonl",
      changedFiles: backendTest,
    });
  });

  it("records the provider error when the run fails without a report", () => {
    const result = summarizeRun(
      facts([assistant("error", "", "OAuth refresh failed")]),
    );
    expect(result).toMatchObject({
      report: null,
      outcome: "no_report",
      stopReason: "error",
      errorMessage: "OAuth refresh failed",
    });
  });
});
