import type {
  AgentSession,
  SessionStats,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../config.ts";
import { isWritable } from "./policy.ts";
import type { Report } from "./report.ts";
import type { AppVerification } from "./verify.ts";

type SessionMessage = AgentSession["messages"][number];

export type Outcome =
  "verified" | "no_tests_needed" | "needs_human" | "unverified" | "no_report";

export const OUTCOMES: Record<
  Outcome,
  {
    exitCode: 0 | 1 | 2;
    conclusion: "success" | "neutral" | "failure";
  }
> = {
  verified: { exitCode: 0, conclusion: "success" },
  no_tests_needed: { exitCode: 0, conclusion: "success" },
  needs_human: { exitCode: 2, conclusion: "neutral" },
  unverified: { exitCode: 1, conclusion: "failure" },
  no_report: { exitCode: 1, conclusion: "failure" },
};

export interface RunResult {
  model: string;
  turns: number;
  toolCalls: number;
  tokens: SessionStats["tokens"];
  costUsd: number;
  seconds: number;
  stopReason: string;
  errorMessage?: string;
  finalText: string;
  sessionFile?: string;
  report: Report | null;
  outcome: Outcome;
  verification: AppVerification[];
  changedFiles: string[];
}

export interface RunFacts {
  model: string;
  messages: readonly SessionMessage[];
  stats: SessionStats;
  startedAt: number;
  finishedAt: number;
  apps: AgentConfig["apps"];
  policy: AgentConfig["policy"];
  changedFiles: string[];
  verification: AppVerification[];
}

export function summarizeRun(facts: RunFacts): RunResult {
  const { messages, stats } = facts;
  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  const report = findReport(messages);
  return {
    model: facts.model,
    turns: stats.assistantMessages,
    toolCalls: stats.toolCalls,
    tokens: stats.tokens,
    costUsd: Number(stats.cost.toFixed(4)),
    seconds: Math.round((facts.finishedAt - facts.startedAt) / 1000),
    stopReason: lastAssistant?.stopReason ?? "none",
    errorMessage: lastAssistant?.errorMessage,
    finalText:
      lastAssistant?.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n") ?? "",
    sessionFile: stats.sessionFile,
    report,
    outcome: outcomeOf(report, facts),
    verification: facts.verification,
    changedFiles: facts.changedFiles,
  };
}

/**
 * Pi validates tool arguments against the report schema before the tool
 * runs, so a successful `report_result` result carries a valid report.
 */
export function findReport(messages: readonly SessionMessage[]): Report | null {
  const result = messages.findLast(
    (m) =>
      m.role === "toolResult" && m.toolName === "report_result" && !m.isError,
  );
  return result?.role === "toolResult" ? (result.details as Report) : null;
}

function isVerified({
  changedFiles,
  policy,
  apps,
  verification,
}: RunFacts): boolean {
  const verifiedDirs = verification
    .filter((app) => app.passed)
    .map((app) => apps[app.app].cwd);
  return (
    changedFiles.length > 0 &&
    changedFiles.every(
      (file) =>
        isWritable(file, policy) &&
        verifiedDirs.some((dir) => file.startsWith(`${dir}/`)),
    )
  );
}

function outcomeOf(report: Report | null, facts: RunFacts): Outcome {
  if (!report) return "no_report";
  switch (report.decision) {
    case "needs_human":
      return "needs_human";
    case "no_tests_needed":
      return "no_tests_needed";
    case "tests_added":
    case "tests_updated":
      return isVerified(facts) ? "verified" : "unverified";
  }
}
