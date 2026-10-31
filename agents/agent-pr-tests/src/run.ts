import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listChangedFiles } from "./agent/git.ts";
import { findReport, OUTCOMES, summarizeRun } from "./agent/result.ts";
import { createRunSession, resolveModel } from "./agent/session.ts";
import { parsePrNumber, prPrompt } from "./agent/task.ts";
import { verifyChangedApps } from "./agent/verify.ts";
import { BASELINE_DIR } from "./agent/vitest.ts";
import { loadConfig } from "./config.ts";

const { values: flags } = parseArgs({
  options: {
    pr: { type: "string" },
    model: { type: "string" },
    out: { type: "string", default: ".artifacts" },
    prompt: { type: "string" },
  },
});

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const agentDir = path.join(packageDir, "pi");
const config = loadConfig(path.join(packageDir, "config.json"));

const role = config.roles.pr;
const prompt = flags.prompt ?? prPrompt(parsePrNumber(flags.pr));
const outDir = path.resolve(repoRoot, flags.out);
mkdirSync(outDir, { recursive: true });

const resolved = await resolveModel({
  agentDir,
  modelRef: flags.model ?? process.env.AGENT_MODEL ?? role.model,
  authPath: process.env.AGENT_AUTH_PATH,
  apiKeyFile: process.env.AGENT_API_KEY_FILE,
});
const session = await createRunSession({
  repoRoot,
  agentDir,
  model: resolved.model,
  modelRuntime: resolved.modelRuntime,
  thinking: resolved.thinkingLevel ?? role.thinking,
  sessionDir: outDir,
});
const model = `${resolved.model.provider}/${resolved.model.id}`;
console.error(
  `[agent] model=${model} thinking=${session.thinkingLevel} tools=${session.getActiveToolNames().join(",")}`,
);

const startedAt = Date.now();
const deadline = setTimeout(
  () => void session.abort(),
  role.wallClockMin * 60_000,
);
try {
  await session.prompt(prompt);
} finally {
  clearTimeout(deadline);
  const finishedAt = Date.now();
  const changedFiles = listChangedFiles(repoRoot);
  const decision = findReport(session.messages)?.decision;
  const verification =
    decision === "tests_added" || decision === "tests_updated"
      ? await verifyChangedApps({
          repoRoot,
          apps: config.apps,
          changedFiles,
          baselineDir: path.join(repoRoot, BASELINE_DIR),
        })
      : [];
  const result = summarizeRun({
    model,
    messages: session.messages,
    stats: session.getSessionStats(),
    startedAt,
    finishedAt,
    apps: config.apps,
    policy: config.policy,
    changedFiles,
    verification,
  });
  writeFileSync(
    path.join(outDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (result.sessionFile && existsSync(result.sessionFile)) {
    await session.exportToHtml(path.join(outDir, "transcript.html"));
  }
  session.dispose();

  process.exitCode = OUTCOMES[result.outcome].exitCode;
  console.error(
    `[agent] done: outcome=${result.outcome} decision=${result.report?.decision ?? "none"} turns=${result.turns} cost=$${result.costUsd} stop=${result.stopReason} exit=${process.exitCode}`,
  );
}
